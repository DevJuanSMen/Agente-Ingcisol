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
const assistantRouter = require('./modules/assistant/assistant.router');
const masterImportRouter = require('./modules/masterimport/masterimport.router');
const permissionsRouter = require('./modules/permissions/permissions.router');
const adminRouter = require('./modules/admin/admin.router');
const { ensureSuperadmin } = require('./shared/ensureSuperadmin');
const { verifyToken } = require('./shared/middleware/auth');
const { requireSetupComplete } = require('./shared/middleware/onboarding');

const app = express();

// Detrás del proxy de Railway/nginx: confiar en el primer X-Forwarded-For para
// que el rate limiting del login vea la IP real del cliente (no la del proxy).
app.set('trust proxy', 1);

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

// Routers libres durante el onboarding (el wizard los necesita para configurar
// la empresa: perfil, usuarios, proyectos, presupuesto, proveedores).
app.use('/api/auth', authRouter);
app.use('/api/company', companyRouter);
app.use('/api/users', usersRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/budget', budgetRouter);
app.use('/api/master-import', masterImportRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/admin', adminRouter);

// Módulos operativos: bloqueados hasta completar la configuración inicial
// (403 SETUP_INCOMPLETE). verifyToken corre aquí para que el middleware conozca
// la empresa (los routers lo repiten internamente sin costo).
app.use('/api/apu', verifyToken, requireSetupComplete, apuRouter);
app.use('/api/requisitions', verifyToken, requireSetupComplete, requisitionsRouter);
app.use('/api/quotations', verifyToken, requireSetupComplete, quotationsRouter);
app.use('/api/orders', verifyToken, requireSetupComplete, ordersRouter);
app.use('/api/tracking', verifyToken, requireSetupComplete, trackingRouter);
app.use('/api/delegations', verifyToken, requireSetupComplete, delegationsRouter);
app.use('/api/basic-prices', verifyToken, requireSetupComplete, basicPricesRouter);
app.use('/api/assistant', verifyToken, requireSetupComplete, assistantRouter);

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
  // Asegura el superadmin de plataforma (si hay credenciales en el entorno)
  ensureSuperadmin();
  // Si el superadmin guardó una API key de Groq desde el panel, tiene prioridad
  // sobre la del entorno (rotación sin acceso a Railway).
  const redis = require('./shared/redis');
  const { initGroqKeyFromRedis } = require('./shared/utils/groq');
  initGroqKeyFromRedis(redis)
    .then((loaded) => loaded && logger.info('API key de Groq cargada desde Redis (panel)'))
    .catch((err) => logger.warn(`No se pudo leer la key de Groq en Redis: ${err.message}`));
  const { initSmtpFromRedis } = require('./shared/mailer');
  initSmtpFromRedis(redis)
    .then((loaded) => loaded && logger.info('Configuración SMTP cargada desde Redis (panel)'))
    .catch((err) => logger.warn(`No se pudo leer la config SMTP en Redis: ${err.message}`));
});

module.exports = app;
