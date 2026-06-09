const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const companyService = require('./company.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const company = await companyService.getCompany(req.user.companyId);
    ok(res, company);
  } catch (err) { next(err); }
});

router.put('/', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const company = await companyService.updateCompany(req.user.companyId, req.body);
    ok(res, company);
  } catch (err) { next(err); }
});

router.post('/logo', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl) return res.status(400).json({ error: true, message: 'Se requiere dataUrl' });
    const company = await companyService.updateLogo(req.user.companyId, dataUrl);
    ok(res, { logoUrl: company.logoUrl });
  } catch (err) { next(err); }
});

router.post('/firma', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    const { dataUrl } = req.body;
    if (!dataUrl) return res.status(400).json({ error: true, message: 'Se requiere dataUrl' });
    const company = await companyService.updateFirma(req.user.companyId, dataUrl);
    ok(res, { firmaUrl: company.firmaUrl });
  } catch (err) { next(err); }
});

module.exports = router;
