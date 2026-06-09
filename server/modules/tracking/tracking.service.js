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

module.exports = { getTrackingBoard, getSemaforo };
