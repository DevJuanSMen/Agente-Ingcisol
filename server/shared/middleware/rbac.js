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

module.exports = { requireRole, requireTope };
