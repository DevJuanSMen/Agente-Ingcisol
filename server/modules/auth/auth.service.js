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

// Registro inicial: crea la empresa y su primer usuario como Director
const register = async ({ razonSocial, nit, nombre, email, password, whatsapp }) => {
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw Object.assign(new Error('El email ya está registrado'), { statusCode: 409 });
  }
  const existingCompany = await prisma.company.findUnique({ where: { nit } });
  if (existingCompany) {
    throw Object.assign(new Error('Ya existe una empresa registrada con ese NIT'), { statusCode: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { razonSocial, nit },
    });
    return tx.user.create({
      data: {
        companyId: company.id,
        nombre,
        email,
        passwordHash,
        whatsapp: whatsapp || null,
        rol: 'DIRECTOR',
      },
      include: { company: { select: { razonSocial: true } } },
    });
  });

  const token = signToken(user);
  const { passwordHash: _ph, ...safeUser } = user;
  return { token, user: safeUser };
};

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

module.exports = { register, login, refreshToken, me };
