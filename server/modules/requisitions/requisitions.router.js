const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const requisitionsService = require('./requisitions.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const requisitions = await requisitionsService.listRequisitions(req.user.companyId, req.query);
    ok(res, requisitions);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const requisition = await requisitionsService.getRequisition(req.user.companyId, req.params.id);
    ok(res, requisition);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const requisition = await requisitionsService.createRequisition(
      req.user.companyId,
      req.user.id,
      req.body
    );
    created(res, requisition);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/approve', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const requisition = await requisitionsService.approveRequisition(
      req.user.companyId,
      req.params.id,
      req.user.id
    );
    ok(res, requisition);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/reject', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { motivo } = req.body;
    const requisition = await requisitionsService.rejectRequisition(
      req.user.companyId,
      req.params.id,
      req.user.id,
      motivo
    );
    ok(res, requisition);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
