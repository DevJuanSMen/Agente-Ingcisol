const prisma = require('../../shared/db');

const getAPUTree = async (companyId) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  const items = await prisma.itemAPU.findMany({
    where: { projectId: activeProject.id },
    orderBy: { codigo: 'asc' },
  });

  // Construir árbol: capítulo = primer segmento del código (ej: "01", "02")
  const tree = {};
  for (const item of items) {
    const parts = item.codigo.split('.');
    const chapter = parts[0];
    if (!tree[chapter]) tree[chapter] = { capitulo: chapter, items: [] };
    tree[chapter].items.push(item);
  }

  return { project: activeProject, tree: Object.values(tree) };
};

const getItem = async (companyId, itemId) => {
  const item = await prisma.itemAPU.findUnique({
    where: { id: itemId },
    include: {
      project: { select: { companyId: true, nombre: true } },
      priceHistory: { include: { supplier: true }, orderBy: { fecha: 'desc' }, take: 10 },
    },
  });
  if (!item || item.project.companyId !== companyId) {
    throw Object.assign(new Error('Ítem APU no encontrado'), { statusCode: 404 });
  }
  return item;
};

const importAPU = async (companyId, items) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  // Limpia los ítems anteriores y carga los nuevos en una transacción
  const operations = [
    prisma.itemAPU.deleteMany({ where: { projectId: activeProject.id } }),
    prisma.itemAPU.createMany({
      data: items.map((item) => ({
        projectId: activeProject.id,
        codigo: String(item.codigo),
        descripcion: String(item.descripcion),
        unidad: String(item.unidad || 'GL'),
        cantidad: parseFloat(item.cantidad) || 0,
        precioUnitario: parseFloat(item.precioUnitario || item.precio_unitario || 0),
        saldoCantidad: parseFloat(item.cantidad) || 0,
        saldoValor:
          (parseFloat(item.cantidad) || 0) *
          (parseFloat(item.precioUnitario || item.precio_unitario) || 0),
      })),
    }),
  ];

  await prisma.$transaction(operations);
  return prisma.itemAPU.count({ where: { projectId: activeProject.id } });
};

module.exports = { getAPUTree, getItem, importAPU };
