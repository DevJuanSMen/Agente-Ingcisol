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

// Crea un ítem individual en el proyecto activo sin tocar los existentes
const createItem = async (companyId, data) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  const codigo = String(data.codigo || '').trim();
  const descripcion = String(data.descripcion || '').trim();
  if (!codigo || !descripcion) {
    throw Object.assign(new Error('Código y descripción son requeridos'), { statusCode: 400 });
  }

  const existing = await prisma.itemAPU.findUnique({
    where: { projectId_codigo: { projectId: activeProject.id, codigo } },
  });
  if (existing) {
    throw Object.assign(new Error(`Ya existe un ítem APU con el código ${codigo} en este proyecto`), { statusCode: 409 });
  }

  const cantidad = parseFloat(data.cantidad) || 0;
  const precioUnitario = parseFloat(data.precioUnitario) || 0;

  return prisma.itemAPU.create({
    data: {
      projectId: activeProject.id,
      codigo,
      descripcion,
      unidad: String(data.unidad || 'GL').trim() || 'GL',
      cantidad,
      precioUnitario,
      saldoCantidad: cantidad,
      saldoValor: cantidad * precioUnitario,
    },
  });
};

const importAPU = async (companyId, items) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  // Deduplicar por codigo antes de insertar (el Excel puede tener filas repetidas)
  const seen = new Map();
  for (const item of items) {
    const codigo      = String(item.codigo      || '').trim();
    const descripcion = String(item.descripcion || '').trim();
    if (!codigo || !descripcion) continue;
    seen.set(codigo, item);
  }
  const deduped = [...seen.values()];

  await prisma.$transaction(async (tx) => {
    await tx.itemAPU.deleteMany({ where: { projectId: activeProject.id } });
    await tx.itemAPU.createMany({
      data: deduped.map((item) => ({
        projectId:      activeProject.id,
        codigo:         String(item.codigo).trim(),
        descripcion:    String(item.descripcion).trim(),
        unidad:         String(item.unidad || 'GL'),
        cantidad:       parseFloat(item.cantidad) || 0,
        precioUnitario: parseFloat(item.precioUnitario || item.precio_unitario || 0),
        saldoCantidad:  parseFloat(item.cantidad) || 0,
        saldoValor:
          (parseFloat(item.cantidad) || 0) *
          (parseFloat(item.precioUnitario || item.precio_unitario) || 0),
      })),
    });
  });

  return prisma.itemAPU.count({ where: { projectId: activeProject.id } });
};

module.exports = { getAPUTree, getItem, createItem, importAPU };
