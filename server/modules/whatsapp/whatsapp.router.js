const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const redis = require('../../shared/redis');

router.use(verifyToken);
router.use(requireRole('DIRECTOR', 'APOYO_DIRECTOR'));

router.get('/status', async (req, res, next) => {
  try {
    const [enabled, status, qr] = await Promise.all([
      redis.get('whatsapp:enabled'),
      redis.get('whatsapp:status'),
      redis.get('whatsapp:qr'),
    ]);
    ok(res, {
      enabled: enabled === '1',
      status: status || 'disconnected',
      qr: qr || null,
    });
  } catch (err) { next(err); }
});

router.post('/enable', async (req, res, next) => {
  try {
    await redis.set('whatsapp:enabled', '1');
    ok(res, { enabled: true });
  } catch (err) { next(err); }
});

router.post('/disable', async (req, res, next) => {
  try {
    await redis.set('whatsapp:enabled', '0');
    ok(res, { enabled: false });
  } catch (err) { next(err); }
});

module.exports = router;
