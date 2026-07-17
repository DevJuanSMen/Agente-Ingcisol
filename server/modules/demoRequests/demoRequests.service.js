const prisma = require('../../shared/db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const create = async ({ nombre, email, telefono }) => {
  const data = {
    nombre: String(nombre || '').trim(),
    email: String(email || '').trim().toLowerCase(),
    telefono: String(telefono || '').trim(),
  };
  if (!data.nombre || !data.email || !data.telefono) {
    const err = new Error('Nombre, correo y teléfono son requeridos');
    err.statusCode = 400;
    throw err;
  }
  if (!EMAIL_RE.test(data.email)) {
    const err = new Error('El correo no tiene un formato válido');
    err.statusCode = 400;
    throw err;
  }
  return prisma.demoRequest.create({ data });
};

const list = () => prisma.demoRequest.findMany({ orderBy: { createdAt: 'desc' } });

module.exports = { create, list };
