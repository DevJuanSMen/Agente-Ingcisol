const prisma = require('../../shared/db');

const getCompany = async (companyId) => {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw Object.assign(new Error('Empresa no encontrada'), { statusCode: 404 });
  return company;
};

const updateCompany = async (companyId, data) => {
  const { razonSocial, nit, telefono, direccion, ciudad } = data;
  return prisma.company.update({
    where: { id: companyId },
    data: { razonSocial, nit, telefono, direccion, ciudad },
  });
};

const updateLogo = async (companyId, base64DataUrl) => {
  if (!base64DataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('Formato de imagen inválido'), { statusCode: 400 });
  }
  return prisma.company.update({ where: { id: companyId }, data: { logoUrl: base64DataUrl } });
};

const updateFirma = async (companyId, base64DataUrl) => {
  if (!base64DataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('Formato de imagen inválido'), { statusCode: 400 });
  }
  return prisma.company.update({ where: { id: companyId }, data: { firmaUrl: base64DataUrl } });
};

module.exports = { getCompany, updateCompany, updateLogo, updateFirma };
