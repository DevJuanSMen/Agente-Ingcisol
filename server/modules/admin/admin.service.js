const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { publishCommand } = require('../whatsapp/bot.ipc');

// Empresa "de sistema" que aloja al superadmin; se oculta del listado.
const SYSTEM_COMPANY_ID = 'system-platform';

const botKeys = (companyId) => ({
  enabled: `whatsapp:${companyId}:enabled`,
  status: `whatsapp:${companyId}:status`,
  qr: `whatsapp:${companyId}:qr`,
  pairingCode: `whatsapp:${companyId}:pairingCode`,
});

// Lista todas las empresas con su conteo de usuarios/proyectos y el estado del
// bot de WhatsApp (leído de Redis).
const listCompanies = async () => {
  const companies = await prisma.company.findMany({
    where: { id: { not: SYSTEM_COMPANY_ID } },
    select: {
      id: true,
      razonSocial: true,
      nit: true,
      createdAt: true,
      _count: { select: { users: true, projects: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(
    companies.map(async (c) => {
      const k = botKeys(c.id);
      const [enabled, status, qr, pairingCode] = await Promise.all([
        redis.get(k.enabled),
        redis.get(k.status),
        redis.get(k.qr),
        redis.get(k.pairingCode),
      ]);
      return {
        ...c,
        bot: {
          enabled: enabled === '1',
          status: status || 'disconnected',
          qrActivo: !!qr || !!pairingCode,
        },
      };
    })
  );
};

// Inhabilita el bot de una empresa: apaga el flag y destruye su sesión activa.
const disableBot = async (companyId) => {
  await redis.set(botKeys(companyId).enabled, '0');
  await publishCommand(redis, 'destroy', { companyId });
  return { enabled: false };
};

// Reactiva el flag (la vinculación con QR la hace la empresa desde su panel).
const enableBot = async (companyId) => {
  await redis.set(botKeys(companyId).enabled, '1');
  return { enabled: true };
};

module.exports = { listCompanies, disableBot, enableBot, SYSTEM_COMPANY_ID };
