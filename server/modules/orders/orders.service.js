const prisma = require('../../shared/db');
const notifications = require('../notifications/notifications.service');
const { generateOrderPdf, normalizeAwardedItems } = require('../../shared/pdf/orderPdf');

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

// Al pagar una OC, descuenta su costo del saldo del presupuesto (ItemAPU).
// El dinero (saldoValor) siempre se descuenta contra el APU padre de cada ítem.
// La cantidad (saldoCantidad) solo se descuenta cuando la línea es el APU
// completo: para insumos o sub-insumos la unidad difiere (ej. kg de cemento vs
// m³ del APU), así que solo afecta el valor, no la cantidad.
const consumirSaldoPresupuesto = async (tx, orderId) => {
  const lineas = await tx.quotationItem.findMany({
    where: { purchaseOrderId: orderId },
    select: {
      precioTotal: true,
      itemApuId: true,
      requisitionItem: {
        select: { cantidad: true, itemApuId: true, itemApuInsumoId: true, basicPriceInsumoId: true },
      },
    },
  });

  for (const l of lineas) {
    const apuId = l.itemApuId || l.requisitionItem?.itemApuId;
    if (!apuId) continue; // ítem libre, no toca presupuesto APU
    const apu = await tx.itemAPU.findUnique({
      where: { id: apuId },
      select: { saldoValor: true, saldoCantidad: true },
    });
    if (!apu) continue;

    const data = {
      saldoValor: Math.max(0, Number(apu.saldoValor) - Number(l.precioTotal || 0)),
    };
    const ri = l.requisitionItem;
    const esApuCompleto = ri && !ri.itemApuInsumoId && !ri.basicPriceInsumoId;
    if (esApuCompleto) {
      data.saldoCantidad = Math.max(0, Number(apu.saldoCantidad) - Number(ri.cantidad || 0));
    }
    await tx.itemAPU.update({ where: { id: apuId }, data });
  }
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

    // Descontar del presupuesto del proyecto (las barras de avance suben aquí)
    await consumirSaldoPresupuesto(tx, orderId);

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

// Genera el PDF de una OC para descarga desde el dashboard / área financiera.
// Devuelve { buffer, filename }.
const generateOrderDocument = async (companyId, orderId) => {
  const order = await prisma.purchaseOrder.findFirst({
    where: {
      id: orderId,
      quotation: { requisition: { project: { companyId } } },
    },
    include: {
      proveedor: true,
      itemsAdjudicados: { include: { itemAPU: true } },
      quotation: {
        include: {
          items: { include: { itemAPU: true } },
          requisition: {
            include: { project: true, items: { include: { itemAPU: true } } },
          },
        },
      },
    },
  });
  if (!order) throw Object.assign(new Error('Orden de compra no encontrada'), { statusCode: 404 });

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const requisition = order.quotation.requisition;
  const reqItems = requisition.items;

  // Ítems adjudicados a esta OC; fallback a filtro por proveedor para OC legacy
  const adjItems =
    order.itemsAdjudicados && order.itemsAdjudicados.length
      ? order.itemsAdjudicados
      : order.quotation.items.filter((qi) => qi.supplierId === order.supplierId);

  const items = normalizeAwardedItems(adjItems, reqItems);

  const buffer = await generateOrderPdf({
    company,
    order,
    supplier: order.proveedor,
    items,
    project: requisition.project,
    requisition,
  });

  return { buffer, filename: `${order.consecutivo}.pdf` };
};

// Actualiza el transporte/flete y los overrides tributarios de una OC.
// Campos en null → se hereda la configuración de la empresa al generar el PDF.
const updateTaxes = async (companyId, orderId, data) => {
  await getOrder(companyId, orderId); // valida pertenencia a la empresa

  const numOrNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

  return prisma.purchaseOrder.update({
    where: { id: orderId },
    data: {
      transporte: data.transporte != null && data.transporte !== '' ? Number(data.transporte) : 0,
      ivaPorcentaje: numOrNull(data.ivaPorcentaje),
      retefuentePorcentaje: numOrNull(data.retefuentePorcentaje),
      reteIcaPorMil: numOrNull(data.reteIcaPorMil),
    },
  });
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

module.exports = {
  listOrders,
  getOrder,
  confirmDelivery,
  registerPayment,
  cancelOrder,
  updateTaxes,
  generateOrderDocument,
};
