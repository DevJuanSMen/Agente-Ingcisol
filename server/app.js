const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { logger } = require('./shared/utils/logger');

const authRouter = require('./modules/auth/auth.router');
const companyRouter = require('./modules/company/company.router');
const usersRouter = require('./modules/users/users.router');
const projectsRouter = require('./modules/projects/projects.router');
const apuRouter = require('./modules/apu/apu.router');
const suppliersRouter = require('./modules/suppliers/suppliers.router');
const requisitionsRouter = require('./modules/requisitions/requisitions.router');
const quotationsRouter = require('./modules/quotations/quotations.router');
const ordersRouter = require('./modules/orders/orders.router');
const trackingRouter = require('./modules/tracking/tracking.router');
const notificationsRouter = require('./modules/notifications/notifications.router');
const budgetRouter = require('./modules/budget/budget.router');
const delegationsRouter = require('./modules/delegations/delegations.router');
const basicPricesRouter = require('./modules/basicprices/basicprices.router');
const whatsappRouter = require('./modules/whatsapp/whatsapp.router');
const assistantRouter = require('./modules/assistant/assistant.router');
const masterImportRouter = require('./modules/masterimport/masterimport.router');
const permissionsRouter = require('./modules/permissions/permissions.router');

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

app.use('/api/auth', authRouter);
app.use('/api/company', companyRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/apu', apuRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/requisitions', requisitionsRouter);
app.use('/api/quotations', quotationsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/delegations', delegationsRouter);
app.use('/api/basic-prices', basicPricesRouter);
app.use('/api/whatsapp', whatsappRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/master-import', masterImportRouter);
app.use('/api/permissions', permissionsRouter);

// Handler de errores global
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Error interno del servidor';

  logger.error(`${statusCode} — ${message}`, {
    url: req.originalUrl,
    method: req.method,
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: true,
    message,
    statusCode,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  logger.info(`API PROCURA AI corriendo en puerto ${PORT}`);
});

module.exports = app;
