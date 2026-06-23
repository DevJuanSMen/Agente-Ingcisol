const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const permsService = require('./permissions.service');

router.use(verifyToken);

// Permisos del usuario actual (cualquier sesión) — para gating en el front
router.get('/me', async (req, res, next) => {
  try {
    const permisos = await permsService.getRolePermissions(req.user.companyId, req.user.rol);
    ok(res, { rol: req.user.rol, permisos });
  } catch (err) { next(err); }
});

// Matriz completa + catálogo (solo director, para la pantalla de configuración)
router.get('/', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const matriz = await permsService.getMatrixNested(req.user.companyId);
    ok(res, { matriz, modulos: permsService.MODULES, roles: permsService.ROLES, acciones: permsService.ACCIONES });
  } catch (err) { next(err); }
});

// Actualizar la matriz (solo director)
router.put('/', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const matriz = await permsService.updateMatrix(req.user.companyId, req.body.entries || req.body);
    ok(res, { matriz });
  } catch (err) { next(err); }
});

module.exports = router;
