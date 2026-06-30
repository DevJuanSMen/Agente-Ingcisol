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
  pairingCode: `whatsapp:${companyId}:pairingCode`,
  status: `whatsapp:${companyId}:status`,
  enabled: `whatsapp:${companyId}:enabled`,
});

router.get('/status', async (req, res, next) => {
  try {
    const k = keys(req.user.companyId);
    const [enabled, status, qr, pairingCode] = await Promise.all([
      redis.get(k.enabled),
      redis.get(k.status),
      redis.get(k.qr),
      redis.get(k.pairingCode),
    ]);
    ok(res, {
      enabled: enabled === '1',
      status: status || 'disconnected',
      qr: qr || null,
      pairingCode: pairingCode || null,
    });
  } catch (err) { next(err); }
});

// Inicia la sesión WhatsApp de esta empresa.
// body: { mode: 'qr' | 'pairing', phone? } — 'pairing' genera un código de 8
// dígitos que el usuario escribe en WhatsApp (más fácil que escanear el QR).
router.post('/connect', async (req, res, next) => {
  try {
    const { mode, phone } = req.body || {};
    await publishCommand(redis, 'init', {
      companyId: req.user.companyId,
      mode: mode === 'pairing' ? 'pairing' : 'qr',
      phone: phone || null,
    });
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
