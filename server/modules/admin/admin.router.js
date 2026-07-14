const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireSuperadmin } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const redis = require('../../shared/redis');
const { publishCommand } = require('../whatsapp/bot.ipc');
const adminService = require('./admin.service');

router.use(verifyToken);
router.use(requireSuperadmin);

router.get('/companies', async (req, res, next) => {
  try {
    ok(res, await adminService.listCompanies());
  } catch (err) { next(err); }
});

// Vista completa: empresas + miembros + proyectos (panel plataforma).
router.get('/overview', async (req, res, next) => {
  try {
    ok(res, await adminService.getOverview());
  } catch (err) { next(err); }
});

// ── Sesión ÚNICA global de WhatsApp (QR del superadmin) ─────────────────────

router.get('/whatsapp/status', async (req, res, next) => {
  try {
    ok(res, await adminService.getWhatsappStatus());
  } catch (err) { next(err); }
});

// Inicia la sesión global. La vinculación es siempre por QR, generado bajo
// petición desde el panel superadmin.
router.post('/whatsapp/connect', async (req, res, next) => {
  try {
    // Marcar 'connecting' de inmediato para que el panel empiece a hacer polling
    // sin esperar al worker. EX 180: si el worker está caído y nunca responde,
    // el estado vuelve solo a 'disconnected'.
    await redis.set('whatsapp:global:status', 'connecting', 'EX', 180);
    await publishCommand(redis, 'init');
    ok(res, { message: 'Inicializando conexión WhatsApp...' });
  } catch (err) { next(err); }
});

// Desconecta la sesión global (sin invalidar las credenciales guardadas).
router.post('/whatsapp/disconnect', async (req, res, next) => {
  try {
    await publishCommand(redis, 'destroy');
    ok(res, { message: 'Desconectando WhatsApp...' });
  } catch (err) { next(err); }
});

// ── Interruptor por empresa (exclusión del bot global) ──────────────────────

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
