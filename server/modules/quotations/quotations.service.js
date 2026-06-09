const prisma = require('../../shared/db');

const listQuotations = async (companyId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  return prisma.quotation.findMany({
    where: { requisition: { projectId: { in: projectIds } } },
    include: {
      requisition: { select: { consecutivo: true, proyecto: false } },
      proveedorGanador: true,
      items: { include: { supplier: true, itemAPU: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

const getQuotation = async (companyId, quotationId) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      requisition: { include: { project: { select: { companyId: true } } } },
      proveedorGanador: true,
      items: { include: { supplier: true, itemAPU: true } },
    },
  });
  if (!quotation || quotation.requisition.project.companyId !== companyId) {
    throw Object.assign(new Error('Cotización no encontrada'), { statusCode: 404 });
  }
  return quotation;
};

const selectWinner = async (companyId, quotationId, supplierId) => {
  const quotation = await getQuotation(companyId, quotationId);
  if (quotation.estado !== 'PENDIENTE_APROBACION') {
    throw Object.assign(new Error('La cotización no está pendiente de aprobación'), { statusCode: 400 });
  }

  return prisma.quotation.update({
    where: { id: quotationId },
    data: { estado: 'APROBADA', proveedorGanadorId: supplierId },
  });
};

module.exports = { listQuotations, getQuotation, selectWinner };
