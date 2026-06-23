const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const trackingService = require('./tracking.service');

router.use(verifyToken);

// Seguimiento general: requisiciones activas con su estado y sus OC
router.get('/', async (req, res, next) => {
  try {
    const board = await trackingService.getRequisitionsTracking(req.user.companyId);
    ok(res, board);
  } catch (err) {
    next(err);
  }
});

// Tablero de OC por fecha de entrega (semáforo de entregas)
router.get('/orders', async (req, res, next) => {
  try {
    const board = await trackingService.getTrackingBoard(req.user.companyId);
    ok(res, board);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
