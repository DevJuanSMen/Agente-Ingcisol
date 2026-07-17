const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { created } = require('../../shared/utils/response');
const demoRequestsService = require('./demoRequests.service');

// Endpoint público (sin auth): la página /demo lo llama para dejar el lead.
// Protección contra spam: rate limit por IP + honeypot (campo oculto que un
// usuario real nunca llena; si viene con contenido, se responde 201 falso
// sin tocar la base de datos).
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: true, message: 'Demasiadas solicitudes. Espera unos minutos e inténtalo de nuevo.' },
});

router.post('/', submitLimiter, async (req, res, next) => {
  try {
    if (String(req.body.website || '').trim()) {
      return created(res, { received: true });
    }
    const { nombre, email, telefono } = req.body;
    const demoRequest = await demoRequestsService.create({ nombre, email, telefono });
    created(res, demoRequest);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
