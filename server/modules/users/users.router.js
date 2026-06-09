const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const usersService = require('./users.service');

router.use(verifyToken);

// Listado abierto a todos (necesario para delegaciones y selección de personas)
router.get('/', async (req, res, next) => {
  try {
    const users = await usersService.listUsers(req.user.companyId);
    ok(res, users);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const user = await usersService.createUser(req.user.companyId, req.body);
    created(res, user);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const user = await usersService.updateUser(req.user.companyId, req.params.id, req.body);
    ok(res, user);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    await usersService.deactivateUser(req.user.companyId, req.params.id);
    ok(res, { message: 'Usuario desactivado' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
