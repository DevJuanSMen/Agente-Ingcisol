const router = require('express').Router();
const multer = require('multer');
const { verifyToken } = require('../../shared/middleware/auth');
const { requirePermission } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const { parseMasterFile } = require('./master.parser');
const masterSvc = require('./masterimport.service');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

router.use(verifyToken);

// Subir el Excel maestro → parsea y devuelve todo para previsualizar/editar (no guarda aún)
router.post(
  '/preview',
  requirePermission('budget', 'editar'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: true, message: 'Se requiere un archivo Excel' });
      const result = parseMasterFile(req.file.buffer);
      ok(res, result);
    } catch (err) { next(err); }
  }
);

// Confirmar la importación (datos ya editados en el front)
router.post('/confirm', requirePermission('budget', 'editar'), async (req, res, next) => {
  try {
    const result = await masterSvc.confirmImport(req.user.companyId, req.body);
    ok(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
