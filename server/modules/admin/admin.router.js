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

// ── API key de Groq (rotación en caliente, sin acceso a Railway) ─────────────
// La key se valida contra Groq, se guarda en Redis y se recarga en el proceso
// api y en el worker (IPC). Nunca se persiste en el código ni en git.

router.get('/groq-key/status', async (req, res, next) => {
  try {
    const { hasGroqKey, GROQ_REDIS_KEY } = require('../../shared/utils/groq');
    const enRedis = !!(await redis.get(GROQ_REDIS_KEY));
    ok(res, { configurada: hasGroqKey(), origen: enRedis ? 'panel' : 'entorno' });
  } catch (err) { next(err); }
});

router.post('/groq-key', async (req, res, next) => {
  try {
    const key = String(req.body.key || '').trim();
    if (!key.startsWith('gsk_') || key.length < 20) {
      return res.status(400).json({ success: false, message: 'La key no tiene el formato de Groq (gsk_...).' });
    }
    const { testGroqKey, setGroqKey, GROQ_REDIS_KEY } = require('../../shared/utils/groq');
    try {
      await testGroqKey(key);
    } catch (err) {
      const invalid = err.status === 401 || /invalid/i.test(err.message || '');
      return res.status(400).json({
        success: false,
        message: invalid ? 'Groq rechazó la key (inválida o revocada).' : `No se pudo validar la key: ${err.message}`,
      });
    }
    await redis.set(GROQ_REDIS_KEY, key);
    setGroqKey(key); // proceso api
    await publishCommand(redis, 'reload_groq_key'); // proceso worker (bot)
    ok(res, { message: 'API key de Groq validada y activada en toda la plataforma.' });
  } catch (err) { next(err); }
});

// ── Diagnóstico del bot ──────────────────────────────────────────────────────

// ¿Qué haría el bot con este número? Reproduce el matching de ruteo y explica
// las coincidencias (usuario/proveedor, empresa, bot habilitado) y el veredicto.
router.get('/whatsapp/diagnose', async (req, res, next) => {
  try {
    const phone = String(req.query.phone || '').trim();
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Falta el parámetro ?phone=' });
    }
    const { diagnoseNumber } = require('../whatsapp/bot.router.msg');
    ok(res, await diagnoseNumber(phone));
  } catch (err) { next(err); }
});

// Últimos registros de interpretación/ruteo del bot (BotParseLog).
router.get('/whatsapp/logs', async (req, res, next) => {
  try {
    ok(res, await adminService.getBotLogs(req.query.limit));
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
