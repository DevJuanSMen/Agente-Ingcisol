const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const authService = require('./auth.service');

// Protección básica contra fuerza bruta en los endpoints sin autenticación.
// Por IP: 15 intentos de login / 15 min; 10 de recuperación de contraseña / 15 min.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: true, message: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: true, message: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' },
});

router.post('/register', resetLimiter, async (req, res, next) => {
  try {
    const { razonSocial, nit, nombre, email, password } = req.body;
    if (!razonSocial || !nit || !nombre || !email || !password) {
      return res.status(400).json({
        error: true,
        message: 'Razón social, NIT, nombre, email y contraseña son requeridos',
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: true, message: 'La contraseña debe tener al menos 8 caracteres' });
    }
    const result = await authService.register(req.body);
    ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: true, message: 'Email y contraseña son requeridos' });
    }
    const result = await authService.login(email, password);
    ok(res, result);
  } catch (err) {
    next(err);
  }
});

// Recuperación de contraseña por código de WhatsApp (sin autenticación)
router.post('/forgot-password', resetLimiter, async (req, res, next) => {
  try {
    const result = await authService.requestPasswordReset(req.body.email);
    ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/reset-password', resetLimiter, async (req, res, next) => {
  try {
    const { email, code, password } = req.body;
    const result = await authService.resetPasswordWithCode(email, code, password);
    ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', verifyToken, async (req, res, next) => {
  try {
    const token = await authService.refreshToken(req.user.id);
    ok(res, { token });
  } catch (err) {
    next(err);
  }
});

router.get('/me', verifyToken, async (req, res, next) => {
  try {
    const user = await authService.me(req.user.id);
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
