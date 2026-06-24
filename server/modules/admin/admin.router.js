const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireSuperadmin } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const adminService = require('./admin.service');

router.use(verifyToken);
router.use(requireSuperadmin);

router.get('/companies', async (req, res, next) => {
  try {
    ok(res, await adminService.listCompanies());
  } catch (err) { next(err); }
});

router.post('/companies/:id/bot/disable', async (req, res, next) => {
  try {
    ok(res, await adminService.disableBot(req.params.id));
  } catch (err) { next(err); }
});

router.post('/companies/:id/bot/enable', async (req, res, next) => {
  try {
    ok(res, await adminService.enableBot(req.params.id));
  } catch (err) { next(err); }
});

module.exports = router;
