const prisma = require('../../shared/db');
const notifications = require('../notifications/notifications.service');

const generateConsecutivoOC = async (companyId) => {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count({
    where: { consecutivo: { startsWith: `OC-${year}` } },
  });
  return `OC-${year}-${String(count + 1).padStart(3, '0')}`;
};

const listOrders = async (companyId, filters = {}) => {
  const { estado } = filters;
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const where = {
    quotation: { requisition: { projectId: { in: projectIds } } },
  };
  if (estado) where.estado = estado;

  return prisma.purchaseOrder.findMany({
    where,
    include: {
      proveedor: { select: { nombre: true, email: true, whatsapp: true } },
      quotation: {
        include: {
          requisition: { select: { consecutivo: true, project: { select: { nombre: true } } } },
          items: { include: { itemAPU: { select: { descripcion: true, unidad: true } } } },
        },
      },
    },
    orderBy: { fechaEmision: 'desc' },
  });
};

const getOrder = async (companyId, orderId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const order = await prisma.purchaseOrder.findFirst({
    where: {
      id: orderId,
      quotation: { requisition: { projectId: { in: projectIds } } },
    },
    include: {
      proveedor: true,
      quotation: {
        include: {
          requisition: {
            include: {
              project: true,
              solicitante: { select: { nombre: true } },
              items: { include: { itemAPU: true } },
            },
          },
          items: { include: { supplier: true, itemAPU: true } },
        },
      },
      priceHistory: { include: { supplier: true } },
    },
  });

  if (!order) throw Object.assign(new Error('Orden de compra no encontrada'), { statusCode: 404 });
  return order;
};

const confirmDelivery = async (companyId, orderId, userId) => {
  const order = await getOrder(companyId, orderId);
  if (!['EMITIDA', 'ENVIADA'].includes(order.estado)) {
    throw Object.assign(new Error(`No se puede confirmar entrega en estado ${order.estado}`), { statusCode: 400 });
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: orderId },
    data: { estado: 'ENTREGADA', fechaEntregaReal: new Date() },
  });

  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR', 'CONTABILIDAD'], {
    tipo: 'OC_ENTREGADA',
    titulo: `OC ${order.consecutivo} entregada`,
    mensaje: 'Pendiente registrar el pago.',
    entidad: 'PurchaseOrder',
    entidadId: orderId,
    excludeUserId: userId,
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId,
      accion: 'CONFIRMAR_ENTREGA',
      entidad: 'PurchaseOrder',
      entidadId: orderId,
      metadata: { consecutivo: order.consecutivo },
    },
  });

  return updated;
};

const registerPayment = async (companyId, orderId, userId) => {
  const order = await getOrder(companyId, orderId);
  if (order.estado !== 'ENTREGADA') {
    throw Object.assign(new Error('Solo se pueden pagar OC con estado ENTREGADA'), { statusCode: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const oc = await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { estado: 'COMPLETADA', fechaPago: new Date() },
    });

    // Registrar en historial de precios
    const quotationItems = order.quotation.items.filter(
      (qi) => qi.supplierId === order.supplierId
    );
    for (const qi of quotationItems) {
      await tx.priceHistory.create({
        data: {
          companyId,
          supplierId: order.supplierId,
          itemApuId: qi.itemApuId,
          precioUnitario: qi.precioUnitario,
          purchaseOrderId: orderId,
          registradoPorId: userId,
        },
      });
    }

    // Actualizar requisición a CERRADA
    await tx.requisition.update({
      where: { id: order.quotation.requisition.id },
      data: { estado: 'CERRADA' },
    });

    return oc;
  });

  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR'], {
    tipo: 'OC_PAGADA',
    titulo: `OC ${order.consecutivo} pagada y completada`,
    mensaje: 'La requisición asociada quedó cerrada.',
    entidad: 'PurchaseOrder',
    entidadId: orderId,
    excludeUserId: userId,
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId,
      accion: 'REGISTRAR_PAGO',
      entidad: 'PurchaseOrder',
      entidadId: orderId,
      metadata: { consecutivo: order.consecutivo, monto: order.montoTotal?.toString() },
    },
  });

  return updated;
};

const cancelOrder = async (companyId, orderId, userId) => {
  const order = await getOrder(companyId, orderId);
  if (order.estado === 'ENTREGADA') {
    throw Object.assign(new Error('No se puede cancelar una OC ya entregada'), { statusCode: 400 });
  }

  return prisma.purchaseOrder.update({
    where: { id: orderId },
    data: { estado: 'CANCELADA' },
  });
};

module.exports = { listOrders, getOrder, confirmDelivery, registerPayment, cancelOrder };
