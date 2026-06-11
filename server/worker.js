process.on('uncaughtException', (err) => {
  console.error('[worker] uncaughtException:', err.message, err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[worker] unhandledRejection:', reason);
});

const cron = require('node-cron');
const { logger } = require('./shared/utils/logger');
const prisma = require('./shared/db');
const { initBot } = require('./modules/whatsapp/bot');

// Iniciar bot de WhatsApp
initBot();

logger.info('Worker PROCURA AI iniciado');

// Revisa OC con entrega en las próximas 48h — cada hora
cron.schedule('0 * * * *', async () => {
  logger.info('[worker] Revisando alertas de 48h...');
  try {
    const ahora = new Date();
    const en48h = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    const ordenes = await prisma.purchaseOrder.findMany({
      where: {
        estado: { in: ['EMITIDA', 'ENVIADA'] },
        alertaEnviada: false,
        fechaEntregaPactada: {
          gte: ahora,
          lte: en48h,
        },
      },
      include: {
        proveedor: true,
        quotation: {
          include: {
            requisition: {
              include: { project: true },
            },
          },
        },
      },
    });

    for (const orden of ordenes) {
      logger.info(`[worker] Alerta 48h → OC ${orden.consecutivo}`);
      // TODO: integrar SendGrid / Twilio para enviar alerta real
      console.log('[worker] Enviaría alerta para OC:', {
        consecutivo: orden.consecutivo,
        proveedor: orden.proveedor.nombre,
        fechaEntrega: orden.fechaEntregaPactada,
      });

      await prisma.purchaseOrder.update({
        where: { id: orden.id },
        data: { alertaEnviada: true },
      });
    }

    logger.info(`[worker] Alertas 48h procesadas: ${ordenes.length}`);
  } catch (err) {
    logger.error('[worker] Error en alertas 48h:', err.message);
  }
});

// Escalada de OC vencidas — cada hora
cron.schedule('30 * * * *', async () => {
  logger.info('[worker] Revisando OC vencidas...');
  try {
    const ahora = new Date();

    const vencidas = await prisma.purchaseOrder.findMany({
      where: {
        estado: { in: ['EMITIDA', 'ENVIADA'] },
        fechaEntregaPactada: { lt: ahora },
      },
      include: {
        proveedor: true,
        quotation: {
          include: {
            requisition: {
              include: {
                project: { include: { company: true } },
              },
            },
          },
        },
      },
    });

    for (const orden of vencidas) {
      logger.warn(`[worker] OC vencida: ${orden.consecutivo}`);
      // TODO: integrar notificación al Director
      console.log('[worker] Escalaría OC vencida:', {
        consecutivo: orden.consecutivo,
        proveedor: orden.proveedor.nombre,
        vencida: orden.fechaEntregaPactada,
      });
    }

    logger.info(`[worker] OC vencidas detectadas: ${vencidas.length}`);
  } catch (err) {
    logger.error('[worker] Error en escalada:', err.message);
  }
});

// Reporte semanal — lunes 7:00 AM Colombia (UTC-5 = 12:00 UTC)
cron.schedule('0 12 * * 1', async () => {
  logger.info('[worker] Generando reporte semanal...');
  try {
    const activas = await prisma.purchaseOrder.count({
      where: { estado: { in: ['EMITIDA', 'ENVIADA'] } },
    });
    const entregadas = await prisma.purchaseOrder.count({
      where: { estado: 'ENTREGADA' },
    });
    const pendientesAprobacion = await prisma.requisition.count({
      where: { estado: 'ENVIADA' },
    });

    // TODO: integrar envío de reporte por email al Director
    logger.info('[worker] Reporte semanal:', { activas, entregadas, pendientesAprobacion });
  } catch (err) {
    logger.error('[worker] Error en reporte semanal:', err.message);
  }
});
