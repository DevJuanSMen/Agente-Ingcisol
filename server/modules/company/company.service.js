const prisma = require('../../shared/db');

const getCompany = async (companyId) => {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw Object.assign(new Error('Empresa no encontrada'), { statusCode: 404 });
  return company;
};

const updateCompany = async (companyId, data) => {
  const {
    razonSocial, nit, representanteLegal, emailCorporativo,
    telefono, direccion, ciudad, banco, tipoCuenta, numeroCuenta,
    ivaPorcentaje, retefuentePorcentaje, reteIcaPorMil,
  } = data;
  const numOr = (v, def) => (v === '' || v === null || v === undefined ? def : Number(v));
  return prisma.company.update({
    where: { id: companyId },
    data: {
      razonSocial, nit, representanteLegal, emailCorporativo,
      telefono, direccion, ciudad, banco, tipoCuenta, numeroCuenta,
      ivaPorcentaje: numOr(ivaPorcentaje, 19),
      retefuentePorcentaje: numOr(retefuentePorcentaje, 0),
      reteIcaPorMil: numOr(reteIcaPorMil, 0),
    },
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
