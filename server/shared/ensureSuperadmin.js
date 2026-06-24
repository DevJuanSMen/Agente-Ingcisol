const bcrypt = require('bcryptjs');
const prisma = require('./db');
const { logger } = require('./utils/logger');

const SYSTEM_COMPANY_ID = 'system-platform';

// Crea/asegura el usuario superadmin a partir de variables de entorno, de forma
// idempotente, al arrancar el API. Así existe en producción sin correr el seed.
// No pisa la contraseña en cada arranque (solo la fija al crearlo).
async function ensureSuperadmin() {
  const email = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!email || !password) {
    logger.info('[superadmin] SUPERADMIN_EMAIL/PASSWORD no configurados; se omite el bootstrap.');
    return;
  }

  try {
    const company = await prisma.company.upsert({
      where: { id: SYSTEM_COMPANY_ID },
      update: {},
      create: { id: SYSTEM_COMPANY_ID, razonSocial: 'PROCURA AI — Plataforma', nit: 'PLATFORM-SUPERADMIN' },
    });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (!existing.esSuperadmin) {
        await prisma.user.update({ where: { id: existing.id }, data: { esSuperadmin: true } });
      }
      logger.info(`[superadmin] Asegurado (existente): ${email}`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.user.create({
      data: {
        companyId: company.id,
        nombre: 'Superadmin',
        email,
        passwordHash,
        rol: 'DIRECTOR',
        esSuperadmin: true,
      },
    });
    logger.info(`[superadmin] Creado: ${email}`);
  } catch (err) {
    logger.error(`[superadmin] No se pudo asegurar el superadmin: ${err.message}`);
  }
}

module.exports = { ensureSuperadmin, SYSTEM_COMPANY_ID };
