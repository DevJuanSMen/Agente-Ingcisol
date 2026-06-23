const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole, requirePermission } = require('../../shared/middleware/rbac');
const { ok } = require('../../shared/utils/response');
const ordersService = require('./orders.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const orders = await ordersService.listOrders(req.user.companyId, req.query);
    ok(res, orders);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await ordersService.getOrder(req.user.companyId, req.params.id);
    ok(res, order);
  } catch (err) {
    next(err);
  }
});

// Descargar la OC en PDF (para el área financiera)
router.get('/:id/pdf', async (req, res, next) => {
  try {
    const { buffer, filename } = await ordersService.generateOrderDocument(
      req.user.companyId,
      req.params.id
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

router.put(
  '/:id/confirm-delivery',
  requirePermission('orders', 'editar'),
  async (req, res, next) => {
    try {
      const order = await ordersService.confirmDelivery(req.user.companyId, req.params.id, req.user.id);
      ok(res, order);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id/register-payment',
  requireRole('DIRECTOR', 'CONTABILIDAD'),
  async (req, res, next) => {
    try {
      const order = await ordersService.registerPayment(req.user.companyId, req.params.id, req.user.id);
      ok(res, order);
    } catch (err) {
      next(err);
    }
  }
);

// Editar impuestos / transporte de la OC (para discriminación DIAN en el PDF)
router.put(
  '/:id/taxes',
  requirePermission('orders', 'editar'),
  async (req, res, next) => {
    try {
      const order = await ordersService.updateTaxes(req.user.companyId, req.params.id, req.body);
      ok(res, order);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', requireRole('DIRECTOR'), async (req, res, next) => {
  try {
    await ordersService.cancelOrder(req.user.companyId, req.params.id, req.user.id);
    ok(res, { message: 'Orden cancelada' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
