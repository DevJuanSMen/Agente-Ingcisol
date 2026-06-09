const prisma = require('../../shared/db');

const generateConsecutivo = async (projectId) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const year = new Date().getFullYear();
  const count = await prisma.requisition.count({
    where: { projectId, consecutivo: { startsWith: `REQ-${year}` } },
  });
  const projCode = project.contratoNo.split('-').pop() || 'PROY';
  return `REQ-${year}-${String(count + 1).padStart(3, '0')}-${projCode}`;
};

const listRequisitions = async (companyId, filters = {}) => {
  const { estado, projectId, solicitanteId } = filters;

  const projects = await prisma.project.findMany({
    where: { companyId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  const where = { projectId: { in: projectIds } };
  if (estado) where.estado = estado;
  if (projectId) where.projectId = projectId;
  if (solicitanteId) where.solicitanteId = solicitanteId;

  return prisma.requisition.findMany({
    where,
    include: {
      project: { select: { nombre: true, contratoNo: true } },
      solicitante: { select: { nombre: true, rol: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

const getRequisition = async (companyId, requisitionId) => {
  const req = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      project: { select: { companyId: true, nombre: true, contratoNo: true } },
      solicitante: { select: { nombre: true, rol: true, email: true } },
      aprobador: { select: { nombre: true, rol: true } },
      items: { include: { itemAPU: true } },
      quotation: { include: { items: { include: { supplier: true, itemAPU: true } } } },
    },
  });
  if (!req || req.project.companyId !== companyId) {
    throw Object.assign(new Error('Requisición no encontrada'), { statusCode: 404 });
  }
  return req;
};

const createRequisition = async (companyId, userId, data) => {
  const { projectId, items, prioridad, fechaLimite, canal } = data;

  const project = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });

  // Verifica qué ítems están en el APU
  const apuCodes = (items || []).map((i) => i.codigo).filter(Boolean);
  const apuItems = apuCodes.length
    ? await prisma.itemAPU.findMany({
        where: { projectId, codigo: { in: apuCodes } },
      })
    : [];
  const apuMap = Object.fromEntries(apuItems.map((a) => [a.codigo, a]));

  const allInAPU = items.every((i) => !i.codigo || apuMap[i.codigo]);
  const estado = allInAPU ? 'ENVIADA' : 'PENDIENTE_JUST';

  const consecutivo = await generateConsecutivo(projectId);

  const requisition = await prisma.requisition.create({
    data: {
      consecutivo,
      projectId,
      solicitanteId: userId,
      canal: canal || 'APP',
      estado,
      prioridad: prioridad || 'MEDIA',
      fechaLimite: fechaLimite ? new Date(fechaLimite) : null,
      items: {
        create: items.map((item) => ({
          descripcion: item.descripcion,
          cantidad: parseFloat(item.cantidad) || 1,
          unidad: item.unidad || 'GL',
          itemApuId: apuMap[item.codigo]?.id || null,
          enAPU: !!apuMap[item.codigo],
        })),
      },
    },
    include: { items: true },
  });

  // TODO: integrar notificación al Director via SendGrid/Twilio
  console.log('[requisitions] Nueva requisición creada:', {
    consecutivo,
    estado,
    itemsCount: items.length,
    itemsFueraAPU: items.filter((i) => i.codigo && !apuMap[i.codigo]).length,
  });

  return requisition;
};

const approveRequisition = async (companyId, requisitionId, approverId) => {
  const req = await getRequisition(companyId, requisitionId);
  if (!['ENVIADA', 'PENDIENTE_JUST'].includes(req.estado)) {
    throw Object.assign(
      new Error(`No se puede aprobar una requisición en estado ${req.estado}`),
      { statusCode: 400 }
    );
  }

  const updated = await prisma.requisition.update({
    where: { id: requisitionId },
    data: { estado: 'APROBADA', aprobadorId: approverId },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: approverId,
      accion: 'APROBAR_REQUISICION',
      entidad: 'Requisition',
      entidadId: requisitionId,
      metadata: { consecutivo: req.consecutivo },
    },
  });

  return updated;
};

const rejectRequisition = async (companyId, requisitionId, approverId, motivo) => {
  const req = await getRequisition(companyId, requisitionId);
  if (!['ENVIADA', 'PENDIENTE_JUST', 'APROBADA'].includes(req.estado)) {
    throw Object.assign(new Error(`No se puede rechazar en estado ${req.estado}`), { statusCode: 400 });
  }

  const updated = await prisma.requisition.update({
    where: { id: requisitionId },
    data: { estado: 'RECHAZADA', aprobadorId: approverId, motivoRechazo: motivo },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: approverId,
      accion: 'RECHAZAR_REQUISICION',
      entidad: 'Requisition',
      entidadId: requisitionId,
      metadata: { consecutivo: req.consecutivo, motivo },
    },
  });

  return updated;
};

module.exports = { listRequisitions, getRequisition, createRequisition, approveRequisition, rejectRequisition };
