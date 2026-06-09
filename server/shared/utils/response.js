const ok = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ ok: true, data });

const created = (res, data) => ok(res, data, 201);

const noContent = (res) => res.status(204).send();

const fail = (res, message, statusCode = 400) =>
  res.status(statusCode).json({ ok: false, error: message });

const notFound = (res, entity = 'Recurso') =>
  fail(res, `${entity} no encontrado`, 404);

const forbidden = (res, message = 'No tienes permiso para esta acción') =>
  fail(res, message, 403);

const unauthorized = (res) =>
  fail(res, 'No autenticado', 401);

module.exports = { ok, created, noContent, fail, notFound, forbidden, unauthorized };
