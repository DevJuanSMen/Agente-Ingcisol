const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok, created } = require('../../shared/utils/response');
const delegationsService = require('./delegations.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const { projectId, estado, delegadoId } = req.query;
    const list = await delegationsService.list(req.user.companyId, { projectId, estado, delegadoId });
    ok(res, list);
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const stats = await delegationsService.getStats(req.user.companyId, req.query.projectId);
    ok(res, stats);
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const d = await delegationsService.get(req.user.companyId, req.params.id);
    ok(res, d);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const d = await delegationsService.create(req.user.companyId, req.body, req.user.id);
    created(res, d);
  } catch (err) { next(err); }
});

router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado, notas } = req.body;
    if (!['COMPLETADA', 'REVOCADA', 'ACTIVA'].includes(estado)) {
      return res.status(400).json({ error: true, message: 'Estado inválido' });
    }
    const d = await delegationsService.updateEstado(req.user.companyId, req.params.id, estado, notas, req.user.id);
    ok(res, d);
  } catch (err) { next(err); }
});

module.exports = router;
