const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { enqueueText } = require('../whatsapp/sendQueue');
const { accessCacheKey } = require('../company/company.service');
const demoRequestsService = require('../demoRequests/demoRequests.service');

// Empresa "de sistema" que aloja al superadmin; se oculta del listado.
const SYSTEM_COMPANY_ID = 'system-platform';

const enabledKey = (companyId) => `whatsapp:${companyId}:enabled`;

// El flag por empresa es un interruptor de EXCLUSIÓN: sin flag (o '1') la
// empresa usa el bot global; solo '0' explícito la apaga.
const botEnabled = async (companyId) => (await redis.get(enabledKey(companyId))) !== '0';

// Lista todas las empresas con su conteo de usuarios/proyectos y si están
// habilitadas en el bot global.
const listCompanies = async () => {
  const companies = await prisma.company.findMany({
    where: { id: { not: SYSTEM_COMPANY_ID } },
    select: {
      id: true,
      razonSocial: true,
      nit: true,
      createdAt: true,
      setupCompletedAt: true,
      approvalStatus: true,
      rejectionReason: true,
      _count: { select: { users: true, projects: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(
    companies.map(async (c) => ({
      ...c,
      bot: { enabled: await botEnabled(c.id) },
    }))
  );
};

// Vista completa de la plataforma: empresas con sus miembros y proyectos.
const getOverview = async () => {
  const companies = await prisma.company.findMany({
    where: { id: { not: SYSTEM_COMPANY_ID } },
    select: {
      id: true,
      razonSocial: true,
      nit: true,
      ciudad: true,
      createdAt: true,
      onboardingStep: true,
      setupCompletedAt: true,
      approvalStatus: true,
      rejectionReason: true,
      users: {
        select: { id: true, nombre: true, email: true, rol: true, whatsapp: true, activo: true },
        orderBy: { createdAt: 'asc' },
      },
      projects: {
        select: { id: true, nombre: true, contratoNo: true, estado: true, activo: true, ciudad: true },
        orderBy: { createdAt: 'desc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(
    companies.map(async (c) => ({
      ...c,
      bot: { enabled: await botEnabled(c.id) },
    }))
  );
};

// ── Solicitudes de nuevo usuario (aprobación tras onboarding) ───────────────
// El director queda en PENDING al terminar el wizard (company.service.
// advanceOnboarding); no entra al panel hasta que el superadmin apruebe aquí.

const notifyDirectors = async (companyId, message) => {
  const directors = await prisma.user.findMany({
    where: { companyId, rol: 'DIRECTOR', activo: true, esSuperadmin: false },
    select: { whatsapp: true },
  });
  for (const d of directors) {
    if (d.whatsapp) enqueueText(companyId, d.whatsapp, message);
  }
};

const approveCompany = async (companyId) => {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { approvalStatus: 'APPROVED', approvedAt: new Date(), rejectedAt: null, rejectionReason: null },
  });
  await redis.del(accessCacheKey(companyId)).catch(() => {});
  await notifyDirectors(
    companyId,
    `✅ *PROCURA AI*\n\n¡Usuario aprobado exitosamente! *${company.razonSocial}* ya está activa. Ingresa a la plataforma para empezar a operar.`
  );
  return company;
};

const rejectCompany = async (companyId, motivo) => {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { approvalStatus: 'REJECTED', rejectedAt: new Date(), rejectionReason: motivo },
  });
  await redis.del(accessCacheKey(companyId)).catch(() => {});
  await notifyDirectors(
    companyId,
    `⚠️ *PROCURA AI*\n\nTu solicitud para *${company.razonSocial}* fue rechazada.\nMotivo: ${motivo}\n\nCorrige la configuración desde el asistente y vuelve a enviarla para revisión.`
  );
  return company;
};

// Estado de la sesión ÚNICA global de WhatsApp (QR del superadmin).
const getWhatsappStatus = async () => {
  const [status, qr] = await Promise.all([
    redis.get('whatsapp:global:status'),
    redis.get('whatsapp:global:qr'),
  ]);
  return { status: status || 'disconnected', qr: qr || null };
};

// Excluye a una empresa del bot global (solo apaga el flag; la sesión sigue viva
// para las demás empresas).
const disableBot = async (companyId) => {
  await redis.set(enabledKey(companyId), '0');
  return { enabled: false };
};

const enableBot = async (companyId) => {
  await redis.set(enabledKey(companyId), '1');
  return { enabled: true };
};

// Últimos registros de interpretación/ruteo del bot (BotParseLog), con el nombre
// de la empresa resuelto. Es la vista "por qué el bot no respondió" del panel.
const getBotLogs = async (limit = 30) => {
  const logs = await prisma.botParseLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(Number(limit) || 30, 100),
  });
  const companyIds = [...new Set(logs.map((l) => l.companyId).filter(Boolean))];
  const companies = companyIds.length
    ? await prisma.company.findMany({
        where: { id: { in: companyIds } },
        select: { id: true, razonSocial: true },
      })
    : [];
  const nameById = new Map(companies.map((c) => [c.id, c.razonSocial]));
  return logs.map((l) => ({ ...l, empresa: l.companyId ? nameById.get(l.companyId) || l.companyId : null }));
};

// Solicitudes de demo enviadas desde la página pública /demo.
const getDemoRequests = () => demoRequestsService.list();

module.exports = {
  listCompanies, getOverview, getWhatsappStatus, disableBot, enableBot, getBotLogs, SYSTEM_COMPANY_ID,
  approveCompany, rejectCompany, getDemoRequests,
};
