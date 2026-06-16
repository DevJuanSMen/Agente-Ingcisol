const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const { logger } = require('../../shared/utils/logger');
const apuService = require('./apu.service');
const { analyzeExcel, confirmImport, previewExcel } = require('./excel.analyzer');
const basicPricesSvc = require('../basicprices/basicprices.service');
const budgetSvc = require('../budget/budget.service');
const prisma = require('../../shared/db');
const { getGroq } = require('../../shared/utils/groq');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const tree = await apuService.getAPUTree(req.user.companyId);
    ok(res, tree);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const item = await apuService.getItem(req.user.companyId, req.params.id);
    ok(res, item);
  } catch (err) { next(err); }
});

// Crear ítem APU manual (no borra los existentes)
router.post('/', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const item = await apuService.createItem(req.user.companyId, req.body);
    ok(res, item);
  } catch (err) { next(err); }
});

// Import manual (legacy)
router.post('/import', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere un array de ítems' });
    }
    const count = await apuService.importAPU(req.user.companyId, items);
    ok(res, { message: `${count} ítems APU importados correctamente` });
  } catch (err) { next(err); }
});

// Importación multi-tipo desde PDF (APU + BASICOS, no PRESUPUESTO sin proyecto)
router.post('/import-multi', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere un array de ítems' });
    }

    const apuItems = items.filter((i) => i.tipo === 'APU' || !i.tipo);
    const basicItems = items.filter((i) => i.tipo === 'BASICOS');

    const counts = { apu: 0, basicos: 0 };
    if (apuItems.length) {
      counts.apu = await apuService.importAPU(req.user.companyId, apuItems);
    }
    if (basicItems.length) {
      counts.basicos = await basicPricesSvc.importBasicPrices(req.user.companyId, basicItems);
    }

    logger.info(`[apu] import-multi: ${counts.apu} APU + ${counts.basicos} básicos`);
    ok(res, { counts, total: counts.apu + counts.basicos });
  } catch (err) { next(err); }
});

// Preview Excel — Groq mapea columnas y devuelve TODAS las filas ya mapeadas para grilla de selección
router.post(
  '/preview-excel',
  requireRole('DIRECTOR', 'APOYO_DIRECTOR'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo Excel' });
      const result = await previewExcel(req.file.buffer);
      ok(res, result);
    } catch (err) { next(err); }
  }
);

// Análisis IA legacy — sube Excel, Groq mapea columnas, devuelve preview + sessionKey
router.post(
  '/analyze',
  requireRole('DIRECTOR', 'APOYO_DIRECTOR'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo Excel' });
      const result = await analyzeExcel(req.file.buffer);
      ok(res, result);
    } catch (err) { next(err); }
  }
);

// Confirmar importación — aplica mapeos y guarda en tablas respectivas
router.post('/confirm', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { sessionKey, confirmedSheets } = req.body;
    if (!sessionKey || !Array.isArray(confirmedSheets)) {
      return res.status(400).json({ error: true, message: 'Faltan sessionKey o confirmedSheets' });
    }

    const sheets = await confirmImport(sessionKey, confirmedSheets, req.user.companyId);

    const activeProject = await prisma.project.findFirst({
      where: { companyId: req.user.companyId, activo: true },
    });

    const resultados = [];

    for (const sheet of sheets) {
      const { tipo, columnas, filas, nombre } = sheet;

      if (tipo === 'APU') {
        const items = filas
          .map((r) => ({
            codigo: String(r[columnas.codigo] ?? '').trim(),
            descripcion: String(r[columnas.descripcion] ?? '').trim(),
            unidad: String(r[columnas.unidad] ?? 'GL').trim() || 'GL',
            cantidad: parseFloat(r[columnas.cantidad]) || 0,
            precioUnitario: parseFloat(r[columnas.precioUnitario]) || 0,
          }))
          .filter((i) => i.codigo && i.descripcion);

        const count = await apuService.importAPU(req.user.companyId, items);
        resultados.push({ nombre, tipo, count });

      } else if (tipo === 'BASICOS') {
        const items = filas
          .map((r) => ({
            codigo: String(r[columnas.codigo] ?? '').trim(),
            descripcion: String(r[columnas.descripcion] ?? '').trim(),
            unidad: String(r[columnas.unidad] ?? 'GL').trim() || 'GL',
            precioUnitario: parseFloat(r[columnas.precioUnitario]) || 0,
          }))
          .filter((i) => i.codigo && i.descripcion);

        const count = await basicPricesSvc.importBasicPrices(req.user.companyId, items);
        resultados.push({ nombre, tipo, count });

      } else if (tipo === 'PRESUPUESTO') {
        if (!activeProject) {
          resultados.push({ nombre, tipo, count: 0, error: 'No hay proyecto activo' });
          continue;
        }
        const headers = filas.length > 0 ? Object.keys(filas[0]) : [];
        await budgetSvc.saveSheets(req.user.companyId, activeProject.id, [
          { nombre, orden: 0, headers, filas },
        ]);
        resultados.push({ nombre, tipo, count: filas.length });

      } else {
        logger.info(`[apu.router] Hoja "${nombre}" tipo OTRO — omitida`);
        resultados.push({ nombre, tipo: 'OTRO', count: 0, omitida: true });
      }
    }

    ok(res, { resultados });
  } catch (err) { next(err); }
});

// Parsear PDF con IA — extrae filas de APU/presupuesto en texto libre
router.post(
  '/parse-pdf',
  requireRole('DIRECTOR', 'APOYO_DIRECTOR'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: true, message: 'Se requiere un archivo PDF' });
      }

      let pdfText = '';
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(req.file.buffer);
        pdfText = data.text || '';
      } catch (err) {
        logger.error('[apu] Error parseando PDF:', err.message);
        return res.status(422).json({ error: true, message: 'No se pudo leer el PDF. Verifica que no sea una imagen escaneada.' });
      }

      if (!pdfText.trim()) {
        return res.status(422).json({ error: true, message: 'El PDF no contiene texto extraíble (puede ser una imagen escaneada).' });
      }

      // Limitar texto para Groq (primeros ~8000 chars)
      const textSlice = pdfText.slice(0, 8000);

      const groq = getGroq();
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: `Eres un experto en presupuestos de construcción en Colombia. Analiza este texto extraído de un documento PDF (puede ser un APU, un presupuesto de obra, una lista de precios básicos, o una mezcla).

Texto del PDF:
${textSlice}

Extrae TODOS los ítems que puedas identificar. Para cada ítem extrae:
- codigo: código del ítem (ej: 1.1, 01.02, A-001, etc.) — puede ser nulo si no hay
- descripcion: descripción del trabajo, material o actividad
- unidad: unidad de medida (M3, ML, UND, M2, KG, GLB, etc.)
- cantidad: cantidad numérica (puede ser nula si es solo precio básico)
- precioUnitario: precio unitario en pesos colombianos (número sin símbolos, sin puntos de miles)
- tipo: "APU" si es un análisis de precio unitario, "BASICOS" si es un precio básico o insumo, "PRESUPUESTO" si es una actividad presupuestada

Responde SOLO con JSON válido:
{
  "items": [
    {"codigo": "1.1", "descripcion": "Excavación manual", "unidad": "M3", "cantidad": 50, "precioUnitario": 45000, "tipo": "APU"},
    ...
  ],
  "nota": "breve descripción del tipo de documento"
}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      });

      let result;
      try {
        result = JSON.parse(completion.choices[0].message.content);
      } catch {
        return res.status(500).json({ error: true, message: 'Error al interpretar la respuesta de IA' });
      }

      const items = (result.items || []).filter((i) => i.descripcion && i.descripcion.length > 2);
      logger.info(`[apu] PDF parseado: ${items.length} ítems extraídos`);

      ok(res, { items, nota: result.nota || '', totalExtraidos: items.length });
    } catch (err) { next(err); }
  }
);

module.exports = router;
