const router = require('express').Router();
const { verifyToken } = require('../../shared/middleware/auth');
const { ok } = require('../../shared/utils/response');
const notificationsService = require('./notifications.service');

router.use(verifyToken);

router.get('/', async (req, res, next) => {
  try {
    const items = await notificationsService.listNotifications(req.user.id, req.query);
    ok(res, items);
  } catch (err) { next(err); }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    const count = await notificationsService.unreadCount(req.user.id);
    ok(res, { count });
  } catch (err) { next(err); }
});

router.put('/read-all', async (req, res, next) => {
  try {
    await notificationsService.markAllRead(req.user.id);
    ok(res, { message: 'Notificaciones marcadas como leídas' });
  } catch (err) { next(err); }
});

router.put('/:id/read', async (req, res, next) => {
  try {
    await notificationsService.markRead(req.user.id, req.params.id);
    ok(res, { message: 'Notificación leída' });
  } catch (err) { next(err); }
});

module.exports = router;
