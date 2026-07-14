const prisma = require('../../shared/db');
const redis = require('../../shared/redis');

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

module.exports = { listCompanies, getOverview, getWhatsappStatus, disableBot, enableBot, SYSTEM_COMPANY_ID };
