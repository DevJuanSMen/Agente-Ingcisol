const jwt = require('jsonwebtoken');
const { unauthorized } = require('../utils/response');

const verifyToken = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return unauthorized(res);
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = {
      id: payload.sub,
      email: payload.email,
      rol: payload.rol,
      companyId: payload.companyId,
      topeAprobacion: payload.topeAprobacion,
    };
    next();
  } catch (err) {
    return unauthorized(res);
  }
};

module.exports = { verifyToken };
