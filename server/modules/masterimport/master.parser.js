const XLSX = require('xlsx');
const { logger } = require('../../shared/utils/logger');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Convierte cualquier celda numérica/texto a número (limpia separadores COP)
const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$\s]/g, '');
  // Si tiene punto y coma juntos asumimos formato es-CO ("1.062.682,50")
  if (s.includes('.') && s.includes(',')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  // Solo comas → decimal
  if (s.includes(',') && !s.includes('.')) {
    return parseFloat(s.replace(',', '.')) || 0;
  }
  return parseFloat(s) || 0;
};

const str = (v) => String(v ?? '').replace(/\r?\n/g, ' ').trim();

// Código de actividad APU: PRE-01, CIM-01, URB-V01, EST-05...
const CODE_RE = /^[A-Z]{2,5}-[A-Z0-9][A-Z0-9.]*$/i;
const isCode = (v) => CODE_RE.test(str(v));

// Capítulo en PRESUPUESTO: "  1. PRELIMINARES", "2. CIMENTACIÓN"
const CHAPTER_RE = /^\s*\d+\.\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/;

// Normaliza el TIPO de insumo a los valores del enum del modelo
const normalizeTipo = (raw) => {
  const t = str(raw).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (t.startsWith('MATERIAL')) return 'MATERIAL';
  if (t.startsWith('M DE OBRA') || t.startsWith('MANO DE OBRA') || t === 'MDO') return 'M_DE_OBRA';
  if (t.startsWith('EQUIPO') || t.includes('HM') || t.startsWith('HERRAMIENTA')) return 'EQUIPO';
  return 'OTRO';
};
const TIPO_LABELS = ['MATERIAL', 'M. DE OBRA', 'M.DE OBRA', 'MANO DE OBRA', 'EQUIPO/HM', 'EQUIPO', 'HERRAMIENTA'];
const isTipoRow = (v) => {
  const t = str(v).toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  return TIPO_LABELS.some((l) => t.startsWith(l.toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ')));
};

const sheetRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

// ── Parser: hoja PRESUPUESTO ──────────────────────────────────────────────────
// Devuelve la lista maestra: [{ codigo, descripcion, unidad, cantidad, precioUnitario, capitulo }]
const parsePresupuesto = (ws) => {
  const rows = sheetRows(ws);
  const items = [];
  let capitulo = '';

  for (const row of rows) {
    const a = str(row[0]);   // N° o nombre de capítulo
    const b = str(row[1]);   // CÓDIGO

    // Capítulo: col A con "1. PRELIMINARES" y sin código en col B
    if (CHAPTER_RE.test(a) && !isCode(b)) {
      capitulo = a.trim();
      continue;
    }
    // Subtotales / totales
    if (a.toUpperCase().startsWith('SUBTOTAL') || a.toUpperCase().startsWith('TOTAL')) continue;

    // Ítem: col B tiene código válido
    if (isCode(b)) {
      const descripcion = str(row[2]);
      if (!descripcion) continue;
      items.push({
        codigo: str(b).toUpperCase(),
        descripcion,
        unidad: str(row[3]) || 'UND',
        cantidad: num(row[4]),
        precioUnitario: num(row[5]),
        capitulo,
      });
    }
  }
  return items;
};

// ── Parser: hoja APUs ─────────────────────────────────────────────────────────
// Cada APU es un bloque: fila código → fila TIPO (header) → insumos → COSTO UNITARIO TOTAL
// Estructura de columnas (0-index): B=código/tipo(1), C=descripcion(2), D=und(3), E=rend(4), F=v.unit(5), G=v.parcial/unidad(6)
const parseApus = (ws) => {
  const rows = sheetRows(ws);
  const apus = [];
  let current = null;

  for (const row of rows) {
    const b = str(row[1]);

    // Inicio de un APU
    if (isCode(b)) {
      if (current) apus.push(current);
      current = {
        codigo: b.toUpperCase(),
        descripcion: str(row[2]),
        unidad: str(row[6]) || 'UND',   // la unidad del APU va en la col G de la fila título
        precioUnitario: 0,
        insumos: [],
      };
      continue;
    }
    if (!current) continue;

    const bUpper = b.toUpperCase();
    // Fila de cabecera "TIPO ..." → ignorar
    if (bUpper === 'TIPO') continue;
    // Fila de total
    if (bUpper.startsWith('COSTO UNITARIO')) {
      current.precioUnitario = num(row[6]);
      continue;
    }
    // Insumo
    if (isTipoRow(b)) {
      const descripcion = str(row[2]);
      if (!descripcion) continue;
      current.insumos.push({
        tipo: normalizeTipo(b),
        descripcion,
        unidad: str(row[3]) || 'UND',
        rendimiento: num(row[4]),
        precioUnitario: num(row[5]),
        precioTotal: num(row[6]),
      });
    }
  }
  if (current) apus.push(current);
  return apus;
};

// ── Parser: hoja BASICOS ──────────────────────────────────────────────────────
// Bloques BASICO-N. Columnas (0-index): A=código/tipo(0), B=descripcion(1), C=und(2), D=rend(3), E=v.unit(4), F=v.parcial/unidad(5)
const BASIC_RE = /^BASICO-\d+/i;
const parseBasicos = (ws) => {
  const rows = sheetRows(ws);
  const basicos = [];
  let current = null;

  for (const row of rows) {
    const a = str(row[0]);

    if (BASIC_RE.test(a)) {
      if (current) basicos.push(current);
      current = {
        codigo: a.toUpperCase(),
        descripcion: str(row[1]),
        unidad: str(row[5]) || 'UND',
        precioUnitario: 0,
        insumos: [],
      };
      continue;
    }
    if (!current) continue;

    const aUpper = a.toUpperCase();
    if (aUpper === 'TIPO') continue;
    if (aUpper.startsWith('COSTO UNITARIO')) {
      current.precioUnitario = num(row[5]);
      continue;
    }
    if (isTipoRow(a)) {
      const descripcion = str(row[1]);
      if (!descripcion) continue;
      current.insumos.push({
        tipo: normalizeTipo(a),
        descripcion,
        unidad: str(row[2]) || 'UND',
        rendimiento: num(row[3]),
        precioUnitario: num(row[4]),
        precioTotal: num(row[5]),
      });
    }
  }
  if (current) basicos.push(current);
  return basicos;
};

// ── Parser: hoja INSUMOS ──────────────────────────────────────────────────────
// Lista plana de materiales. Detecta fila de encabezado y mapea columnas por nombre.
// Estructura típica: N° | DESCRIPCIÓN | UND | PRECIO UND | FUENTE
const parseInsumos = (ws) => {
  const rows = sheetRows(ws);

  // Buscar fila de encabezado (contiene "DESCRIPCIÓN" y "PRECIO")
  let headerIdx = -1, cDesc = 1, cUnd = 2, cPrecio = 3, cFuente = 4;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const upper = rows[i].map((c) => str(c).toUpperCase());
    const descI = upper.findIndex((c) => c.includes('DESCRIPCIÓN') || c.includes('DESCRIPCION') || c.includes('MATERIAL'));
    const precioI = upper.findIndex((c) => c.includes('PRECIO'));
    if (descI >= 0 && precioI >= 0) {
      headerIdx = i;
      cDesc = descI;
      cPrecio = precioI;
      cUnd = upper.findIndex((c) => c === 'UND' || c === 'UNIDAD' || c.includes('UND'));
      cFuente = upper.findIndex((c) => c.includes('FUENTE') || c.includes('OBSERV'));
      if (cUnd < 0) cUnd = cDesc + 1;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const insumos = [];
  let n = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const descripcion = str(row[cDesc]);
    const precio = num(row[cPrecio]);
    // Filas de sección "▌ CIMENTACIÓN..." no tienen precio
    if (!descripcion || descripcion.startsWith('▌') || precio <= 0) continue;
    n += 1;
    insumos.push({
      codigo: 'INS-' + String(n).padStart(3, '0'),
      descripcion,
      unidad: (cUnd >= 0 ? str(row[cUnd]) : 'UND') || 'UND',
      precioUnitario: precio,
      fuente: cFuente >= 0 ? str(row[cFuente]) : '',
    });
  }
  return insumos;
};

// ── Buscar hoja por nombre flexible ───────────────────────────────────────────
const findSheet = (wb, ...candidates) => {
  for (const name of wb.SheetNames) {
    const clean = name.toUpperCase().replace(/\s+/g, '').replace(/\.+/g, '');
    for (const cand of candidates) {
      const cc = cand.toUpperCase().replace(/\s+/g, '').replace(/\.+/g, '');
      if (clean === cc) return { name, ws: wb.Sheets[name] };
    }
  }
  // Coincidencia parcial como respaldo
  for (const name of wb.SheetNames) {
    const clean = name.toUpperCase();
    for (const cand of candidates) {
      if (clean.includes(cand.toUpperCase())) return { name, ws: wb.Sheets[name] };
    }
  }
  return null;
};

// ── Entrada principal ─────────────────────────────────────────────────────────
const parseMasterFile = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  const presupuestoSheet = findSheet(wb, 'PRESUPUESTO');
  const apusSheet        = findSheet(wb, 'APUs', 'APU');
  const basicosSheet     = findSheet(wb, 'BASICOS', 'BASICO');
  const insumosSheet     = findSheet(wb, 'INSUMOS');

  const presupuesto = presupuestoSheet ? parsePresupuesto(presupuestoSheet.ws) : [];
  const apus        = apusSheet        ? parseApus(apusSheet.ws)               : [];
  const basicos     = basicosSheet     ? parseBasicos(basicosSheet.ws)         : [];
  const insumos     = insumosSheet     ? parseInsumos(insumosSheet.ws)         : [];

  // Cruce: el PRESUPUESTO es la lista maestra de ítems APU; los insumos vienen de la hoja APUs.
  const apuInsumosMap = new Map();
  for (const a of apus) apuInsumosMap.set(a.codigo, a);

  // Construir ítems APU finales: parte del presupuesto, completa con insumos de APUs
  const apuItems = [];
  const seen = new Set();
  for (const p of presupuesto) {
    const apuMatch = apuInsumosMap.get(p.codigo);
    apuItems.push({
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad: p.unidad || apuMatch?.unidad || 'UND',
      capitulo: p.capitulo || '',
      cantidad: p.cantidad,
      // El precio del presupuesto manda; si falta, usar el total del APU
      precioUnitario: p.precioUnitario || apuMatch?.precioUnitario || 0,
      insumos: apuMatch?.insumos || [],
    });
    seen.add(p.codigo);
  }
  // APUs presentes en la hoja APUs pero no en PRESUPUESTO (cantidad desconocida)
  for (const a of apus) {
    if (seen.has(a.codigo)) continue;
    apuItems.push({
      codigo: a.codigo,
      descripcion: a.descripcion,
      unidad: a.unidad || 'UND',
      capitulo: '',
      cantidad: 0,
      precioUnitario: a.precioUnitario || 0,
      insumos: a.insumos || [],
    });
  }

  // Precios básicos = básicos compuestos + insumos simples (todos van a la tabla BasicPrice)
  const basicPrices = [
    ...basicos.map((b) => ({
      codigo: b.codigo,
      descripcion: b.descripcion,
      unidad: b.unidad,
      precioUnitario: b.precioUnitario,
      fuente: 'BASICO',
      insumos: b.insumos,
    })),
  ];

  logger.info(
    `[master.parser] PRESUPUESTO=${presupuesto.length} APUs=${apus.length} BASICOS=${basicos.length} INSUMOS=${insumos.length} → apuItems=${apuItems.length}`
  );

  return {
    sheetsDetectadas: {
      presupuesto: presupuestoSheet?.name || null,
      apus: apusSheet?.name || null,
      basicos: basicosSheet?.name || null,
      insumos: insumosSheet?.name || null,
    },
    apuItems,      // → ItemAPU (+ ItemAPUInsumo)
    basicPrices,   // → BasicPrice (compuestos)
    insumos,       // → BasicPrice (simples)
    resumen: {
      apu: apuItems.length,
      apuConInsumos: apuItems.filter((i) => i.insumos.length > 0).length,
      basicos: basicPrices.length,
      insumos: insumos.length,
    },
  };
};

module.exports = { parseMasterFile };
