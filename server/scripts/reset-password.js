/**
 * Reseteo de contraseña desde la consola del servidor.
 *
 * Pensado para el caso en que el DIRECTOR olvida su propia contraseña y no hay
 * nadie por encima que pueda resetearla desde la app. Se ejecuta con acceso al
 * servidor (p.ej. la consola de Railway), por lo que no necesita correo.
 *
 * Uso:
 *   node scripts/reset-password.js correo@empresa.com "NuevaClave123"
 *   npm run pwd:reset -- correo@empresa.com "NuevaClave123"
 *
 * Si no se pasa la contraseña, se genera una temporal y se imprime en pantalla.
 */
const bcrypt = require('bcryptjs');
const prisma = require('../shared/db');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  let password = process.argv[3];

  if (!email) {
    console.error('Falta el correo.\nUso: node scripts/reset-password.js correo@empresa.com "NuevaClave"');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No existe ningún usuario con el correo: ${email}`);
    process.exit(1);
  }

  // Si no dan contraseña, generar una temporal legible.
  const generated = !password;
  if (generated) {
    password = 'Procura-' + Math.random().toString(36).slice(2, 8);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, activo: true } });

  console.log('\n✅ Contraseña actualizada correctamente.');
  console.log(`   Usuario: ${user.nombre} (${email}) — rol ${user.rol}`);
  if (generated) {
    console.log(`   Contraseña temporal: ${password}`);
    console.log('   Pídele al usuario que la cambie después de entrar.');
  }
  console.log('');
}

main()
  .catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
