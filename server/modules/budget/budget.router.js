const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requirePermission } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const budgetService = require('./budget.service');

router.use(verifyToken);

router.get('/:projectId/sheets', async (req, res, next) => {
  try {
    const sheets = await budgetService.listSheets(req.user.companyId, req.params.projectId);
    ok(res, sheets);
  } catch (err) { next(err); }
});

router.get('/:projectId/sheets/:sheetId', async (req, res, next) => {
  try {
    const sheet = await budgetService.getSheet(req.user.companyId, req.params.projectId, req.params.sheetId);
    ok(res, sheet);
  } catch (err) { next(err); }
});

router.post('/:projectId/sheets', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const { sheets } = req.body;
    if (!Array.isArray(sheets) || sheets.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere un array de hojas' });
    }
    const result = await budgetService.saveSheets(req.user.companyId, req.params.projectId, sheets);
    created(res, result);
  } catch (err) { next(err); }
});

router.delete('/:projectId/sheets/:sheetId', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    await budgetService.deleteSheet(req.user.companyId, req.params.projectId, req.params.sheetId);
    ok(res, { message: 'Hoja eliminada' });
  } catch (err) { next(err); }
});

router.post('/:projectId/sheets/:sheetId/import-apu', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const { colMap } = req.body;
    if (!colMap) return res.status(400).json({ error: true, message: 'Se requiere colMap' });
    const count = await budgetService.importSheetAsAPU(
      req.user.companyId, req.params.projectId, req.params.sheetId, colMap
    );
    ok(res, { count });
  } catch (err) { next(err); }
});

router.post('/:projectId/sheets/:sheetId/import-basics', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const { colMap } = req.body;
    if (!colMap) return res.status(400).json({ error: true, message: 'Se requiere colMap' });
    const count = await budgetService.importSheetAsBasicPrices(
      req.user.companyId, req.params.projectId, req.params.sheetId, colMap
    );
    ok(res, { count });
  } catch (err) { next(err); }
});

router.post('/:projectId/cross', async (req, res, next) => {
  try {
    const { sheet1Id, sheet2Id, keyCol1, keyCol2 } = req.body;
    if (!sheet1Id || !sheet2Id || !keyCol1 || !keyCol2) {
      return res.status(400).json({ error: true, message: 'Faltan parámetros: sheet1Id, sheet2Id, keyCol1, keyCol2' });
    }
    const result = await budgetService.crossReference(
      req.user.companyId, req.params.projectId, sheet1Id, sheet2Id, keyCol1, keyCol2
    );
    ok(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
