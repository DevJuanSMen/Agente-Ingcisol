const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const svc = require('./basicprices.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const items = await svc.listBasicPrices(req.user.companyId, req.query.search);
    ok(res, items);
  } catch (err) { next(err); }
});

router.put('/', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const item = await svc.upsertBasicPrice(req.user.companyId, req.body);
    ok(res, item);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    await svc.deleteBasicPrice(req.user.companyId, req.params.id);
    ok(res, { message: 'Eliminado' });
  } catch (err) { next(err); }
});

module.exports = router;
