const prisma = require('../../shared/db');

const getSemaforo = (fechaEntregaPactada) => {
  if (!fechaEntregaPactada) return 'SIN_FECHA';
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const entrega = new Date(fechaEntregaPactada);
  entrega.setHours(0, 0, 0, 0);
  const dias = Math.ceil((entrega - hoy) / (1000 * 60 * 60 * 24));

  if (dias < 0) return 'ROJO';
  if (dias <= 4) return 'AMARILLO';
  return 'VERDE';
};

const getTrackingBoard = async (companyId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      estado: { in: ['EMITIDA', 'ENVIADA'] },
      quotation: { requisition: { projectId: { in: projectIds } } },
    },
    include: {
      proveedor: { select: { nombre: true, whatsapp: true } },
      quotation: {
        include: {
          requisition: {
            select: {
              consecutivo: true,
              project: { select: { nombre: true } },
            },
          },
          items: {
            take: 1,
            include: { itemAPU: { select: { descripcion: true } } },
          },
        },
      },
    },
    orderBy: { fechaEntregaPactada: 'asc' },
  });

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  return orders.map((order) => {
    const semaforo = getSemaforo(order.fechaEntregaPactada);
    const diasRestantes = order.fechaEntregaPactada
      ? Math.ceil((new Date(order.fechaEntregaPactada) - hoy) / (1000 * 60 * 60 * 24))
      : null;

    const primerItem = order.quotation.items[0]?.itemAPU?.descripcion || 'Sin ítem';

    return {
      id: order.id,
      consecutivo: order.consecutivo,
      estado: order.estado,
      semaforo,
      diasRestantes,
      montoTotal: order.montoTotal,
      fechaEntregaPactada: order.fechaEntregaPactada,
      proveedor: order.proveedor.nombre,
      proyecto: order.quotation.requisition.project.nombre,
      requisitinoConsecutivo: order.quotation.requisition.consecutivo,
      primerItem,
    };
  });
};

// ── Seguimiento general: requisiciones activas + sus órdenes de compra ─────────
// Lista todas las requisiciones no cerradas/canceladas con su estado en el flujo,
// el estado de su cotización y las OC asociadas (con semáforo de entrega).
const getRequisitionsTracking = async (companyId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  const requisitions = await prisma.requisition.findMany({
    where: {
      projectId: { in: projectIds },
      estado: { notIn: ['CERRADA', 'EXPIRADA', 'RECHAZADA'] },
    },
    include: {
      project: { select: { nombre: true } },
      solicitante: { select: { nombre: true } },
      _count: { select: { items: true } },
      quotation: {
        select: {
          estado: true,
          purchaseOrders: {
            select: {
              id: true,
              consecutivo: true,
              estado: true,
              montoTotal: true,
              fechaEntregaPactada: true,
              proveedor: { select: { nombre: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  return requisitions.map((req) => {
    const ordenes = (req.quotation?.purchaseOrders || []).map((po) => {
      const semaforo = ['EMITIDA', 'ENVIADA'].includes(po.estado) ? getSemaforo(po.fechaEntregaPactada) : null;
      const diasRestantes = po.fechaEntregaPactada
        ? Math.ceil((new Date(po.fechaEntregaPactada) - hoy) / 86400000)
        : null;
      return {
        id: po.id,
        consecutivo: po.consecutivo,
        estado: po.estado,
        montoTotal: po.montoTotal,
        fechaEntregaPactada: po.fechaEntregaPactada,
        proveedor: po.proveedor?.nombre || '—',
        semaforo,
        diasRestantes,
      };
    });

    return {
      id: req.id,
      consecutivo: req.consecutivo,
      estado: req.estado,
      prioridad: req.prioridad,
      canal: req.canal,
      fechaLimite: req.fechaLimite,
      createdAt: req.createdAt,
      proyecto: req.project?.nombre || '—',
      solicitante: req.solicitante?.nombre || '—',
      totalItems: req._count.items,
      cotizacionEstado: req.quotation?.estado || null,
      ordenes,
    };
  });
};

module.exports = { getTrackingBoard, getRequisitionsTracking, getSemaforo };
