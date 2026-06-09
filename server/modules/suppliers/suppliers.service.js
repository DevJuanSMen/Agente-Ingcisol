const prisma = require('../../shared/db');

const listSuppliers = async (companyId, filters = {}) => {
  const where = { companyId };
  if (filters.segmento) where.segmento = filters.segmento;
  if (filters.homologado !== undefined) where.homologado = filters.homologado === 'true';

  return prisma.supplier.findMany({
    where,
    orderBy: { nombre: 'asc' },
  });
};

const getSupplier = async (companyId, supplierId) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId },
  });
  if (!supplier) throw Object.assign(new Error('Proveedor no encontrado'), { statusCode: 404 });
  return supplier;
};

const createSupplier = async (companyId, data) => {
  const { nombre, nit, ciudad, segmento, whatsapp, email, homologado } = data;
  return prisma.supplier.create({
    data: { companyId, nombre, nit, ciudad, segmento, whatsapp, email, homologado: homologado || false },
  });
};

const updateSupplier = async (companyId, supplierId, data) => {
  await getSupplier(companyId, supplierId);
  const { nombre, nit, ciudad, segmento, whatsapp, email, homologado } = data;
  return prisma.supplier.update({
    where: { id: supplierId },
    data: { nombre, nit, ciudad, segmento, whatsapp, email, homologado },
  });
};

const importSuppliers = async (companyId, suppliers) => {
  const created = await prisma.supplier.createMany({
    data: suppliers.map((s) => ({
      companyId,
      nombre: String(s.nombre || s.name || ''),
      nit: s.nit ? String(s.nit) : null,
      ciudad: s.ciudad || s.city || null,
      segmento: s.segmento || 'MATERIALES',
      whatsapp: s.whatsapp || s.celular || null,
      email: s.email || s.correo || null,
      homologado: false,
      origen: 'LOCAL',
    })),
    skipDuplicates: true,
  });
  return created.count;
};

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, importSuppliers };
