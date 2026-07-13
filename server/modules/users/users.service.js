const bcrypt = require('bcryptjs');
const prisma = require('../../shared/db');
const { normalizeWhatsapp } = require('../../shared/utils/phone');
const { sendMail } = require('../../shared/mailer');

const ROL_LABEL = {
  DIRECTOR: 'Director', APOYO_DIRECTOR: 'Apoyo del Director', RESIDENTE: 'Residente',
  ALMACENISTA: 'Almacenista', CONTABILIDAD: 'Contabilidad',
};

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
    data: { companyId, nombre, email, passwordHash, whatsapp: normalizeWhatsapp(whatsapp) || null, rol, topeAprobacion: topeAprobacion || 0 },
    select: {
      id: true, nombre: true, email: true, whatsapp: true,
      rol: true, topeAprobacion: true, activo: true, createdAt: true,
    },
  });

  // Enviar las credenciales por correo al nuevo usuario (no bloquea la creación:
  // si el SMTP no está configurado o falla, el usuario igual queda creado).
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { razonSocial: true },
  });
  sendMail({
    to: email,
    subject: `Bienvenido a PROCURA AI — tus credenciales de acceso`,
    titulo: company?.razonSocial || 'Acceso al sistema',
    html: `
      <p>Hola <strong>${nombre}</strong>,</p>
      <p>Se creó tu cuenta en <strong>PROCURA AI</strong>${company ? ` para <strong>${company.razonSocial}</strong>` : ''} con el rol de <strong>${ROL_LABEL[rol] || rol}</strong>.</p>
      <table style="border-collapse:collapse;margin:12px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">Usuario:</td><td style="padding:4px 0"><strong>${email}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#64748b">Contraseña:</td><td style="padding:4px 0"><strong>${password}</strong></td></tr>
      </table>
      <p style="color:#64748b;font-size:12px">Te recomendamos cambiar la contraseña después del primer ingreso. Si no esperabas este correo, ignóralo.</p>
    `,
  }).catch(() => {});

  return user;
};

const updateUser = async (companyId, userId, data) => {
  const { nombre, rol, topeAprobacion, activo, whatsapp, password } = data;
  const user = await prisma.user.findFirst({ where: { id: userId, companyId } });
  if (!user) throw Object.assign(new Error('Usuario no encontrado'), { statusCode: 404 });

  const updateData = { rol, topeAprobacion, activo, whatsapp: normalizeWhatsapp(whatsapp) || null };
  if (nombre !== undefined) updateData.nombre = nombre;
  // El Director puede resetear la contraseña: si llega `password` no vacío, se actualiza.
  if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
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
