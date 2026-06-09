const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('Ejecutando seed...');

  const company = await prisma.company.upsert({
    where: { nit: '901234567-8' },
    update: {},
    create: {
      razonSocial: 'INGCISOL Ingeniería y Construcción S.A.S.',
      nit: '901234567-8',
    },
  });

  console.log(`Empresa creada: ${company.razonSocial}`);

  const passwordHash = await bcrypt.hash('Director2026!', 12);

  const director = await prisma.user.upsert({
    where: { email: 'director@ingcisol.com' },
    update: {},
    create: {
      companyId: company.id,
      nombre: 'Iván René Mejía Peñate',
      email: 'director@ingcisol.com',
      passwordHash,
      whatsapp: '573123456789',
      rol: 'DIRECTOR',
    },
  });

  console.log(`Usuario Director creado: ${director.email}`);

  const apoyoHash = await bcrypt.hash('Apoyo2026!', 12);
  await prisma.user.upsert({
    where: { email: 'apoyo@ingcisol.com' },
    update: {},
    create: {
      companyId: company.id,
      nombre: 'María Fernanda Torres',
      email: 'apoyo@ingcisol.com',
      passwordHash: apoyoHash,
      whatsapp: '573112345678',
      rol: 'APOYO_DIRECTOR',
      topeAprobacion: 5000000,
    },
  });

  // Usuarios adicionales para delegaciones
  const roles = [
    { email: 'obra@ingcisol.com', nombre: 'Carlos Pérez', rol: 'RESIDENTE', pwd: 'Residente2026!', whatsapp: '573109876543' },
    { email: 'almacen@ingcisol.com', nombre: 'Luis Martínez', rol: 'ALMACENISTA', pwd: 'Almacen2026!', whatsapp: '573118765432' },
    { email: 'contab@ingcisol.com', nombre: 'Contabilidad INGCISOL', rol: 'CONTABILIDAD', pwd: 'Contab2026!', whatsapp: '573107654321' },
  ];
  for (const r of roles) {
    const h = await bcrypt.hash(r.pwd, 12);
    await prisma.user.upsert({
      where: { email: r.email },
      update: {},
      create: { companyId: company.id, nombre: r.nombre, email: r.email, passwordHash: h, whatsapp: r.whatsapp, rol: r.rol },
    });
  }

  const proyecto = await prisma.project.upsert({
    where: { id: 'seed-project-001' },
    update: {},
    create: {
      id: 'seed-project-001',
      companyId: company.id,
      nombre: 'IE Liceo Valledupar – Infraestructura',
      contratoNo: 'CONT-2026-EDU-001',
      entidad: 'Secretaría de Educación de Valledupar',
      valor: 999805402,
      inicio: new Date('2026-05-09'),
      fin: new Date('2026-12-31'),
      icono: '🏫',
      color: '#F5A623',
      estado: 'EN_EJECUCION',
      activo: true,
    },
  });

  console.log(`Proyecto activo creado: ${proyecto.nombre}`);
  console.log('\nSeed completado exitosamente.');
  console.log('─────────────────────────────────────');
  console.log('Credenciales de acceso:');
  console.log('  Email:    director@ingcisol.com');
  console.log('  Password: Director2026!');
  console.log('─────────────────────────────────────');
}

main()
  .catch((e) => {
    console.error('Error en seed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
