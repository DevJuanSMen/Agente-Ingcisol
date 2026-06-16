const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const authService = require('./auth.service');

router.post('/register', async (req, res, next) => {
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

router.post('/login', async (req, res, next) => {
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
