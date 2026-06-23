const prisma = require('../../shared/db');

const listSuppliers = async (companyId, filters = {}) => {
  const where = { companyId };
  // Por defecto se ocultan los proveedores archivados (soft-delete)
  if (filters.includeInactive !== 'true') where.activo = true;
  if (filters.segmento) where.segmento = filters.segmento;
  if (filters.homologado !== undefined) where.homologado = filters.homologado === 'true';
  // projectId: proveedores del proyecto + los globales de la empresa
  if (filters.projectId) where.OR = [{ projectId: filters.projectId }, { projectId: null }];

  return prisma.supplier.findMany({
    where,
    include: { project: { select: { id: true, nombre: true } } },
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

// Elimina un proveedor. Si tiene historial de procura (cotizaciones, invitaciones,
// órdenes o historial de precios) NO se puede borrar sin corromper esos registros:
// en ese caso se ARCHIVA (soft-delete) para que desaparezca de los listados pero se
// conserve la trazabilidad. Si no tiene referencias, se borra de verdad.
const deleteSupplier = async (companyId, supplierId) => {
  await getSupplier(companyId, supplierId);

  const [quotationItems, invites, orders, priceHistory, wonQuotations] = await Promise.all([
    prisma.quotationItem.count({ where: { supplierId } }),
    prisma.quotationInvite.count({ where: { supplierId } }),
    prisma.purchaseOrder.count({ where: { supplierId } }),
    prisma.priceHistory.count({ where: { supplierId } }),
    prisma.quotation.count({ where: { proveedorGanadorId: supplierId } }),
  ]);

  const tieneHistorial = quotationItems + invites + orders + priceHistory + wonQuotations > 0;

  if (tieneHistorial) {
    await prisma.supplier.update({ where: { id: supplierId }, data: { activo: false } });
    return { archived: true };
  }

  await prisma.supplier.delete({ where: { id: supplierId } });
  return { archived: false };
};

const updateSupplier = async (companyId, supplierId, data) => {
  await getSupplier(companyId, supplierId);
  const { nombre, nit, ciudad, segmento, whatsapp, email, homologado } = data;
  return prisma.supplier.update({
    where: { id: supplierId },
    data: { nombre, nit, ciudad, segmento, whatsapp, email, homologado },
  });
};

const SEGMENTOS_VALIDOS = ['MATERIALES', 'EQUIPOS', 'HERRAMIENTAS', 'SERVICIOS'];

const importSuppliers = async (companyId, suppliers, projectId = null) => {
  const data = suppliers
    .map((s) => ({
      companyId,
      projectId,
      nombre: String(s.nombre || s.name || '').trim(),
      nit: s.nit ? String(s.nit).trim() : null,
      ciudad: s.ciudad || s.city || null,
      segmento: SEGMENTOS_VALIDOS.includes(s.segmento) ? s.segmento : 'MATERIALES',
      whatsapp: s.whatsapp || s.celular || null,
      email: s.email || s.correo || null,
      homologado: false,
      origen: 'LOCAL',
    }))
    .filter((s) => s.nombre);

  const created = await prisma.supplier.createMany({ data, skipDuplicates: true });
  return created.count;
};

module.exports = { listSuppliers, getSupplier, createSupplier, updateSupplier, deleteSupplier, importSuppliers };
