const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const suppliersService = require('./suppliers.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const suppliers = await suppliersService.listSuppliers(req.user.companyId, req.query);
    ok(res, suppliers);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const supplier = await suppliersService.getSupplier(req.user.companyId, req.params.id);
    ok(res, supplier);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const supplier = await suppliersService.createSupplier(req.user.companyId, req.body);
    created(res, supplier);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const supplier = await suppliersService.updateSupplier(req.user.companyId, req.params.id, req.body);
    ok(res, supplier);
  } catch (err) {
    next(err);
  }
});

router.post('/import', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { suppliers } = req.body;
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere un array de proveedores' });
    }
    const count = await suppliersService.importSuppliers(req.user.companyId, suppliers);
    ok(res, { message: `${count} proveedores importados` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
