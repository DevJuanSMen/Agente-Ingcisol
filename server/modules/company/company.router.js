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

// Estado del onboarding (wizard). Lo consulta cualquier usuario autenticado de
// la empresa (los no-directores ven la pantalla de "espera al director").
router.get('/onboarding', async (req, res, next) => {
  try {
    ok(res, await companyService.getOnboarding(req.user.companyId));
  } catch (err) { next(err); }
});

// Valida el paso actual contra la BD y avanza. Solo el director conduce el wizard.
router.post('/onboarding/advance', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    ok(res, await companyService.advanceOnboarding(req.user.companyId));
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
