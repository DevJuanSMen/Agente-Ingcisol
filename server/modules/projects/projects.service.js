const prisma = require('../../shared/db');

const listProjects = async (companyId) =>
  prisma.project.findMany({
    where: { companyId },
    include: {
      _count: {
        select: { requisitions: true, itemsAPU: true, budgetSheets: true, delegations: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

const getActiveProject = async (companyId) => {
  const project = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!project) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });
  return project;
};

const getProject = async (companyId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    include: {
      budgetSheets: { select: { id: true, nombre: true, orden: true, createdAt: true } },
      _count: { select: { requisitions: true, itemsAPU: true, delegations: true } },
    },
  });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });
  return project;
};

const createProject = async (companyId, data) => {
  const { nombre, contratoNo, entidad, descripcion, valor, inicio, fin, icono, color, estado } = data;
  return prisma.project.create({
    data: {
      companyId,
      nombre,
      contratoNo,
      entidad,
      descripcion,
      valor: valor ? parseFloat(valor) : null,
      inicio: inicio ? new Date(inicio) : null,
      fin: fin ? new Date(fin) : null,
      icono: icono || '🏗️',
      color: color || '#1B6FF5',
      estado: estado || 'PLANIFICADO',
      activo: false,
    },
  });
};

const updateProject = async (companyId, projectId, data) => {
  await getProject(companyId, projectId);
  const { nombre, contratoNo, entidad, descripcion, valor, inicio, fin, icono, color, estado } = data;
  return prisma.project.update({
    where: { id: projectId },
    data: {
      nombre,
      contratoNo,
      entidad,
      descripcion,
      valor: valor !== undefined ? (valor ? parseFloat(valor) : null) : undefined,
      inicio: inicio !== undefined ? (inicio ? new Date(inicio) : null) : undefined,
      fin: fin !== undefined ? (fin ? new Date(fin) : null) : undefined,
      icono,
      color,
      estado,
    },
  });
};

const activateProject = async (companyId, projectId) => {
  await getProject(companyId, projectId);
  return prisma.$transaction([
    prisma.project.updateMany({ where: { companyId }, data: { activo: false } }),
    prisma.project.update({ where: { id: projectId }, data: { activo: true } }),
  ]);
};

const getProjectDashboard = async (companyId, projectId) => {
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId },
    include: {
      itemsAPU: true,
      budgetSheets: { select: { id: true, nombre: true, orden: true } },
      _count: { select: { requisitions: true, delegations: true } },
    },
  });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });

  // Calcular consumo del presupuesto APU
  const totalPresupuesto = project.itemsAPU.reduce(
    (acc, i) => acc + Number(i.cantidad) * Number(i.precioUnitario), 0
  );
  const totalSaldo = project.itemsAPU.reduce((acc, i) => acc + Number(i.saldoValor), 0);
  const totalEjecutado = totalPresupuesto - totalSaldo;
  const pctEjecutado = totalPresupuesto > 0 ? (totalEjecutado / totalPresupuesto) * 100 : 0;

  // OC del proyecto
  const ordenes = await prisma.purchaseOrder.findMany({
    where: {
      quotation: {
        requisition: { projectId },
      },
    },
    select: { estado: true, montoTotal: true, fechaEntregaPactada: true },
  });

  const ocActivas = ordenes.filter((o) => !['COMPLETADA', 'CANCELADA'].includes(o.estado)).length;
  const ocVencidas = ordenes.filter(
    (o) => !['COMPLETADA', 'CANCELADA'].includes(o.estado) &&
      o.fechaEntregaPactada && new Date(o.fechaEntregaPactada) < new Date()
  ).length;
  const montoOC = ordenes.reduce((acc, o) => acc + Number(o.montoTotal), 0);

  // Delegaciones activas del proyecto
  const delegacionesActivas = await prisma.delegation.count({
    where: { projectId, companyId, estado: 'ACTIVA' },
  });
  const delegacionesVencidas = await prisma.delegation.count({
    where: {
      projectId, companyId, estado: 'ACTIVA',
      fechaLimite: { lt: new Date() },
    },
  });

  // Avance temporal del proyecto
  let pctTiempo = 0;
  if (project.inicio && project.fin) {
    const total = new Date(project.fin) - new Date(project.inicio);
    const transcurrido = Date.now() - new Date(project.inicio);
    pctTiempo = Math.min(100, Math.max(0, (transcurrido / total) * 100));
  }

  return {
    proyecto: {
      id: project.id,
      nombre: project.nombre,
      contratoNo: project.contratoNo,
      entidad: project.entidad,
      valor: project.valor,
      inicio: project.inicio,
      fin: project.fin,
      icono: project.icono,
      color: project.color,
      estado: project.estado,
      activo: project.activo,
    },
    presupuesto: {
      total: totalPresupuesto,
      ejecutado: totalEjecutado,
      saldo: totalSaldo,
      pctEjecutado: Math.round(pctEjecutado * 10) / 10,
      itemsAPU: project.itemsAPU.length,
    },
    ordenes: { activas: ocActivas, vencidas: ocVencidas, montoTotal: montoOC },
    delegaciones: { activas: delegacionesActivas, vencidas: delegacionesVencidas },
    requisiciones: project._count.requisitions,
    presupuestosHojas: project.budgetSheets,
    pctTiempo: Math.round(pctTiempo * 10) / 10,
  };
};

module.exports = {
  listProjects,
  getActiveProject,
  getProject,
  createProject,
  updateProject,
  activateProject,
  getProjectDashboard,
};
