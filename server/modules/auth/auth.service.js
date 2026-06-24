const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { publishCommand } = require('../whatsapp/bot.ipc');

// ── Recuperación de contraseña por código de WhatsApp ───────────────────────
const RESET_TTL = 600;                       // 10 minutos de vigencia del código
const MAX_RESET_TRIES = 5;                   // intentos antes de invalidar el código
const codeKey = (userId) => `pwreset:code:${userId}`;
const triesKey = (userId) => `pwreset:tries:${userId}`;
const gen6 = () => String(Math.floor(100000 + Math.random() * 900000));

const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const signToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      rol: user.rol,
      companyId: user.companyId,
      topeAprobacion: user.topeAprobacion?.toString(),
      esSuperadmin: !!user.esSuperadmin,
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

// Paso 1: el usuario pide recuperar su contraseña. Si tiene WhatsApp registrado
// y el bot de su empresa está conectado, le enviamos un código de 6 dígitos.
// Respuesta genérica (no revela si el correo existe) salvo el hint del número.
const requestPasswordReset = async (email) => {
  const generic = { sent: false };
  const normalized = (email || '').trim().toLowerCase();
  if (!normalized) return generic;

  const user = await prisma.user.findUnique({ where: { email: normalized } });
  if (!user || !user.activo || !user.whatsapp) return generic;

  // ¿El bot de la empresa está habilitado y conectado?
  const [enabled, status] = await Promise.all([
    redis.get(`whatsapp:${user.companyId}:enabled`),
    redis.get(`whatsapp:${user.companyId}:status`),
  ]);
  if (enabled !== '1' || status !== 'ready') {
    // Sin canal para enviar el código: el frontend mostrará que contacte al Director.
    return { sent: false, botUnavailable: true };
  }

  const code = gen6();
  await redis.set(codeKey(user.id), code, 'EX', RESET_TTL);
  await redis.del(triesKey(user.id));

  await publishCommand(redis, 'send_password_reset_code', {
    companyId: user.companyId,
    phone: user.whatsapp,
    code,
    nombre: user.nombre,
  });

  const wa = String(user.whatsapp);
  const hint = wa.length > 4 ? `••• ${wa.slice(-4)}` : wa;
  return { sent: true, channel: 'whatsapp', hint };
};

// Paso 2: el usuario ingresa el código recibido y su nueva contraseña.
const resetPasswordWithCode = async (email, code, newPassword) => {
  const invalid = () => Object.assign(new Error('Código inválido o expirado'), { statusCode: 400 });
  const normalized = (email || '').trim().toLowerCase();
  const user = normalized ? await prisma.user.findUnique({ where: { email: normalized } }) : null;
  if (!user) throw invalid();

  const stored = await redis.get(codeKey(user.id));
  if (!stored) throw invalid();

  const tries = await redis.incr(triesKey(user.id));
  await redis.expire(triesKey(user.id), RESET_TTL);
  if (tries > MAX_RESET_TRIES) {
    await redis.del(codeKey(user.id));
    throw Object.assign(new Error('Demasiados intentos. Solicita un nuevo código.'), { statusCode: 429 });
  }

  if (stored !== String(code || '').trim()) throw invalid();

  if (!newPassword || String(newPassword).length < 8) {
    throw Object.assign(new Error('La contraseña debe tener al menos 8 caracteres'), { statusCode: 400 });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  await redis.del(codeKey(user.id));
  await redis.del(triesKey(user.id));
  return { ok: true };
};

module.exports = { register, login, refreshToken, me, requestPasswordReset, resetPasswordWithCode };
