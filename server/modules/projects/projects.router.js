const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { requireRole } = require('../../shared/middleware/rbac');
const { ok, created } = require('../../shared/utils/response');
const projectsService = require('./projects.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const projects = await projectsService.listProjects(req.user.companyId);
    ok(res, projects);
  } catch (err) {
    next(err);
  }
});

router.get('/active', async (req, res, next) => {
  try {
    const project = await projectsService.getActiveProject(req.user.companyId);
    ok(res, project);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await projectsService.getProject(req.user.companyId, req.params.id);
    ok(res, project);
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const project = await projectsService.createProject(req.user.companyId, req.body);
    created(res, project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    const project = await projectsService.updateProject(req.user.companyId, req.params.id, req.body);
    ok(res, project);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/activate', requireRole('DIRECTOR', 'APOYO_DIRECTOR'), async (req, res, next) => {
  try {
    await projectsService.activateProject(req.user.companyId, req.params.id);
    ok(res, { message: 'Proyecto activado' });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/dashboard', async (req, res, next) => {
  try {
    const data = await projectsService.getProjectDashboard(req.user.companyId, req.params.id);
    ok(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
