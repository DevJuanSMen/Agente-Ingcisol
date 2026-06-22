const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const quotationsService = require('./quotations.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const quotations = await quotationsService.listQuotations(req.user.companyId);
    ok(res, quotations);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const quotation = await quotationsService.getQuotation(req.user.companyId, req.params.id);
    ok(res, quotation);
  } catch (err) { next(err); }
});

// Invitar proveedores a cotizar (envía WhatsApp vía worker)
router.post('/:id/invite', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { supplierIds } = req.body;
    if (!Array.isArray(supplierIds) || supplierIds.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere lista de proveedores' });
    }
    const result = await quotationsService.inviteSuppliers(
      req.user.companyId,
      req.params.id,
      supplierIds
    );
    ok(res, result);
  } catch (err) { next(err); }
});

// Agregar ítem cotizado (precio de un proveedor) desde el dashboard
router.post('/:id/items', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const item = await quotationsService.addQuotationItem(
      req.user.companyId,
      req.params.id,
      req.body
    );
    created(res, item);
  } catch (err) { next(err); }
});

// Seleccionar ganador y emitir OC (un solo proveedor)
router.put('/:id/winner', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const { supplierId, fechaEntregaPactada } = req.body;
    if (!supplierId) {
      return res.status(400).json({ error: true, message: 'Se requiere supplierId' });
    }
    const result = await quotationsService.selectWinner(
      req.user.companyId,
      req.params.id,
      supplierId,
      fechaEntregaPactada,
      req.user.id
    );
    ok(res, result);
  } catch (err) { next(err); }
});

// Adjudicación dividida: varios proveedores, una OC por proveedor.
// body: { awards: [{ supplierId, quotationItemIds?, fechaEntregaPactada? }] }
//       o { auto: true } para repartir cada ítem al de menor precio.
router.post('/:id/winners', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    let { awards } = req.body;
    if (req.body.auto) {
      const quotation = await quotationsService.getQuotation(req.user.companyId, req.params.id);
      awards = quotationsService.buildRecommendedAwards(quotation);
    }
    if (!Array.isArray(awards) || awards.length === 0) {
      return res.status(400).json({ error: true, message: 'Se requiere awards o auto:true' });
    }
    const result = await quotationsService.selectWinners(
      req.user.companyId,
      req.params.id,
      awards,
      req.user.id
    );
    ok(res, result);
  } catch (err) { next(err); }
});

module.exports = router;
