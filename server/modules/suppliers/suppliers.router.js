const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requirePermission } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, importSuppliers } = require('./suppliers.service');
const { previewSuppliersExcel } = require('./excel.analyzer');

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

router.post('/', requirePermission('suppliers', 'crear'), async (req, res, next) => {
  try {
    const supplier = await createSupplier(req.user.companyId, req.body);
    created(res, supplier);
  } catch (err) { next(err); }
});

router.put('/:id', requirePermission('suppliers', 'editar'), async (req, res, next) => {
  try {
    const supplier = await updateSupplier(req.user.companyId, req.params.id, req.body);
    ok(res, supplier);
  } catch (err) { next(err); }
});

router.delete('/:id', requirePermission('suppliers', 'eliminar'), async (req, res, next) => {
  try {
    const result = await deleteSupplier(req.user.companyId, req.params.id);
    ok(res, {
      message: result.archived
        ? 'Proveedor archivado (tenía historial de compras; se conservó la trazabilidad).'
        : 'Proveedor eliminado',
      archived: result.archived,
    });
  } catch (err) { next(err); }
});

router.post('/import', requirePermission('suppliers', 'crear'), async (req, res, next) => {
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

// Análisis IA — sube Excel en formato libre, la IA mapea columnas y devuelve
// TODAS las filas ya mapeadas para mostrarlas en una grilla editable.
router.post(
  '/analyze',
  requirePermission('suppliers', 'crear'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo Excel' });
      const result = await previewSuppliersExcel(req.file.buffer);
      ok(res, result);
    } catch (err) { next(err); }
  }
);

module.exports = router;
