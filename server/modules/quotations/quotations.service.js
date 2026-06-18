const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const notifications = require('../notifications/notifications.service');
const { publishCommand } = require('../whatsapp/bot.ipc');

// ── Helpers ─────────────────────────────────────────────────────────────────

const genConsecutivoOC = async () => {
  const year = new Date().getFullYear();
  const count = await prisma.purchaseOrder.count({
    where: { consecutivo: { startsWith: `OC-${year}` } },
  });
  return `OC-${year}-${String(count + 1).padStart(3, '0')}`;
};

// Incluye para listado
const QUOTATION_INCLUDE = {
  requisition: {
    select: {
      consecutivo: true,
      estado: true,
      prioridad: true,
      fechaLimite: true,
      project: { select: { nombre: true, contratoNo: true } },
      solicitante: { select: { nombre: true } },
      items: {
        include: {
          itemAPU: { select: { codigo: true, descripcion: true, unidad: true, precioUnitario: true } },
          itemAPUInsumo: {
            select: { tipo: true, descripcion: true, unidad: true, precioUnitario: true, itemAPU: { select: { codigo: true } } },
          },
        },
      },
    },
  },
  proveedorGanador: { select: { id: true, nombre: true } },
  items: {
    include: {
      supplier: { select: { id: true, nombre: true, whatsapp: true } },
      itemAPU: { select: { codigo: true, descripcion: true, unidad: true, precioUnitario: true } },
    },
    orderBy: { supplierId: 'asc' },
  },
  invites: {
    include: {
      supplier: { select: { id: true, nombre: true, whatsapp: true, segmento: true } },
    },
  },
  purchaseOrder: {
    select: { id: true, consecutivo: true, montoTotal: true, fechaEntregaPactada: true, estado: true },
  },
};

// ── Cuadro comparativo + recomendación de proveedor favorito ─────────────────
// Cruza ítems de requisición (filas) contra ítems cotizados por proveedor (columnas),
// usa el precio del APU como referencia y recomienda el proveedor con mejor total.
const computeComparison = (quotation) => {
  const reqItems = quotation.requisition?.items || [];
  const qItems = quotation.items || [];

  const supplierMap = new Map();
  const ensureSupplier = (id, nombre) => {
    if (!supplierMap.has(id)) supplierMap.set(id, { id, nombre, total: 0, count: 0, items: {} });
    return supplierMap.get(id);
  };

  const rows = reqItems.map((ri) => {
    const cantidad = Number(ri.cantidad) || 0;
    const refPrice = ri.itemAPUInsumo
      ? Number(ri.itemAPUInsumo.precioUnitario)
      : ri.itemAPU
      ? Number(ri.itemAPU.precioUnitario)
      : null;
    const codigoAPU = ri.itemAPU?.codigo || ri.itemAPUInsumo?.itemAPU?.codigo || null;

    const quotes = qItems
      .filter(
        (qi) =>
          (ri.itemApuId && qi.itemApuId && qi.itemApuId === ri.itemApuId) ||
          (qi.descripcion && ri.descripcion && qi.descripcion.toLowerCase().trim() === ri.descripcion.toLowerCase().trim())
      )
      .map((qi) => ({
        supplierId: qi.supplierId,
        nombre: qi.supplier?.nombre,
        precioUnitario: Number(qi.precioUnitario),
        precioTotal: Number(qi.precioTotal),
        tiempoEntrega: qi.tiempoEntrega,
        confiabilidad: qi.confiabilidad,
        excedeApu: refPrice != null && Number(qi.precioUnitario) > refPrice,
      }));

    let min = null;
    for (const q of quotes) {
      if (!min || q.precioUnitario < min.precioUnitario) min = q;
      const s = ensureSupplier(q.supplierId, q.nombre);
      s.items[ri.id] = q;
      s.total += q.precioTotal;
      s.count += 1;
    }

    return {
      reqItemId: ri.id,
      descripcion: ri.descripcion,
      unidad: ri.unidad,
      cantidad,
      codigoAPU,
      refPrice,
      refTotal: refPrice != null ? refPrice * cantidad : null,
      mejorSupplierId: min?.supplierId || null,
      quotes,
    };
  });

  const suppliers = [...supplierMap.values()];
  const maxCount = suppliers.reduce((m, s) => Math.max(m, s.count), 0);
  // Favorito: el que cubre más ítems y, a igualdad, el de menor total
  const fav = suppliers
    .filter((s) => s.count === maxCount && maxCount > 0)
    .sort((a, b) => a.total - b.total)[0] || null;

  const refTotal = rows.reduce((a, r) => a + (r.refTotal || 0), 0);

  return {
    rows,
    suppliers: suppliers.map((s) => ({ id: s.id, nombre: s.nombre, total: s.total, count: s.count })),
    favoritoSupplierId: fav?.id || null,
    favoritoTotal: fav?.total ?? null,
    refTotal,
    ahorroVsApu: fav && refTotal ? refTotal - fav.total : null,
    totalItems: rows.length,
  };
};

// ── Listado ──────────────────────────────────────────────────────────────────

const listQuotations = async (companyId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const quotations = await prisma.quotation.findMany({
    where: { requisition: { projectId: { in: projectIds } } },
    include: QUOTATION_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return quotations.map((q) => ({ ...q, comparison: computeComparison(q) }));
};

// ── Detalle ──────────────────────────────────────────────────────────────────

const getQuotation = async (companyId, quotationId) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      ...QUOTATION_INCLUDE,
      purchaseOrder: true,
    },
  });
  if (!quotation) throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });

  return { ...quotation, comparison: computeComparison(quotation) };
};

// ── Invitar proveedores manualmente desde el dashboard ───────────────────────

const inviteSuppliers = async (companyId, quotationId, supplierIds) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      requisition: {
        include: {
          project: { select: { companyId: true } },
          items: true,
        },
      },
    },
  });
  if (!quotation || quotation.requisition.project.companyId !== companyId) {
    throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });
  }

  // Crear invites
  await prisma.quotationInvite.createMany({
    data: supplierIds.map((id) => ({ quotationId, supplierId: id })),
    skipDuplicates: true,
  });

  // Publicar comando para que el worker envíe los mensajes
  await publishCommand(redis, 'send_quote_requests', { companyId, quotationId });

  return prisma.quotation.findUnique({ where: { id: quotationId }, include: QUOTATION_INCLUDE });
};

// ── Agregar ítem de cotización (manual desde dashboard) ──────────────────────

const addQuotationItem = async (companyId, quotationId, data) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { requisition: { include: { project: { select: { companyId: true } } } } },
  });
  if (!quotation || quotation.requisition.project.companyId !== companyId) {
    throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });
  }

  const { supplierId, itemApuId, descripcion, precioUnitario, tiempoEntrega } = data;
  const cantidad = data.cantidad || 1;
  const precio = parseFloat(precioUnitario) || 0;

  const item = await prisma.quotationItem.create({
    data: {
      quotationId,
      supplierId,
      itemApuId: itemApuId || null,
      descripcion: descripcion || null,
      precioUnitario: precio,
      precioTotal: precio * parseFloat(cantidad),
      tiempoEntrega: parseInt(tiempoEntrega) || 0,
      fuente: 'LOCAL',
      confiabilidad: 'LOCAL',
    },
    include: { supplier: true, itemAPU: true },
  });

  // Marcar el invite de este proveedor como respondido si existe
  await prisma.quotationInvite.updateMany({
    where: { quotationId, supplierId },
    data: { respondido: true, respondedAt: new Date() },
  });

  // Si la cotización sigue en EN_BUSQUEDA, moverla a PENDIENTE_APROBACION
  if (quotation.estado === 'EN_BUSQUEDA') {
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { estado: 'PENDIENTE_APROBACION' },
    });
  }

  return item;
};

// ── Seleccionar ganador y crear OC ───────────────────────────────────────────

const selectWinner = async (companyId, quotationId, supplierId, fechaEntregaPactada, userId) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      requisition: {
        include: { project: { select: { companyId: true, nombre: true } }, items: true },
      },
      items: {
        where: { supplierId },
        include: { itemAPU: true },
      },
    },
  });
  if (!quotation || quotation.requisition.project.companyId !== companyId) {
    throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });
  }
  if (quotation.estado === 'APROBADA') {
    throw Object.assign(new Error('Esta cotización ya fue aprobada'), { statusCode: 400 });
  }

  const winnerItems = quotation.items;
  if (winnerItems.length === 0) {
    throw Object.assign(new Error('El proveedor seleccionado no tiene ítems cotizados'), { statusCode: 400 });
  }

  const montoTotal = winnerItems.reduce((a, i) => a + Number(i.precioTotal), 0);
  const maxEntrega = winnerItems.reduce((max, i) => Math.max(max, i.tiempoEntrega || 0), 0);
  const fechaEntrega = fechaEntregaPactada
    ? new Date(fechaEntregaPactada)
    : maxEntrega > 0
    ? new Date(Date.now() + maxEntrega * 24 * 60 * 60 * 1000)
    : null;

  const consecutivoOC = await genConsecutivoOC();

  const [updatedQuotation, purchaseOrder] = await prisma.$transaction([
    prisma.quotation.update({
      where: { id: quotationId },
      data: { estado: 'APROBADA', proveedorGanadorId: supplierId },
    }),
    prisma.purchaseOrder.create({
      data: {
        consecutivo: consecutivoOC,
        quotationId,
        supplierId,
        montoTotal,
        fechaEntregaPactada: fechaEntrega,
        estado: 'EMITIDA',
      },
    }),
    prisma.requisition.update({
      where: { id: quotation.requisitionId },
      data: { estado: 'OC_EMITIDA' },
    }),
    prisma.auditLog.create({
      data: {
        companyId,
        userId, // director/apoyo que selecciona el ganador
        accion: 'EMITIR_OC',
        entidad: 'PurchaseOrder',
        entidadId: consecutivoOC,
        metadata: { consecutivo: consecutivoOC, montoTotal, supplierId },
      },
    }),
  ]);

  // Guardar historial de precios
  for (const item of winnerItems) {
    if (item.itemApuId) {
      await prisma.priceHistory.create({
        data: {
          companyId,
          supplierId,
          itemApuId: item.itemApuId,
          precioUnitario: item.precioUnitario,
          purchaseOrderId: purchaseOrder.id,
        },
      }).catch(() => {}); // no bloquear si falla el historial
    }
  }

  // Notificaciones in-app
  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR', 'CONTABILIDAD'], {
    tipo: 'OC_EMITIDA',
    titulo: `OC ${consecutivoOC} emitida`,
    mensaje: `Proveedor ganador seleccionado. Monto: $${montoTotal.toLocaleString('es-CO')}`,
    entidad: 'PurchaseOrder',
    entidadId: purchaseOrder.id,
  });

  // Enviar notificación WhatsApp al proveedor ganador
  await publishCommand(redis, 'send_po_notification', { companyId, orderId: purchaseOrder.id });

  return { quotation: updatedQuotation, purchaseOrder };
};

module.exports = { listQuotations, getQuotation, inviteSuppliers, addQuotationItem, selectWinner };
