/**
 * Backfill de onboarding para empresas existentes.
 *
 * Se ejecuta UNA vez después de `prisma db push` (antes de desplegar el
 * frontend con el wizard), para que las empresas que ya operan no caigan
 * al onboarding obligatorio:
 *   - Toda empresa con ≥1 proyecto (o la empresa de sistema) queda marcada
 *     como configurada (setupCompletedAt = ahora, onboardingStep = 5).
 *   - De paso normaliza los números de WhatsApp de usuarios y proveedores
 *     (formato internacional 57XXXXXXXXXX), insumo del ruteo del bot global.
 *
 * Uso: node scripts/backfill-onboarding.js
 */
const prisma = require('../shared/db');
const { normalizeWhatsapp } = require('../shared/utils/phone');

const SYSTEM_COMPANY_ID = 'system-platform';

async function backfillSetup() {
  const companies = await prisma.company.findMany({
    select: { id: true, razonSocial: true, setupCompletedAt: true, _count: { select: { projects: true } } },
  });

  let marked = 0;
  for (const c of companies) {
    if (c.setupCompletedAt) continue;
    const isSystem = c.id === SYSTEM_COMPANY_ID;
    if (!isSystem && c._count.projects === 0) {
      console.log(`  ⏳ ${c.razonSocial} — sin proyectos, queda pendiente de onboarding`);
      continue;
    }
    await prisma.company.update({
      where: { id: c.id },
      data: { setupCompletedAt: new Date(), onboardingStep: 5 },
    });
    marked++;
    console.log(`  ✅ ${c.razonSocial} — marcada como configurada`);
  }
  console.log(`Empresas marcadas como configuradas: ${marked}/${companies.length}`);
}

async function normalizePhones(model, label) {
  const rows = await prisma[model].findMany({
    where: { whatsapp: { not: null } },
    select: { id: true, whatsapp: true },
  });
  let fixed = 0;
  for (const r of rows) {
    const norm = normalizeWhatsapp(r.whatsapp);
    if (norm && norm !== r.whatsapp) {
      await prisma[model].update({ where: { id: r.id }, data: { whatsapp: norm } });
      fixed++;
    }
  }
  console.log(`${label}: ${fixed}/${rows.length} números normalizados`);
}

async function main() {
  console.log('— Backfill de onboarding —');
  await backfillSetup();
  console.log('— Normalización de WhatsApp —');
  await normalizePhones('user', 'Usuarios');
  await normalizePhones('supplier', 'Proveedores');
  console.log('Listo.');
}

main()
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
