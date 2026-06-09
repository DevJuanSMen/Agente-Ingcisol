const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const quotationsService = require('./quotations.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const quotations = await quotationsService.listQuotations(req.user.companyId);
    ok(res, quotations);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const quotation = await quotationsService.getQuotation(req.user.companyId, req.params.id);
    ok(res, quotation);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/winner', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { supplierId } = req.body;
    const quotation = await quotationsService.selectWinner(req.user.companyId, req.params.id, supplierId);
    ok(res, quotation);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
