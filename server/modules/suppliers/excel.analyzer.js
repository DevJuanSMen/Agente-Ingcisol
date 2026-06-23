const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { getGroq } = require('../../shared/utils/groq');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');

const SESSION_TTL = 900; // 15 minutos

const SEGMENTOS = ['MATERIALES', 'EQUIPOS', 'HERRAMIENTAS', 'SERVICIOS'];

const parseExcel = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  // Para proveedores se toma la primera hoja con datos
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '' });
    if (filas.length > 0) {
      return { nombre, headers: Object.keys(filas[0]), filas, preview: filas.slice(0, 5) };
    }
  }
  return null;
};

const buildGroqPrompt = (sheet) => {
  const sampleRows = sheet.preview.slice(0, 3).map((r) => JSON.stringify(r)).join('\n');

  return `Eres un experto en compras y proveedores del sector construcción en Colombia. Analiza esta hoja de Excel con una base de datos de proveedores. Las columnas pueden tener cualquier nombre y estar en cualquier orden.

Hoja: "${sheet.nombre}"
Columnas: ${sheet.headers.join(', ')}
Primeras filas:
${sampleRows}

Mapea las columnas al esquema interno (usa el nombre EXACTO de la columna del Excel, o null si no existe):
- nombre: razón social o nombre del proveedor (obligatorio)
- nit: NIT, RUT o identificación tributaria
- ciudad: ciudad o municipio
- whatsapp: celular, móvil o número de WhatsApp
- email: correo electrónico
- segmento: tipo de proveedor (materiales, equipos, herramientas, servicios)

Responde SOLO con JSON válido, sin texto adicional:
{
  "columnas": {
    "nombre": "nombre exacto columna o null",
    "nit": "nombre exacto columna o null",
    "ciudad": "nombre exacto columna o null",
    "whatsapp": "nombre exacto columna o null",
    "email": "nombre exacto columna o null",
    "segmento": "nombre exacto columna o null"
  },
  "razon": "explicación breve en español del mapeo detectado"
}`;
};

// Normaliza valores libres de segmento al enum interno
const normalizeSegmento = (raw) => {
  const v = String(raw || '').toUpperCase().trim();
  if (!v) return 'MATERIALES';
  if (SEGMENTOS.includes(v)) return v;
  if (/EQUIP|MAQUIN|ALQUIL/.test(v)) return 'EQUIPOS';
  if (/HERRAM/.test(v)) return 'HERRAMIENTAS';
  if (/SERVIC|TRANSPOR|MANO DE OBRA|INSTALA/.test(v)) return 'SERVICIOS';
  return 'MATERIALES';
};

const analyzeSuppliersExcel = async (buffer) => {
  const sheet = parseExcel(buffer);
  if (!sheet) throw Object.assign(new Error('El archivo no contiene datos'), { statusCode: 400 });

  const groq = getGroq();
  logger.info(`[suppliers.analyzer] Enviando hoja "${sheet.nombre}" (${sheet.filas.length} filas) a Groq`);

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: buildGroqPrompt(sheet) }],
    temperature: 0.1,
    max_tokens: 600,
    response_format: { type: 'json_object' },
  });

  let analysis;
  try {
    analysis = JSON.parse(completion.choices[0].message.content);
  } catch {
    logger.error('[suppliers.analyzer] Groq devolvió JSON inválido');
    throw Object.assign(new Error('Error al interpretar la respuesta de IA'), { statusCode: 500 });
  }

  const sessionKey = uuidv4();
  const sessionData = {
    nombre: sheet.nombre,
    headers: sheet.headers,
    filas: sheet.filas,
    columnas: analysis.columnas || {},
    razon: analysis.razon || '',
  };

  await redis.set(`suppliers:session:${sessionKey}`, JSON.stringify(sessionData), 'EX', SESSION_TTL);
  logger.info(`[suppliers.analyzer] Sesión creada: ${sessionKey}`);

  return {
    sessionKey,
    hoja: sheet.nombre,
    totalFilas: sheet.filas.length,
    headers: sheet.headers,
    columnas: sessionData.columnas,
    razon: sessionData.razon,
    preview: sheet.preview,
  };
};

// Devuelve TODAS las filas ya mapeadas para mostrarlas en una grilla editable
// (sin sesión Redis: el front edita las filas y las reenvía a /import).
const previewSuppliersExcel = async (buffer) => {
  const sheet = parseExcel(buffer);
  if (!sheet) throw Object.assign(new Error('El archivo no contiene datos'), { statusCode: 400 });

  const groq = getGroq();
  logger.info(`[suppliers.analyzer] previewSuppliersExcel: hoja "${sheet.nombre}" (${sheet.filas.length} filas)`);

  let columnas = {};
  let razon = '';
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: buildGroqPrompt(sheet) }],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const analysis = JSON.parse(completion.choices[0].message.content);
    columnas = analysis.columnas || {};
    razon = analysis.razon || '';
  } catch (err) {
    // Si la IA falla, intentamos un mapeo heurístico por nombre de columna
    logger.warn('[suppliers.analyzer] Groq falló, usando mapeo heurístico:', err.message);
    columnas = heuristicMap(sheet.headers);
  }

  // Si la IA no detectó la columna del nombre, completar con heurística
  if (!columnas.nombre) {
    const fallback = heuristicMap(sheet.headers);
    columnas = { ...fallback, ...Object.fromEntries(Object.entries(columnas).filter(([, v]) => v)) };
  }

  const rows = mapRows(sheet.filas, columnas);

  return {
    hoja: sheet.nombre,
    totalFilas: rows.length,
    headers: sheet.headers,
    columnas,
    razon,
    rows,
  };
};

// Mapeo heurístico de columnas por nombre (respaldo si la IA falla)
const heuristicMap = (headers) => {
  const find = (...patterns) =>
    headers.find((h) => patterns.some((p) => p.test(String(h).toUpperCase()))) || null;
  return {
    nombre:   find(/NOMBRE|RAZ[OÓ]N|PROVEEDOR|EMPRESA/),
    nit:      find(/NIT|RUT|IDENTIFIC|C[EÉ]DULA|DOCUMENTO/),
    ciudad:   find(/CIUDAD|MUNICIPIO|UBICAC/),
    whatsapp: find(/WHATSAPP|CELULAR|M[OÓ]VIL|MOVIL|TEL[EÉ]FONO|CONTACTO/),
    email:    find(/EMAIL|CORREO|MAIL/),
    segmento: find(/SEGMENTO|TIPO|CATEGOR[IÍ]A|RUBRO|L[IÍ]NEA/),
  };
};

// Aplica el mapeo a todas las filas → registros de proveedor
const mapRows = (filas, map) =>
  filas
    .map((r) => ({
      nombre:   map.nombre ? String(r[map.nombre] ?? '').trim() : '',
      nit:      map.nit && r[map.nit] ? String(r[map.nit]).trim() : '',
      ciudad:   map.ciudad && r[map.ciudad] ? String(r[map.ciudad]).trim() : '',
      whatsapp: map.whatsapp && r[map.whatsapp] ? String(r[map.whatsapp]).trim() : '',
      email:    map.email && r[map.email] ? String(r[map.email]).trim() : '',
      segmento: normalizeSegmento(map.segmento ? r[map.segmento] : null),
    }))
    .filter((s) => s.nombre);

const confirmSuppliersImport = async (sessionKey, columnas) => {
  const raw = await redis.get(`suppliers:session:${sessionKey}`);
  if (!raw) throw Object.assign(new Error('Sesión expirada o inválida. Sube el archivo nuevamente.'), { statusCode: 400 });

  const session = JSON.parse(raw);
  await redis.del(`suppliers:session:${sessionKey}`);

  const map = columnas || session.columnas;
  if (!map.nombre) throw Object.assign(new Error('Debes indicar la columna del nombre del proveedor'), { statusCode: 400 });

  return session.filas
    .map((r) => ({
      nombre: String(r[map.nombre] ?? '').trim(),
      nit: map.nit && r[map.nit] ? String(r[map.nit]).trim() : null,
      ciudad: map.ciudad && r[map.ciudad] ? String(r[map.ciudad]).trim() : null,
      whatsapp: map.whatsapp && r[map.whatsapp] ? String(r[map.whatsapp]).trim() : null,
      email: map.email && r[map.email] ? String(r[map.email]).trim() : null,
      segmento: normalizeSegmento(map.segmento ? r[map.segmento] : null),
    }))
    .filter((s) => s.nombre);
};

module.exports = { analyzeSuppliersExcel, confirmSuppliersImport, previewSuppliersExcel, normalizeSegmento };
