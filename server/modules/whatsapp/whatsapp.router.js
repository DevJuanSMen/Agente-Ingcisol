const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const redis = require('../../shared/redis');
const { publishCommand } = require('./bot.ipc');

router.use(verifyToken);
router.use(requireRole('DIRECTOR', 'APOYO_DIRECTOR'));

const keys = (companyId) => ({
  qr: `whatsapp:${companyId}:qr`,
  status: `whatsapp:${companyId}:status`,
  enabled: `whatsapp:${companyId}:enabled`,
});

router.get('/status', async (req, res, next) => {
  try {
    const k = keys(req.user.companyId);
    const [enabled, status, qr] = await Promise.all([
      redis.get(k.enabled),
      redis.get(k.status),
      redis.get(k.qr),
    ]);
    ok(res, {
      enabled: enabled === '1',
      status: status || 'disconnected',
      qr: qr || null,
    });
  } catch (err) { next(err); }
});

// Inicia la sesión WhatsApp de esta empresa. La vinculación es siempre por QR,
// que se genera bajo petición desde el panel.
router.post('/connect', async (req, res, next) => {
  try {
    // Marcar 'connecting' de inmediato para que el panel empiece a hacer polling
    // sin esperar al worker (antes quedaba 'disconnected' hasta que llegara el QR
    // y el usuario tenía que refrescar a mano). EX 180: si el worker está caído
    // y nunca responde, el estado vuelve solo a 'disconnected'.
    await redis.set(keys(req.user.companyId).status, 'connecting', 'EX', 180);
    await publishCommand(redis, 'init', { companyId: req.user.companyId });
    ok(res, { message: 'Inicializando conexión WhatsApp...' });
  } catch (err) { next(err); }
});

// Desconecta y destruye la sesión
router.post('/disconnect', async (req, res, next) => {
  try {
    await publishCommand(redis, 'destroy', { companyId: req.user.companyId });
    ok(res, { message: 'Desconectando WhatsApp...' });
  } catch (err) { next(err); }
});

router.post('/enable', async (req, res, next) => {
  try {
    await redis.set(keys(req.user.companyId).enabled, '1');
    ok(res, { enabled: true });
  } catch (err) { next(err); }
});

router.post('/disable', async (req, res, next) => {
  try {
    await redis.set(keys(req.user.companyId).enabled, '0');
    ok(res, { enabled: false });
  } catch (err) { next(err); }
});

module.exports = router;
