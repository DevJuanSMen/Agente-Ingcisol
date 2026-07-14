const prisma = require('../db');
const redis = require('../redis');

// Bloquea los módulos operativos mientras la empresa no complete el onboarding
// obligatorio (perfil, equipo, proyecto, presupuesto y proveedores). Los routers
// que el propio wizard necesita (company, users, projects, master-import,
// suppliers, etc.) NO llevan este middleware.
//
// Cache en Redis (TTL 60s) para no consultar la BD en cada request; se invalida
// al completar el onboarding (company.service.advanceOnboarding).

const CACHE_TTL = 60;
const cacheKey = (companyId) => `company:${companyId}:setupDone`;

const requireSetupComplete = async (req, res, next) => {
  try {
    if (!req.user) return next(); // verifyToken corre antes; por si acaso
    if (req.user.esSuperadmin) return next();

    const key = cacheKey(req.user.companyId);
    let done = await redis.get(key).catch(() => null);

    if (done === null) {
      const company = await prisma.company.findUnique({
        where: { id: req.user.companyId },
        select: { setupCompletedAt: true },
      });
      done = company?.setupCompletedAt ? '1' : '0';
      await redis.set(key, done, 'EX', CACHE_TTL).catch(() => {});
    }

    if (done !== '1') {
      return res.status(403).json({
        error: true,
        code: 'SETUP_INCOMPLETE',
        message: 'Debes completar la configuración inicial de tu empresa antes de usar este módulo.',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSetupComplete };
