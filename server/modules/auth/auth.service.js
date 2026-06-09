const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../shared/db');

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      rol: user.rol,
      companyId: user.companyId,
      topeAprobacion: user.topeAprobacion?.toString(),
    },
    process.env.JWT_SECRET,
    { expiresIn: EXPIRES_IN }
  );

const login = async (email, password) => {
  const user = await prisma.user.findUnique({
    where: { email },
    include: { company: { select: { razonSocial: true } } },
  });

  if (!user || !user.activo) {
    throw Object.assign(new Error('Credenciales inválidas'), { statusCode: 401 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw Object.assign(new Error('Credenciales inválidas'), { statusCode: 401 });
  }

  const token = signToken(user);
  const { passwordHash, ...safeUser } = user;
  return { token, user: safeUser };
};

const refreshToken = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.activo) {
    throw Object.assign(new Error('Usuario no válido'), { statusCode: 401 });
  }
  return signToken(user);
};

const me = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { select: { id: true, razonSocial: true, nit: true, logoUrl: true } } },
  });
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { statusCode: 404 });
  const { passwordHash, ...safeUser } = user;
  return safeUser;
};

module.exports = { login, refreshToken, me };
