const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { getGroq } = require('../../shared/utils/groq');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');

const SESSION_TTL = 900; // 15 minutos

const parseExcel = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  return wb.SheetNames.map((nombre) => {
    const ws = wb.Sheets[nombre];
    const filas = XLSX.utils.sheet_to_json(ws, { defval: '' });
    const headers = filas.length > 0 ? Object.keys(filas[0]) : [];
    return { nombre, headers, filas, preview: filas.slice(0, 5) };
  }).filter((s) => s.filas.length > 0);
};

const buildGroqPrompt = (sheets) => {
  const sheetDescriptions = sheets.map((s) => {
    const sampleRows = s.preview.slice(0, 3).map((r) => JSON.stringify(r)).join('\n');
    return `Hoja: "${s.nombre}"\nColumnas: ${s.headers.join(', ')}\nPrimeras filas:\n${sampleRows}`;
  }).join('\n\n---\n\n');

  return `Eres un experto en presupuestos de construcción colombiana. Analiza este archivo Excel de una empresa constructora.

${sheetDescriptions}

Para cada hoja, determina:
1. **tipo**:
   - "APU": ítems de análisis de precios unitarios (tienen código, descripción, unidad, cantidad, precio unitario)
   - "BASICOS": lista de precios básicos de materiales/mano de obra (código, descripción, unidad, precio)
   - "PRESUPUESTO": presupuesto general o capítulos de obra (puede tener subtotales, agrupaciones)
   - "OTRO": cualquier otra cosa (ignorar en importación)

2. **columnas**: mapeo de columnas al esquema interno (usa el nombre EXACTO de la columna del Excel):
   - codigo: columna con código o ítem
   - descripcion: columna con nombre o descripción
   - unidad: columna con unidad de medida
   - cantidad: columna con cantidad (null si no aplica)
   - precioUnitario: columna con precio unitario o valor

Responde SOLO con JSON válido, sin texto adicional:
{
  "sheets": [
    {
      "nombre": "nombre exacto de la hoja",
      "tipo": "APU|BASICOS|PRESUPUESTO|OTRO",
      "columnas": {
        "codigo": "nombre exacto columna o null",
        "descripcion": "nombre exacto columna o null",
        "unidad": "nombre exacto columna o null",
        "cantidad": "nombre exacto columna o null",
        "precioUnitario": "nombre exacto columna o null"
      },
      "razon": "explicación breve en español"
    }
  ]
}`;
};

const analyzeExcel = async (buffer) => {
  const sheets = parseExcel(buffer);
  if (sheets.length === 0) throw Object.assign(new Error('El archivo no contiene datos'), { statusCode: 400 });

  const groq = getGroq();
  const prompt = buildGroqPrompt(sheets);

  logger.info(`[excel.analyzer] Enviando ${sheets.length} hojas a Groq`);
  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  const raw = completion.choices[0].message.content;
  let analysis;
  try {
    analysis = JSON.parse(raw);
  } catch {
    logger.error('[excel.analyzer] Groq devolvió JSON inválido:', raw);
    throw Object.assign(new Error('Error al interpretar la respuesta de IA'), { statusCode: 500 });
  }

  // Guardar datos completos en Redis (cliente solo recibe preview)
  const sessionKey = uuidv4();
  const sessionData = sheets.map((s) => {
    const groqSheet = (analysis.sheets || []).find((g) => g.nombre === s.nombre) || {};
    return {
      nombre: s.nombre,
      tipo: groqSheet.tipo || 'OTRO',
      columnas: groqSheet.columnas || {},
      razon: groqSheet.razon || '',
      headers: s.headers,
      filas: s.filas,
      preview: s.preview,
    };
  });

  await redis.set(`excel:session:${sessionKey}`, JSON.stringify(sessionData), 'EX', SESSION_TTL);
  logger.info(`[excel.analyzer] Sesión creada: ${sessionKey}`);

  // Respuesta al cliente (sin filas completas)
  return {
    sessionKey,
    sheets: sessionData.map(({ filas: _f, ...rest }) => rest),
  };
};

const confirmImport = async (sessionKey, confirmedSheets, companyId) => {
  const raw = await redis.get(`excel:session:${sessionKey}`);
  if (!raw) throw Object.assign(new Error('Sesión expirada o inválida. Sube el archivo nuevamente.'), { statusCode: 400 });

  const sessionData = JSON.parse(raw);
  await redis.del(`excel:session:${sessionKey}`);

  return sessionData.map((s) => {
    const confirmed = confirmedSheets.find((c) => c.nombre === s.nombre);
    if (!confirmed) return null;
    return { ...s, tipo: confirmed.tipo, columnas: confirmed.columnas };
  }).filter(Boolean);
};

// Devuelve filas ya mapeadas para mostrar en grilla de selección (sin wizard)
const previewExcel = async (buffer) => {
  const sheets = parseExcel(buffer);
  if (sheets.length === 0) {
    throw Object.assign(new Error('El archivo no contiene datos'), { statusCode: 400 });
  }

  const groq = getGroq();
  logger.info(`[excel.analyzer] previewExcel: ${sheets.length} hojas`);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: buildGroqPrompt(sheets) }],
    temperature: 0.1,
    max_tokens: 1500,
    response_format: { type: 'json_object' },
  });

  let analysis;
  try {
    analysis = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw Object.assign(new Error('Error al interpretar la respuesta de IA'), { statusCode: 500 });
  }

  const items = [];
  const sheetSummary = [];

  for (const sheet of sheets) {
    const groqSheet = (analysis.sheets || []).find((g) => g.nombre === sheet.nombre) || {};
    const tipo = groqSheet.tipo || 'OTRO';
    const col = groqSheet.columnas || {};

    if (tipo === 'OTRO') {
      sheetSummary.push({ nombre: sheet.nombre, tipo, total: 0, omitida: true });
      continue;
    }

    let count = 0;
    for (const row of sheet.filas) {
      const descripcion = col.descripcion ? String(row[col.descripcion] ?? '').trim() : '';
      if (!descripcion || descripcion.length < 2) continue;

      const rawPrecio = col.precioUnitario ? String(row[col.precioUnitario] ?? '') : '';
      items.push({
        codigo:         col.codigo         ? String(row[col.codigo]         ?? '').trim() : '',
        descripcion,
        unidad:         col.unidad         ? (String(row[col.unidad]         ?? '').trim() || 'UND') : 'UND',
        cantidad:       col.cantidad        ? (parseFloat(row[col.cantidad])       || 0) : 0,
        precioUnitario: parseFloat(rawPrecio.replace(/[^0-9.-]/g, '')) || 0,
        tipo,
        _sheet: sheet.nombre,
      });
      count++;
    }

    sheetSummary.push({ nombre: sheet.nombre, tipo, total: count, razon: groqSheet.razon || '' });
  }

  logger.info(`[excel.analyzer] previewExcel: ${items.length} ítems extraídos`);
  return { sheets: sheetSummary, items };
};

module.exports = { analyzeExcel, confirmImport, previewExcel };
