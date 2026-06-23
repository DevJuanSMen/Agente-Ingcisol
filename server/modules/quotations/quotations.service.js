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
  purchaseOrders: {
    select: { id: true, consecutivo: true, montoTotal: true, fechaEntregaPactada: true, estado: true, supplierId: true },
  },
};

// Casa un ítem de requisición (ri) con un ítem cotizado (qi). Si el ítem cotizado
// trae requisitionItemId (flujo actual), el match es exacto; si no (ítems manuales
// o antiguos), cae a comparar por itemApuId o por descripción.
const itemMatches = (ri, qi) =>
  qi.requisitionItemId
    ? qi.requisitionItemId === ri.id
    : (ri.itemApuId && qi.itemApuId && qi.itemApuId === ri.itemApuId) ||
      (qi.descripcion &&
        ri.descripcion &&
        qi.descripcion.toLowerCase().trim() === ri.descripcion.toLowerCase().trim());

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
      .filter((qi) => itemMatches(ri, qi))
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

  // purchaseOrder (singular) = primera OC, por compatibilidad con el front actual
  return quotations.map((q) => ({
    ...q,
    purchaseOrder: q.purchaseOrders?.[0] || null,
    comparison: computeComparison(q),
  }));
};

// ── Detalle ──────────────────────────────────────────────────────────────────

const getQuotation = async (companyId, quotationId) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: QUOTATION_INCLUDE,
  });
  if (!quotation) throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });

  return {
    ...quotation,
    purchaseOrder: quotation.purchaseOrders?.[0] || null,
    comparison: computeComparison(quotation),
  };
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

// ── Adjudicación: ítems ganados por proveedor ────────────────────────────────

// Construye la adjudicación recomendada: por cada ítem de la requisición, el
// proveedor con menor precio unitario. Devuelve [{ supplierId, quotationItemIds }].
const buildRecommendedAwards = (quotation) => {
  const reqItems = quotation.requisition?.items || [];
  const qItems = quotation.items || [];
  const buckets = new Map(); // supplierId -> Set(quotationItemId)

  for (const ri of reqItems) {
    const candidatos = qItems.filter((qi) => itemMatches(ri, qi));
    if (!candidatos.length) continue;
    const best = candidatos.reduce((m, qi) =>
      !m || Number(qi.precioUnitario) < Number(m.precioUnitario) ? qi : m
    , null);
    if (!buckets.has(best.supplierId)) buckets.set(best.supplierId, new Set());
    buckets.get(best.supplierId).add(best.id);
  }

  return [...buckets.entries()].map(([supplierId, ids]) => ({
    supplierId,
    quotationItemIds: [...ids],
  }));
};

// ── Seleccionar ganador(es) y crear OC ────────────────────────────────────────

// Adjudicación múltiple. `awards`: [{ supplierId, quotationItemIds?, fechaEntregaPactada? }].
// Si un award no trae quotationItemIds, toma TODOS los ítems cotizados por ese
// proveedor (caso de un único ganador). Crea una OC por proveedor.
const selectWinners = async (companyId, quotationId, awards, userId) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      requisition: {
        include: { project: { select: { companyId: true, nombre: true } }, items: true },
      },
      items: { include: { itemAPU: true } },
    },
  });
  if (!quotation || quotation.requisition.project.companyId !== companyId) {
    throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });
  }
  if (quotation.estado === 'APROBADA') {
    throw Object.assign(new Error('Esta cotización ya fue aprobada'), { statusCode: 400 });
  }
  if (!Array.isArray(awards) || awards.length === 0) {
    throw Object.assign(new Error('Se requiere al menos un proveedor a adjudicar'), { statusCode: 400 });
  }

  const itemsById = new Map(quotation.items.map((qi) => [qi.id, qi]));

  // Resolver ítems de cada award y validar que ningún ítem se adjudique dos veces.
  const usados = new Set();
  const planned = awards.map((aw) => {
    let items;
    if (Array.isArray(aw.quotationItemIds) && aw.quotationItemIds.length) {
      items = aw.quotationItemIds.map((id) => itemsById.get(id)).filter(Boolean);
    } else {
      items = quotation.items.filter((qi) => qi.supplierId === aw.supplierId);
    }
    if (!items.length) {
      throw Object.assign(
        new Error('Un proveedor seleccionado no tiene ítems cotizados'),
        { statusCode: 400 }
      );
    }
    for (const it of items) {
      if (it.supplierId !== aw.supplierId) {
        throw Object.assign(new Error('Un ítem no pertenece al proveedor indicado'), { statusCode: 400 });
      }
      if (usados.has(it.id)) {
        throw Object.assign(new Error('Un ítem fue adjudicado a más de un proveedor'), { statusCode: 400 });
      }
      usados.add(it.id);
    }
    const montoTotal = items.reduce((a, i) => a + Number(i.precioTotal), 0);
    const maxEntrega = items.reduce((max, i) => Math.max(max, i.tiempoEntrega || 0), 0);
    const fechaEntrega = aw.fechaEntregaPactada
      ? new Date(aw.fechaEntregaPactada)
      : maxEntrega > 0
      ? new Date(Date.now() + maxEntrega * 24 * 60 * 60 * 1000)
      : null;
    return { supplierId: aw.supplierId, items, montoTotal, fechaEntrega };
  });

  // Consecutivos OC: base fija + índice (las filas de la transacción aún no están
  // commiteadas, así que el count no cambia entre creaciones).
  const year = new Date().getFullYear();
  const baseCount = await prisma.purchaseOrder.count({
    where: { consecutivo: { startsWith: `OC-${year}` } },
  });
  planned.forEach((p, i) => {
    p.consecutivo = `OC-${year}-${String(baseCount + i + 1).padStart(3, '0')}`;
  });

  // Proveedor "principal" para back-compat de Quotation.proveedorGanadorId:
  // el que cubre más ítems.
  const principal = planned.reduce((m, p) => (!m || p.items.length > m.items.length ? p : m), null);

  const created = await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: { estado: 'APROBADA', proveedorGanadorId: principal.supplierId },
    });
    await tx.requisition.update({
      where: { id: quotation.requisitionId },
      data: { estado: 'OC_EMITIDA' },
    });

    const orders = [];
    for (const p of planned) {
      const po = await tx.purchaseOrder.create({
        data: {
          consecutivo: p.consecutivo,
          quotationId,
          supplierId: p.supplierId,
          montoTotal: p.montoTotal,
          fechaEntregaPactada: p.fechaEntrega,
          estado: 'EMITIDA',
        },
      });
      // Enlazar los ítems adjudicados a esta OC
      await tx.quotationItem.updateMany({
        where: { id: { in: p.items.map((i) => i.id) } },
        data: { purchaseOrderId: po.id },
      });
      await tx.auditLog.create({
        data: {
          companyId,
          userId,
          accion: 'EMITIR_OC',
          entidad: 'PurchaseOrder',
          entidadId: p.consecutivo,
          metadata: { consecutivo: p.consecutivo, montoTotal: p.montoTotal, supplierId: p.supplierId },
        },
      });
      orders.push(po);
    }
    return orders;
  });

  // Historial de precios (fuera de la transacción, no bloqueante)
  for (let i = 0; i < planned.length; i++) {
    const po = created[i];
    for (const item of planned[i].items) {
      if (item.itemApuId) {
        await prisma.priceHistory
          .create({
            data: {
              companyId,
              supplierId: planned[i].supplierId,
              itemApuId: item.itemApuId,
              precioUnitario: item.precioUnitario,
              purchaseOrderId: po.id,
            },
          })
          .catch(() => {});
      }
    }
  }

  const montoGlobal = planned.reduce((a, p) => a + p.montoTotal, 0);

  // Notificaciones in-app
  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR', 'CONTABILIDAD'], {
    tipo: 'OC_EMITIDA',
    titulo:
      created.length > 1
        ? `${created.length} OC emitidas (${created.map((o) => o.consecutivo).join(', ')})`
        : `OC ${created[0].consecutivo} emitida`,
    mensaje: `Adjudicación realizada. Monto: $${montoGlobal.toLocaleString('es-CO')}`,
    entidad: 'PurchaseOrder',
    entidadId: created[0].id,
  });

  // Generar y enviar PDFs por WhatsApp (proveedores + director + contabilidad)
  await publishCommand(redis, 'send_po_documents', {
    companyId,
    orderIds: created.map((o) => o.id),
  }).catch(() => {});

  return { quotationId, orders: created };
};

// Wrapper de un único ganador (compatibilidad con el dashboard actual).
const selectWinner = (companyId, quotationId, supplierId, fechaEntregaPactada, userId) =>
  selectWinners(companyId, quotationId, [{ supplierId, fechaEntregaPactada }], userId);

module.exports = {
  listQuotations,
  getQuotation,
  inviteSuppliers,
  addQuotationItem,
  selectWinner,
  selectWinners,
  buildRecommendedAwards,
  computeComparison,
};
