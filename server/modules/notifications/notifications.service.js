const prisma = require('../../shared/db');

// TODO: integrar SendGrid para email y Twilio para WhatsApp

const sendEmail = async ({ to, subject, html }) => {
  console.log('[notifications] Enviaría email:', { to, subject });
  // TODO: integrar SendGrid
};

const sendWhatsApp = async ({ to, body }) => {
  console.log('[notifications] Enviaría WhatsApp:', { to, body: body.slice(0, 50) });
  // TODO: integrar Twilio
};

// ─── Notificaciones in-app ────────────────────────────────────────────────────

const createNotification = async ({ companyId, userId, tipo, titulo, mensaje, entidad, entidadId }) =>
  prisma.notification.create({
    data: { companyId, userId, tipo, titulo, mensaje, entidad, entidadId },
  });

// Notifica a todos los usuarios activos de la empresa con alguno de los roles dados
const notifyRoles = async (companyId, roles, { tipo, titulo, mensaje, entidad, entidadId, excludeUserId }) => {
  const users = await prisma.user.findMany({
    where: { companyId, rol: { in: roles }, activo: true },
    select: { id: true },
  });
  const targets = users.filter((u) => u.id !== excludeUserId);
  if (targets.length === 0) return 0;
  await prisma.notification.createMany({
    data: targets.map((u) => ({
      companyId, userId: u.id, tipo, titulo, mensaje, entidad, entidadId,
    })),
  });
  return targets.length;
};

const notifyUser = async (companyId, userId, { tipo, titulo, mensaje, entidad, entidadId }) =>
  createNotification({ companyId, userId, tipo, titulo, mensaje, entidad, entidadId });

const listNotifications = async (userId, { limit = 20 } = {}) =>
  prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Number(limit) || 20,
  });

const unreadCount = async (userId) =>
  prisma.notification.count({ where: { userId, leida: false } });

const markRead = async (userId, notificationId) =>
  prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { leida: true },
  });

const markAllRead = async (userId) =>
  prisma.notification.updateMany({
    where: { userId, leida: false },
    data: { leida: true },
  });

// ─── Notificaciones de negocio (email — legacy) ───────────────────────────────

const notifyNewRequisition = async (director, requisicion) => {
  await sendEmail({
    to: director.email,
    subject: `Nueva requisición ${requisicion.consecutivo} — PROCURA AI`,
    html: `<p>Se ha creado la requisición <strong>${requisicion.consecutivo}</strong> esperando su aprobación.</p>`,
  });
};

const notifyOrderDelivery = async (contabilidad, orden) => {
  await sendEmail({
    to: contabilidad.email,
    subject: `OC ${orden.consecutivo} entregada — Registrar pago`,
    html: `<p>La orden <strong>${orden.consecutivo}</strong> fue marcada como entregada. Por favor registre el pago.</p>`,
  });
};

module.exports = {
  sendEmail,
  sendWhatsApp,
  createNotification,
  notifyRoles,
  notifyUser,
  listNotifications,
  unreadCount,
  markRead,
  markAllRead,
  notifyNewRequisition,
  notifyOrderDelivery,
};
