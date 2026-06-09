const prisma = require('../../shared/db');

const list = async (companyId, filters = {}) => {
  const where = { companyId };
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.deleganteId) where.deleganteId = filters.deleganteId;
  if (filters.delegadoId) where.delegadoId = filters.delegadoId;
  if (filters.estado) where.estado = filters.estado;

  return prisma.delegation.findMany({
    where,
    include: {
      project:   { select: { id: true, nombre: true, icono: true } },
      delegante: { select: { id: true, nombre: true, rol: true } },
      delegado:  { select: { id: true, nombre: true, rol: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
};

const get = async (companyId, id) => {
  const d = await prisma.delegation.findFirst({
    where: { id, companyId },
    include: {
      project:   { select: { id: true, nombre: true, icono: true } },
      delegante: { select: { id: true, nombre: true, rol: true, email: true } },
      delegado:  { select: { id: true, nombre: true, rol: true, email: true } },
    },
  });
  if (!d) throw Object.assign(new Error('Delegación no encontrada'), { statusCode: 404 });
  return d;
};

const create = async (companyId, data, deleganteId) => {
  const { projectId, delegadoId, tarea, descripcion, fechaLimite } = data;

  const [project, delegado] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, companyId } }),
    prisma.user.findFirst({ where: { id: delegadoId, companyId } }),
  ]);
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });
  if (!delegado) throw Object.assign(new Error('Usuario delegado no encontrado'), { statusCode: 404 });

  return prisma.delegation.create({
    data: {
      companyId,
      projectId,
      deleganteId,
      delegadoId,
      tarea,
      descripcion,
      estado: 'ACTIVA',
      fechaLimite: fechaLimite ? new Date(fechaLimite) : null,
    },
    include: {
      project:   { select: { id: true, nombre: true, icono: true } },
      delegante: { select: { id: true, nombre: true, rol: true } },
      delegado:  { select: { id: true, nombre: true, rol: true } },
    },
  });
};

const updateEstado = async (companyId, id, estado, notas, userId) => {
  const d = await prisma.delegation.findFirst({ where: { id, companyId } });
  if (!d) throw Object.assign(new Error('Delegación no encontrada'), { statusCode: 404 });

  // Solo delegante o delegado pueden cambiar estado
  if (d.deleganteId !== userId && d.delegadoId !== userId) {
    throw Object.assign(new Error('Sin permiso para modificar esta delegación'), { statusCode: 403 });
  }

  const data = { estado, notas };
  if (estado === 'COMPLETADA') data.fechaComplecion = new Date();

  return prisma.delegation.update({
    where: { id },
    data,
    include: {
      project:   { select: { id: true, nombre: true, icono: true } },
      delegante: { select: { id: true, nombre: true, rol: true } },
      delegado:  { select: { id: true, nombre: true, rol: true } },
    },
  });
};

const getStats = async (companyId, projectId) => {
  const where = { companyId };
  if (projectId) where.projectId = projectId;

  const [total, activas, completadas, revocadas, vencidas] = await Promise.all([
    prisma.delegation.count({ where }),
    prisma.delegation.count({ where: { ...where, estado: 'ACTIVA' } }),
    prisma.delegation.count({ where: { ...where, estado: 'COMPLETADA' } }),
    prisma.delegation.count({ where: { ...where, estado: 'REVOCADA' } }),
    prisma.delegation.count({
      where: {
        ...where,
        estado: 'ACTIVA',
        fechaLimite: { lt: new Date() },
      },
    }),
  ]);

  return { total, activas, completadas, revocadas, vencidas };
};

module.exports = { list, get, create, updateEstado, getStats };
