const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');

router.use(verifyToken);

// Placeholder — las notificaciones se disparan desde los servicios de negocio
router.get('/', (req, res) => {
  ok(res, { message: 'Módulo de notificaciones activo', items: [] });
});

module.exports = router;
