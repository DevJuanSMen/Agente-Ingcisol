const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const { logger } = require('../../shared/utils/logger');
const apuService = require('./apu.service');
const { analyzeExcel, confirmImport } = require('./excel.analyzer');
const basicPricesSvc = require('../basicprices/basicprices.service');
const budgetSvc = require('../budget/budget.service');
const prisma = require('../../shared/db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

// Análisis IA — sube Excel, Groq mapea columnas, devuelve preview + sessionKey
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

module.exports = router;
