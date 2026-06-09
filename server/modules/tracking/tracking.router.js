const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const trackingService = require('./tracking.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const board = await trackingService.getTrackingBoard(req.user.companyId);
    ok(res, board);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
