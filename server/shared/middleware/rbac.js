const { forbidden } = require('../utils/response');

// Verifica que el usuario tenga alguno de los roles indicados
const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.rol)) {
    return forbidden(res, `Se requiere uno de los roles: ${roles.join(', ')}`);
  }
  next();
};

// Para APOYO_DIRECTOR: verifica que el monto no supere su tope configurado
const requireTope = (getAmount) => (req, res, next) => {
  if (req.user.rol !== 'APOYO_DIRECTOR') return next();

  const amount = typeof getAmount === 'function' ? getAmount(req) : getAmount;
  const tope = parseFloat(req.user.topeAprobacion || 0);

  if (amount > tope) {
    return forbidden(
      res,
      `El monto $${amount.toLocaleString('es-CO')} supera tu tope de aprobación ($${tope.toLocaleString('es-CO')})`
    );
  }
  next();
};

// Verifica el permiso configurable (matriz por empresa) para un módulo + acción.
// El director siempre pasa. La comprobación se hace contra la matriz cacheada.
const requirePermission = (modulo, accion = 'ver') => async (req, res, next) => {
  try {
    // Carga diferida para evitar dependencia circular con el servicio
    const { can } = require('../../modules/permissions/permissions.service');
    const allowed = await can(req.user.companyId, req.user.rol, modulo, accion);
    if (!allowed) {
      return forbidden(res, `No tienes permiso para ${accion} en ${modulo}`);
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Solo superadmin de plataforma (acceso cruzado a todas las empresas)
const requireSuperadmin = (req, res, next) => {
  if (!req.user?.esSuperadmin) {
    return forbidden(res, 'Acceso restringido al superadmin de la plataforma');
  }
  next();
};

module.exports = { requireRole, requireTope, requirePermission, requireSuperadmin };
