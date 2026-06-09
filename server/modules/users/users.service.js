const bcrypt = require('bcryptjs');
const prisma = require('../../shared/db');

const listUsers = async (companyId) =>
  prisma.user.findMany({
    where: { companyId },
    select: {
      id: true, nombre: true, email: true, whatsapp: true,
      rol: true, topeAprobacion: true, activo: true, createdAt: true,
    },
    orderBy: { nombre: 'asc' },
  });

const createUser = async (companyId, data) => {
  const { nombre, email, password, whatsapp, rol, topeAprobacion } = data;
  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw Object.assign(new Error('El email ya está registrado'), { statusCode: 409 });
  }

  const user = await prisma.user.create({
    data: { companyId, nombre, email, passwordHash, whatsapp, rol, topeAprobacion: topeAprobacion || 0 },
    select: {
      id: true, nombre: true, email: true, whatsapp: true,
      rol: true, topeAprobacion: true, activo: true, createdAt: true,
    },
  });
  return user;
};

const updateUser = async (companyId, userId, data) => {
  const { rol, topeAprobacion, activo, whatsapp } = data;
  const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { statusCode: 404 });

  return prisma.user.update({
    where: { id: userId },
    data: { rol, topeAprobacion, activo, whatsapp },
    select: {
      id: true, nombre: true, email: true, whatsapp: true,
      rol: true, topeAprobacion: true, activo: true, createdAt: true,
    },
  });
};

const deactivateUser = async (companyId, userId) => {
  const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { statusCode: 404 });

  return prisma.user.update({
    where: { id: userId },
    data: { activo: false },
  });
};

module.exports = { listUsers, createUser, updateUser, deactivateUser };
