const XLSX = require('xlsx');
const { logger } = require('../../shared/utils/logger');

// ── Helpers numéricos / texto ──────────────────────────────────────────────────

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
const up = (v) => str(v).toUpperCase();

// Normaliza una descripción para casarla entre hojas (sin tildes, espacios ni signos)
const normalizeDesc = (v) =>
  up(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');

const normalizeCode = (v) => up(v).replace(/\s+/g, '');

// ── Detección flexible de "código de ítem" ─────────────────────────────────────
// Acepta tanto códigos alfanuméricos (PRE-01, CIM-V01, EST.05) como jerárquicos
// numéricos (1, 1.1, 01.02.03) y referencias cortas. Rechaza frases largas.
const looksLikeCode = (v) => {
  const s = str(v);
  if (!s) return false;
  if (s.length > 24) return false;
  // Frase descriptiva (varias palabras con letras) → no es código
  const palabras = s.split(/\s+/).filter(Boolean);
  if (palabras.length > 3) return false;
  // Patrón alfanumérico tipo prefijo-sufijo
  if (/^[A-Za-zÁÉÍÓÚÑ]{1,6}[-.\s]?[A-Za-z0-9][A-Za-z0-9.\-/]*$/.test(s)) return true;
  // Patrón jerárquico numérico (1, 1.1, 01.02.03, 1-2-3)
  if (/^\d{1,3}([.\-]\d{1,3}){0,4}[A-Za-z]?$/.test(s)) return true;
  return false;
};

// Capítulo en PRESUPUESTO: "  1. PRELIMINARES", "2. CIMENTACIÓN", "CAPÍTULO 3"
const CHAPTER_RE = /^\s*(?:CAP[IÍ]TULO\s*)?\d+[.)]?\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/;

// Normaliza el TIPO de insumo a los valores del enum del modelo
const normalizeTipo = (raw) => {
  const t = up(raw).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (t.startsWith('MATERIAL')) return 'MATERIAL';
  if (t.startsWith('M DE OBRA') || t.startsWith('MANO DE OBRA') || t === 'MDO' || t.startsWith('MO')) return 'M_DE_OBRA';
  if (t.startsWith('EQUIPO') || t.includes('HM') || t.startsWith('HERRAMIENTA') || t.startsWith('MAQUIN')) return 'EQUIPO';
  return 'OTRO';
};
const TIPO_LABELS = ['MATERIAL', 'M DE OBRA', 'MANO DE OBRA', 'MDO', 'EQUIPO/HM', 'EQUIPO', 'HERRAMIENTA', 'EQUIPO/HERRAMIENTA', 'TRANSPORTE'];
const isTipoRow = (v) => {
  const t = up(v).replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!t) return false;
  return TIPO_LABELS.some((l) => t.startsWith(l));
};

const sheetRows = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });

// ── Detección de encabezado y columnas por nombre (no por posición fija) ────────
const HEADER_HINTS = {
  codigo:        [/^C[OÓ]D/, /^[ÍI]?TEM/, /^ID$/, /REFERENC/, /^N[°º.]?$/],
  descripcion:   [/DESCRIP/, /CONCEPTO/, /ACTIVIDAD/, /DETALLE/, /MATERIAL/, /INSUMO/, /NOMBRE/],
  unidad:        [/^UND/, /UNIDAD/, /^U\.?M/, /MEDIDA/],
  cantidad:      [/CANTIDAD/, /^CANT/, /^QTY/],
  rendimiento:   [/RENDIM/, /^REND/, /DESPERD/, /CONSUMO/, /^FACTOR/],
  precioUnitario:[/UNIT/, /P\.?\s*U/, /VR?\.?\s*UN/, /VALOR\s*UNIT/, /PRECIO/],
  valorParcial:  [/PARCIAL/, /V\.?\s*TOTAL/, /VALOR\s*TOTAL/, /SUBTOTAL/, /^TOTAL/, /^VR?\.?\s*TOTAL/],
  tipo:          [/^TIPO/, /^CLASE/, /^GRUPO/],
  fuente:        [/FUENTE/, /OBSERV/, /PROVEEDOR/],
};

// Devuelve { headerIdx, cols } con el índice de columna detectado para cada campo
// (o -1). Escanea las primeras filas buscando la que más encabezados reconoce.
const detectColumns = (rows, maxScan = 15) => {
  let best = { headerIdx: -1, score: 0, cols: {} };
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const cells = rows[i].map((c) => up(c));
    const cols = {};
    let score = 0;
    for (const [field, patterns] of Object.entries(HEADER_HINTS)) {
      const idx = cells.findIndex((c) => c && patterns.some((p) => p.test(c)));
      if (idx >= 0) { cols[field] = idx; score += 1; }
    }
    if (score > best.score) best = { headerIdx: i, score, cols };
  }
  return best.score >= 2 ? best : null;
};

// ── Parser: hoja PRESUPUESTO ──────────────────────────────────────────────────
// Lista maestra: [{ codigo, descripcion, unidad, cantidad, precioUnitario, capitulo }]
const parsePresupuesto = (ws) => {
  const rows = sheetRows(ws);
  const det = detectColumns(rows);
  // Columnas (detectadas o por defecto del formato base)
  const c = det?.cols || {};
  const cCod = c.codigo ?? 1;
  const cDesc = c.descripcion ?? 2;
  const cUnd = c.unidad ?? 3;
  const cCant = c.cantidad ?? 4;
  const cVUnit = c.precioUnitario ?? 5;
  const startRow = det ? det.headerIdx + 1 : 0;

  const items = [];
  let capitulo = '';

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    const cod = str(row[cCod]);
    const colA = str(row[0]);
    const desc = str(row[cDesc]);
    const und = str(row[cUnd]);
    const cant = num(row[cCant]);
    const pu = num(row[cVUnit]);

    // Subtotales / totales
    if (up(colA).startsWith('SUBTOTAL') || up(colA).startsWith('TOTAL') || up(cod).startsWith('TOTAL')) continue;

    // Capítulo de un solo cell ("1. PRELIMINARES")
    if ((CHAPTER_RE.test(colA) || CHAPTER_RE.test(desc)) && !looksLikeCode(cod)) {
      capitulo = (CHAPTER_RE.test(colA) ? colA : desc).trim();
      continue;
    }

    // Un ítem real tiene unidad, cantidad o precio. Si solo hay código + descripción
    // (sin und/cant/precio) es un encabezado de capítulo.
    const esItem = looksLikeCode(cod) && desc && (!!und || cant > 0 || pu > 0);
    if (looksLikeCode(cod) && desc && !esItem) {
      capitulo = desc;
      continue;
    }

    if (esItem) {
      items.push({
        codigo: normalizeCode(cod),
        descripcion: desc,
        unidad: und || 'UND',
        cantidad: cant,
        precioUnitario: pu,
        capitulo,
      });
    }
  }
  return items;
};

// ── Parser genérico de bloques (APUs / BASICOS) ────────────────────────────────
// Un bloque = fila de código → (fila TIPO cabecera) → insumos → fila de total.
// `codeCol` es la columna donde aparecen el código del bloque y los TIPO de insumo.
const parseBlocks = (ws, { defaultCodeCol }) => {
  const rows = sheetRows(ws);
  const det = detectColumns(rows);
  const c = det?.cols || {};
  // La columna de código/tipo: la de TIPO si se detectó, si no la de código, si no el default
  const cCode = c.tipo ?? c.codigo ?? defaultCodeCol;
  const cDesc = c.descripcion ?? (defaultCodeCol + 1);
  const cUnd = c.unidad ?? (defaultCodeCol + 2);
  const cRend = c.rendimiento ?? (defaultCodeCol + 3);
  const cVUnit = c.precioUnitario ?? (defaultCodeCol + 4);
  const cVParcial = c.valorParcial ?? (defaultCodeCol + 5);

  const blocks = [];
  let current = null;

  for (const row of rows) {
    const key = str(row[cCode]);
    const keyUp = up(key);

    // Fila de cabecera "TIPO" → ignorar
    if (keyUp === 'TIPO') continue;
    // Fila de total del bloque
    if (keyUp.startsWith('COSTO UNITARIO') || keyUp.startsWith('VALOR UNITARIO') || keyUp.startsWith('TOTAL')) {
      if (current) current.precioUnitario = num(row[cVParcial]) || num(row[cVUnit]) || current.precioUnitario;
      continue;
    }

    // Insumo (la fila empieza con un TIPO conocido)
    if (isTipoRow(key)) {
      if (!current) continue;
      const desc = str(row[cDesc]);
      if (!desc) continue;
      current.insumos.push({
        tipo: normalizeTipo(key),
        descripcion: desc,
        unidad: str(row[cUnd]) || 'UND',
        rendimiento: num(row[cRend]),
        precioUnitario: num(row[cVUnit]),
        precioTotal: num(row[cVParcial]),
      });
      continue;
    }

    // Inicio de un bloque: código válido con descripción
    if (looksLikeCode(key) && str(row[cDesc])) {
      if (current) blocks.push(current);
      current = {
        codigo: normalizeCode(key),
        descripcion: str(row[cDesc]),
        unidad: str(row[cVParcial]) || str(row[cUnd]) || 'UND',
        precioUnitario: 0,
        insumos: [],
      };
    }
  }
  if (current) blocks.push(current);
  return blocks;
};

// ── Parser: hoja INSUMOS (lista plana de materiales) ───────────────────────────
const parseInsumos = (ws) => {
  const rows = sheetRows(ws);
  const det = detectColumns(rows);
  if (!det) return [];
  const { headerIdx, cols } = det;
  const cDesc = cols.descripcion ?? 1;
  const cUnd = cols.unidad ?? cDesc + 1;
  const cPrecio = cols.precioUnitario ?? cols.valorParcial ?? cDesc + 2;
  const cFuente = cols.fuente ?? -1;

  const insumos = [];
  let n = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const descripcion = str(row[cDesc]);
    const precio = num(row[cPrecio]);
    // Filas de sección "▌ CIMENTACIÓN..." o sin precio no son insumos
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

// ── Detección de hoja por nombre flexible + por contenido ──────────────────────
const findSheetByName = (wb, ...candidates) => {
  const clean = (s) => up(s).replace(/\s+/g, '').replace(/\.+/g, '');
  for (const name of wb.SheetNames) {
    for (const cand of candidates) if (clean(name) === clean(cand)) return { name, ws: wb.Sheets[name] };
  }
  for (const name of wb.SheetNames) {
    for (const cand of candidates) if (up(name).includes(up(cand))) return { name, ws: wb.Sheets[name] };
  }
  return null;
};

// Clasifica una hoja por su contenido cuando el nombre no ayuda.
// APU/BASICOS tienen filas TIPO (MATERIAL/M.OBRA/EQUIPO); PRESUPUESTO tiene
// muchos códigos con cantidad y precio; INSUMOS es una lista plana con precios.
const classifySheetByContent = (ws) => {
  const rows = sheetRows(ws).slice(0, 200);
  let tipoRows = 0, codeRows = 0, costoRows = 0;
  for (const row of rows) {
    if (row.some((cell) => isTipoRow(cell))) tipoRows += 1;
    if (row.some((cell) => looksLikeCode(cell))) codeRows += 1;
    if (row.some((cell) => up(cell).startsWith('COSTO UNITARIO'))) costoRows += 1;
  }
  if (tipoRows >= 3 && costoRows >= 1) return 'APUS';
  if (codeRows >= 5 && tipoRows < 2) return 'PRESUPUESTO';
  return null;
};

// ── Entrada principal ─────────────────────────────────────────────────────────
const parseMasterFile = (buffer) => {
  const wb = XLSX.read(buffer, { type: 'buffer' });

  let presupuestoSheet = findSheetByName(wb, 'PRESUPUESTO', 'PPTO');
  let apusSheet = findSheetByName(wb, 'APUs', 'APU', 'ANALISIS', 'ANÁLISIS');
  const basicosSheet = findSheetByName(wb, 'BASICOS', 'BASICO', 'BÁSICOS');
  const insumosSheet = findSheetByName(wb, 'INSUMOS', 'MATERIALES', 'PRECIOS');

  // Respaldo por contenido si faltan las hojas clave
  if (!presupuestoSheet || !apusSheet) {
    const usados = new Set([presupuestoSheet?.name, apusSheet?.name, basicosSheet?.name, insumosSheet?.name]);
    for (const name of wb.SheetNames) {
      if (usados.has(name)) continue;
      const tipo = classifySheetByContent(wb.Sheets[name]);
      if (tipo === 'PRESUPUESTO' && !presupuestoSheet) { presupuestoSheet = { name, ws: wb.Sheets[name] }; usados.add(name); }
      else if (tipo === 'APUS' && !apusSheet) { apusSheet = { name, ws: wb.Sheets[name] }; usados.add(name); }
    }
  }

  const presupuesto = presupuestoSheet ? parsePresupuesto(presupuestoSheet.ws) : [];
  const apus = apusSheet ? parseBlocks(apusSheet.ws, { defaultCodeCol: 1 }) : [];
  const basicos = basicosSheet ? parseBlocks(basicosSheet.ws, { defaultCodeCol: 0 }) : [];
  const insumos = insumosSheet ? parseInsumos(insumosSheet.ws) : [];

  // ── Cruce robusto presupuesto ↔ APUs ─────────────────────────────────────────
  // Índices de APUs por código y por descripción normalizada (respaldo).
  const apuByCode = new Map();
  const apuByDesc = new Map();
  for (const a of apus) {
    apuByCode.set(a.codigo, a);
    const k = normalizeDesc(a.descripcion);
    if (k && !apuByDesc.has(k)) apuByDesc.set(k, a);
  }

  const apuItems = [];
  const usedApu = new Set();

  // 1) El presupuesto es la lista maestra; cada ítem se enriquece con los insumos
  //    de su APU (casado por código y, si falla, por descripción).
  for (const p of presupuesto) {
    let match = apuByCode.get(p.codigo);
    if (!match) match = apuByDesc.get(normalizeDesc(p.descripcion));
    if (match) usedApu.add(match.codigo);
    apuItems.push({
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad: p.unidad || match?.unidad || 'UND',
      capitulo: p.capitulo || '',
      cantidad: p.cantidad,
      precioUnitario: p.precioUnitario || match?.precioUnitario || 0,
      insumos: match?.insumos || [],
    });
  }

  // 2) APUs que existen en la hoja APUs pero no aparecieron en el presupuesto.
  for (const a of apus) {
    if (usedApu.has(a.codigo)) continue;
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

  // Precios básicos = básicos compuestos (los insumos simples van aparte vía parseInsumos)
  const basicPrices = basicos.map((b) => ({
    codigo: b.codigo,
    descripcion: b.descripcion,
    unidad: b.unidad,
    precioUnitario: b.precioUnitario,
    fuente: 'BASICO',
    insumos: b.insumos,
  }));

  const apuConInsumos = apuItems.filter((i) => i.insumos.length > 0).length;

  logger.info(
    `[master.parser] PRESUPUESTO=${presupuesto.length} APUs=${apus.length} BASICOS=${basicos.length} INSUMOS=${insumos.length} → apuItems=${apuItems.length} conInsumos=${apuConInsumos}`
  );

  return {
    sheetsDetectadas: {
      presupuesto: presupuestoSheet?.name || null,
      apus: apusSheet?.name || null,
      basicos: basicosSheet?.name || null,
      insumos: insumosSheet?.name || null,
    },
    apuItems, // → ItemAPU (+ ItemAPUInsumo)
    basicPrices, // → BasicPrice (compuestos)
    insumos, // → BasicPrice (simples)
    resumen: {
      apu: apuItems.length,
      apuConInsumos,
      apuSinInsumos: apuItems.length - apuConInsumos,
      basicos: basicPrices.length,
      insumos: insumos.length,
    },
  };
};

module.exports = { parseMasterFile };
