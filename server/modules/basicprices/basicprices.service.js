const prisma = require('../../shared/db');

const listBasicPrices = (companyId, search) =>
  prisma.basicPrice.findMany({
    where: {
      companyId,
      ...(search && {
        OR: [
          { codigo: { contains: search, mode: 'insensitive' } },
          { descripcion: { contains: search, mode: 'insensitive' } },
        ],
      }),
    },
    orderBy: { codigo: 'asc' },
  });

const upsertBasicPrice = (companyId, data) => {
  const { codigo, descripcion, unidad, precioUnitario, fuente, vigencia } = data;
  return prisma.basicPrice.upsert({
    where: { companyId_codigo: { companyId, codigo } },
    update: { descripcion, unidad, precioUnitario: parseFloat(precioUnitario), fuente, vigencia: vigencia ? new Date(vigencia) : null },
    create: { companyId, codigo, descripcion, unidad, precioUnitario: parseFloat(precioUnitario), fuente, vigencia: vigencia ? new Date(vigencia) : null },
  });
};

const deleteBasicPrice = async (companyId, id) => {
  const existing = await prisma.basicPrice.findFirst({ where: { id, companyId } });
  if (!existing) throw Object.assign(new Error('Precio básico no encontrado'), { statusCode: 404 });
  return prisma.basicPrice.delete({ where: { id } });
};

const importBasicPrices = async (companyId, items) => {
  const ops = items.map((i) =>
    prisma.basicPrice.upsert({
      where: { companyId_codigo: { companyId, codigo: i.codigo } },
      update: { descripcion: i.descripcion, unidad: i.unidad, precioUnitario: parseFloat(i.precioUnitario) || 0 },
      create: { companyId, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, precioUnitario: parseFloat(i.precioUnitario) || 0 },
    })
  );
  await prisma.$transaction(ops);
  return items.length;
};

module.exports = { listBasicPrices, upsertBasicPrice, deleteBasicPrice, importBasicPrices };
