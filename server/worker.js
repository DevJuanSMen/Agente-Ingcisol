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
const botManager = require('./modules/whatsapp/bot.manager');
const { subscribeToCommands } = require('./modules/whatsapp/bot.ipc');

logger.info('Worker PROCURA AI iniciado');

// ── IPC: comandos desde el API ─────────────────────────────────────────────
subscribeToCommands(async (cmd) => {
  logger.info('[worker] Comando recibido:', cmd);
  try {
    if (cmd.action === 'init') {
      await botManager.initCompany(cmd.companyId);
    } else if (cmd.action === 'destroy') {
      await botManager.destroyCompany(cmd.companyId);
    } else if (cmd.action === 'send_quote_requests') {
      await sendQuoteRequests(cmd.companyId, cmd.quotationId);
    } else if (cmd.action === 'send_po_notification') {
      await sendPoNotification(cmd.companyId, cmd.orderId);
    }
  } catch (err) {
    logger.error('[worker] Error procesando comando:', err.message);
  }
});

// Restaura sesiones activas al arrancar
botManager.restoreActiveSessions().catch((err) =>
  logger.error('[worker] Error restaurando sesiones:', err.message)
);

// ── Envío de solicitudes de cotización a proveedores ────────────────────────
async function sendQuoteRequests(companyId, quotationId) {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: {
      requisition: {
        include: {
          project: { select: { nombre: true } },
          items: { include: { itemAPU: true } },
        },
      },
      invites: true,
    },
  });
  if (!quotation) { logger.warn(`[worker] Cotización ${quotationId} no encontrada`); return; }

  const req = quotation.requisition;
  const items = req.items;

  // Construir texto de la solicitud
  const itemLines = items.map((it, i) =>
    `${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidad}`
  ).join('\n');

  // Encontrar proveedores con WhatsApp registrado de esta empresa
  const suppliers = await prisma.supplier.findMany({
    where: { companyId, whatsapp: { not: null } },
    select: { id: true, nombre: true, whatsapp: true },
  });

  if (suppliers.length === 0) {
    logger.info(`[worker] Sin proveedores con WhatsApp para empresa ${companyId}`);
    return;
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { razonSocial: true },
  });

  const fechaLimite = req.fechaLimite
    ? new Date(req.fechaLimite).toLocaleDateString('es-CO')
    : 'Sin fecha límite';

  for (const supplier of suppliers) {
    try {
      const msg =
        `🏗️ *PROCURA AI — Solicitud de Cotización*\n\n` +
        `Estimado(a) *${supplier.nombre}*,\n\n` +
        `La empresa *${company?.razonSocial || 'PROCURA AI'}* solicita su mejor precio para:\n\n` +
        `${itemLines}\n\n` +
        `📋 Requisición: *${req.consecutivo}*\n` +
        `🏗️ Proyecto: *${req.project.nombre}*\n` +
        `📅 Fecha límite: *${fechaLimite}*\n\n` +
        `Por favor responda con el precio unitario de cada ítem que pueda suministrar y el tiempo de entrega.\n` +
        `_Ej: "Cemento 28000, Arena 45000, Entrega 3 días"_`;

      await botManager.sendMessage(companyId, supplier.whatsapp, msg);

      // Registrar o actualizar el invite
      await prisma.quotationInvite.upsert({
        where: { quotationId_supplierId: { quotationId, supplierId: supplier.id } },
        update: { enviado: true, sentAt: new Date() },
        create: { quotationId, supplierId: supplier.id, enviado: true, sentAt: new Date() },
      });

      logger.info(`[worker] Solicitud enviada a ${supplier.nombre} (${supplier.whatsapp})`);
    } catch (err) {
      logger.error(`[worker] Error enviando a ${supplier.nombre}: ${err.message}`);
    }
  }

  // Actualizar cotización a PENDIENTE_APROBACION si ya hay invites enviados
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { estado: 'PENDIENTE_APROBACION' },
  });
  logger.info(`[worker] Cotización ${quotationId}: solicitudes enviadas a ${suppliers.length} proveedores`);
}

// ── Notificación de OC al proveedor ganador ─────────────────────────────────
async function sendPoNotification(companyId, orderId) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      proveedor: true,
      quotation: {
        include: {
          requisition: {
            include: {
              project: { select: { nombre: true } },
              items: true,
            },
          },
          items: {
            where: { supplierId: undefined }, // se sobreescribe abajo
            include: { itemAPU: true },
          },
        },
      },
    },
  });
  if (!order) return;

  const supplier = order.proveedor;
  if (!supplier.whatsapp) {
    logger.info(`[worker] Proveedor ${supplier.nombre} sin WhatsApp — no se notifica OC`);
    return;
  }

  const fmtCOP = (v) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v);

  const fechaEntrega = order.fechaEntregaPactada
    ? new Date(order.fechaEntregaPactada).toLocaleDateString('es-CO')
    : 'Por coordinar';

  const msg =
    `📦 *PROCURA AI — Orden de Compra Emitida*\n\n` +
    `Estimado(a) *${supplier.nombre}*,\n\n` +
    `Se ha emitido la siguiente Orden de Compra:\n\n` +
    `📋 OC: *${order.consecutivo}*\n` +
    `💰 Monto total: *${fmtCOP(order.montoTotal)}*\n` +
    `📅 Fecha de entrega pactada: *${fechaEntrega}*\n\n` +
    `Por favor confirme recibo de esta orden.\n` +
    `_PROCURA AI — Sistema de Gestión de Procura_`;

  try {
    await botManager.sendMessage(companyId, supplier.whatsapp, msg);
    logger.info(`[worker] OC ${order.consecutivo} notificada a ${supplier.nombre}`);
  } catch (err) {
    logger.error(`[worker] Error notificando OC: ${err.message}`);
  }
}

// ── Cron: alertas 48h antes de entrega ─────────────────────────────────────
cron.schedule('0 * * * *', async () => {
  logger.info('[worker] Revisando alertas de 48h...');
  try {
    const ahora = new Date();
    const en48h = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);

    const ordenes = await prisma.purchaseOrder.findMany({
      where: {
        estado: { in: ['EMITIDA', 'ENVIADA'] },
        alertaEnviada: false,
        fechaEntregaPactada: { gte: ahora, lte: en48h },
      },
      include: {
        proveedor: true,
        quotation: {
          include: {
            requisition: {
              include: {
                project: { include: { company: { select: { id: true } } } },
              },
            },
          },
        },
      },
    });

    for (const orden of ordenes) {
      const companyId = orden.quotation.requisition.project.company.id;
      if (orden.proveedor.whatsapp) {
        try {
          await botManager.sendMessage(
            companyId,
            orden.proveedor.whatsapp,
            `⚠️ *Recordatorio PROCURA AI*\n\nLa Orden de Compra *${orden.consecutivo}* vence en menos de 48 horas.\nFecha pactada: ${new Date(orden.fechaEntregaPactada).toLocaleDateString('es-CO')}`
          );
        } catch {}
      }

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

// ── Cron: escalada de OC vencidas ──────────────────────────────────────────
cron.schedule('30 * * * *', async () => {
  logger.info('[worker] Revisando OC vencidas...');
  try {
    const vencidas = await prisma.purchaseOrder.findMany({
      where: {
        estado: { in: ['EMITIDA', 'ENVIADA'] },
        fechaEntregaPactada: { lt: new Date() },
      },
      include: {
        proveedor: true,
        quotation: {
          include: {
            requisition: {
              include: { project: { include: { company: true } } },
            },
          },
        },
      },
    });

    for (const orden of vencidas) {
      logger.warn(`[worker] OC vencida: ${orden.consecutivo}`);
      const companyId = orden.quotation.requisition.project.company.id;
      const directors = await prisma.user.findMany({
        where: { companyId, rol: 'DIRECTOR', activo: true, whatsapp: { not: null } },
        select: { whatsapp: true, nombre: true },
      });
      for (const d of directors) {
        try {
          await botManager.sendMessage(
            companyId,
            d.whatsapp,
            `🔴 *Alerta PROCURA AI — OC Vencida*\n\nLa OC *${orden.consecutivo}* del proveedor *${orden.proveedor.nombre}* está vencida.\nFecha pactada: ${new Date(orden.fechaEntregaPactada).toLocaleDateString('es-CO')}\n\nRevisa el módulo de seguimiento.`
          );
        } catch {}
      }
    }

    logger.info(`[worker] OC vencidas detectadas: ${vencidas.length}`);
  } catch (err) {
    logger.error('[worker] Error en escalada:', err.message);
  }
});

// ── Cron: reporte semanal ───────────────────────────────────────────────────
cron.schedule('0 12 * * 1', async () => {
  logger.info('[worker] Generando reporte semanal...');
  try {
    const companies = await prisma.company.findMany({ select: { id: true, razonSocial: true } });
    for (const company of companies) {
      const enabled = await redis?.get(`whatsapp:${company.id}:enabled`);
      if (enabled !== '1') continue;

      const [activas, pendientes] = await Promise.all([
        prisma.purchaseOrder.count({
          where: { estado: { in: ['EMITIDA', 'ENVIADA'] }, quotation: { requisition: { project: { companyId: company.id } } } },
        }),
        prisma.requisition.count({
          where: { project: { companyId: company.id }, estado: { in: ['ENVIADA', 'PENDIENTE_JUST'] } },
        }),
      ]);

      const directors = await prisma.user.findMany({
        where: { companyId: company.id, rol: 'DIRECTOR', activo: true, whatsapp: { not: null } },
        select: { whatsapp: true },
      });
      for (const d of directors) {
        try {
          await botManager.sendMessage(
            company.id,
            d.whatsapp,
            `📊 *Reporte Semanal — PROCURA AI*\n\n` +
            `Empresa: *${company.razonSocial}*\n` +
            `📦 OC activas: ${activas}\n` +
            `📋 Req. pendientes de aprobación: ${pendientes}\n\n` +
            `_Lunes — resumen semanal_`
          );
        } catch {}
      }
    }
  } catch (err) {
    logger.error('[worker] Error en reporte semanal:', err.message);
  }
});

// Importar redis para el reporte semanal
const redis = require('./shared/redis');
