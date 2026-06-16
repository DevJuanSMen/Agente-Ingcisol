const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, importSuppliers } = require('./suppliers.service');
const { analyzeSuppliersExcel, confirmSuppliersImport } = require('./excel.analyzer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const suppliers = await listSuppliers(req.user.companyId, req.query);
    ok(res, suppliers);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const supplier = await getSupplier(req.user.companyId, req.params.id);
    ok(res, supplier);
  } catch (err) { next(err); }
});

router.post('/', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const supplier = await createSupplier(req.user.companyId, req.body);
    created(res, supplier);
  } catch (err) { next(err); }
});

router.put('/:id', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const supplier = await updateSupplier(req.user.companyId, req.params.id, req.body);
    ok(res, supplier);
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    await deleteSupplier(req.user.companyId, req.params.id);
    ok(res, { message: 'Proveedor eliminado' });
  } catch (err) { next(err); }
});

router.post('/import', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { suppliers, projectId } = req.body;
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere un array de proveedores' });
    }
    const count = await importSuppliers(req.user.companyId, suppliers, projectId || null);
    ok(res, { message: `${count} proveedores importados` });
  } catch (err) {
    next(err);
  }
});

// Análisis IA — sube Excel en formato libre, la IA mapea columnas, devuelve preview + sessionKey
router.post(
  '/analyze',
  requireRole('DIRECTOR', 'APOYO_DIRECTOR'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo Excel' });
      const result = await analyzeSuppliersExcel(req.file.buffer);
      ok(res, result);
    } catch (err) { next(err); }
  }
);

// Confirmar importación — aplica el mapeo (editable por el usuario) y guarda
router.post('/confirm', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { sessionKey, columnas, projectId } = req.body;
    if (!sessionKey) {
      return res.status(400).json({ error: true, message: 'Falta sessionKey' });
    }
    const suppliers = await confirmSuppliersImport(sessionKey, columnas);
    if (suppliers.length === 0) {
      return res.status(400).json({ error: true, message: 'No se encontraron proveedores válidos en el archivo' });
    }
    const count = await importSuppliers(req.user.companyId, suppliers, projectId || null);
    ok(res, { message: `${count} proveedores importados`, count });
  } catch (err) { next(err); }
});

module.exports = router;
