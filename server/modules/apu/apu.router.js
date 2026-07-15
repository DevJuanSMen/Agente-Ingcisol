const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requirePermission } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const { logger } = require('../../shared/utils/logger');
const apuService = require('./apu.service');
const { analyzeExcel, confirmImport, previewExcel } = require('./excel.analyzer');
const basicPricesSvc = require('../basicprices/basicprices.service');
const budgetSvc = require('../budget/budget.service');
const prisma = require('../../shared/db');
const { getGroq, GROQ_MODEL, GROQ_MODEL_FAST } = require('../../shared/utils/groq');

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
router.post('/', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const item = await apuService.createItem(req.user.companyId, req.body);
    ok(res, item);
  } catch (err) { next(err); }
});

// Import manual (legacy)
router.post('/import', requirePermission('budget', 'editar'), async (req, res, next) => {
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
router.post('/import-multi', requirePermission('budget', 'editar'), async (req, res, next) => {
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
  requirePermission('budget', 'editar'),
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
  requirePermission('budget', 'editar'),
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
router.post('/confirm', requirePermission('budget', 'editar'), async (req, res, next) => {
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

// Parsear PDF con IA — detecta estructura jerárquica APU (ítem + insumos)
router.post(
  '/parse-pdf',
  requirePermission('budget', 'editar'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo PDF' });

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
        return res.status(422).json({ error: true, message: 'El PDF no contiene texto extraíble.' });
      }

      const textSlice = pdfText.slice(0, 10000);
      const groq = getGroq();

      const completion = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{
          role: 'user',
          content: `Eres un experto en APU (Análisis de Precios Unitarios) de construcción en Colombia.
Analiza este texto extraído de un PDF. El documento puede contener:
1. Un PRESUPUESTO: lista de ítems APU con código, descripción, unidad, cantidad total, precio unitario
2. APUs DETALLADOS: cada APU muestra sus INSUMOS (materiales, mano de obra, equipo) con tipo, descripción, unidad, rendimiento y precio

Detecta el tipo y extrae la información con su jerarquía:

Texto del PDF:
${textSlice}

Instrucciones:
- Si detectas filas con TIPO (MATERIAL/M.DE OBRA/MANO DE OBRA/EQUIPO/HERRAMIENTA), esas son los insumos de un APU
- El capítulo es el título de agrupación (ej: "9. PISOS Y ACABADOS", "1. CIMENTACION")
- Para números: elimina puntos de miles y comas de decimales (ej: "29.900" → 29900, "$1.062.682" → 1062682)
- rendimiento: la cantidad del insumo por unidad de obra (puede llamarse REND, CANT, RENDIMIENTO)

Responde SOLO con JSON válido:
{
  "tipo": "PRESUPUESTO" | "APU_DETALLADO" | "MIXTO",
  "nota": "descripción breve del documento",
  "items": [
    {
      "codigo": "ACA-01",
      "descripcion": "Estuco y pintura en muros",
      "unidad": "m²",
      "cantidad": 12961.46,
      "precioUnitario": 24405,
      "capitulo": "9. PISOS Y ACABADOS",
      "tipo": "APU",
      "insumos": [
        {"tipo": "MATERIAL", "descripcion": "Estuco plástico en polvo (25 kg)", "unidad": "BOLSA", "rendimiento": 0.15, "precioUnitario": 29900, "precioTotal": 4485},
        {"tipo": "M_DE_OBRA", "descripcion": "Oficial [rend. 18 m²/día]", "unidad": "jornal", "rendimiento": 0.056, "precioUnitario": 68000, "precioTotal": 3808},
        {"tipo": "EQUIPO", "descripcion": "Herramienta menor (5% M.O.)", "unidad": "Global", "rendimiento": 0.05, "precioUnitario": 7076, "precioTotal": 354}
      ]
    }
  ]
}`,
        }],
        temperature: 0.1,
        max_tokens: 6000,
        response_format: { type: 'json_object' },
      });

      let result;
      try {
        result = JSON.parse(completion.choices[0].message.content);
      } catch {
        return res.status(500).json({ error: true, message: 'Error al interpretar la respuesta de IA' });
      }

      const items = (result.items || []).filter((i) => i.descripcion && i.descripcion.length > 2);
      logger.info(`[apu] PDF parseado: ${items.length} ítems (tipo: ${result.tipo})`);

      ok(res, { items, tipo: result.tipo || 'PRESUPUESTO', nota: result.nota || '', totalExtraidos: items.length });
    } catch (err) { next(err); }
  }
);

// Obtener insumos de un APU
router.get('/:id/insumos', async (req, res, next) => {
  try {
    const insumos = await prisma.itemAPUInsumo.findMany({
      where: { itemApuId: req.params.id },
      orderBy: { createdAt: 'asc' },
    });
    ok(res, insumos);
  } catch (err) { next(err); }
});

// Guardar/reemplazar insumos de un APU
router.put('/:id/insumos', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const { insumos } = req.body;
    if (!Array.isArray(insumos)) return res.status(400).json({ error: true, message: 'Se requiere array de insumos' });

    await prisma.$transaction(async (tx) => {
      await tx.itemAPUInsumo.deleteMany({ where: { itemApuId: req.params.id } });
      if (insumos.length > 0) {
        await tx.itemAPUInsumo.createMany({
          data: insumos.map((ins) => ({
            itemApuId:      req.params.id,
            tipo:           String(ins.tipo        || 'MATERIAL').toUpperCase(),
            descripcion:    String(ins.descripcion || '').trim(),
            unidad:         String(ins.unidad      || 'UND').trim() || 'UND',
            rendimiento:    parseFloat(ins.rendimiento)    || 0,
            precioUnitario: parseFloat(ins.precioUnitario) || 0,
            precioTotal:    parseFloat(ins.precioTotal)    || 0,
          })),
        });
      }
    });

    const updated = await prisma.itemAPUInsumo.findMany({ where: { itemApuId: req.params.id } });
    ok(res, updated);
  } catch (err) { next(err); }
});

module.exports = router;
