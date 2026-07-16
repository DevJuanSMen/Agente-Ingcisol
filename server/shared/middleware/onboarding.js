const prisma = require('../db');
const redis = require('../redis');
const { accessCacheKey } = require('../../modules/company/company.service');

// Bloquea los módulos operativos mientras la empresa no complete el onboarding
// obligatorio (perfil, equipo, proyecto, presupuesto y proveedores) NI mientras
// el superadmin no apruebe esa configuración inicial. Los routers que el propio
// wizard necesita (company, users, projects, master-import, suppliers, etc.)
// NO llevan este middleware.
//
// Cache en Redis (TTL 60s) para no consultar la BD en cada request; se invalida
// al completar el onboarding y al aprobar/rechazar (company.service, admin.service).

const CACHE_TTL = 60;

const requireSetupComplete = async (req, res, next) => {
  try {
    if (!req.user) return next(); // verifyToken corre antes; por si acaso
    if (req.user.esSuperadmin) return next();

    const key = accessCacheKey(req.user.companyId);
    let status = await redis.get(key).catch(() => null);

    if (status === null) {
      const company = await prisma.company.findUnique({
        where: { id: req.user.companyId },
        select: { setupCompletedAt: true, approvalStatus: true },
      });
      status = !company?.setupCompletedAt ? 'incomplete' : company.approvalStatus.toLowerCase();
      await redis.set(key, status, 'EX', CACHE_TTL).catch(() => {});
    }

    if (status === 'incomplete') {
      return res.status(403).json({
        error: true,
        code: 'SETUP_INCOMPLETE',
        message: 'Debes completar la configuración inicial de tu empresa antes de usar este módulo.',
      });
    }
    if (status !== 'approved') {
      return res.status(403).json({
        error: true,
        code: status === 'rejected' ? 'APPROVAL_REJECTED' : 'APPROVAL_PENDING',
        message: status === 'rejected'
          ? 'Tu configuración inicial fue rechazada. Corrígela y vuelve a enviarla para revisión.'
          : 'Tu configuración está en revisión por el equipo de PROCURA AI.',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { requireSetupComplete };
