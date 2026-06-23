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
const redis = require('./shared/redis');
const botManager = require('./modules/whatsapp/bot.manager');
const botFlows = require('./modules/whatsapp/bot.flows');
const { enqueueText, enqueueDocument } = require('./modules/whatsapp/sendQueue');
const { subscribeToCommands } = require('./modules/whatsapp/bot.ipc');
const { generateOrderPdf, generateConsolidatedPdf, normalizeAwardedItems } = require('./shared/pdf/orderPdf');
const requisitionsService = require('./modules/requisitions/requisitions.service');
const quotationsService = require('./modules/quotations/quotations.service');

logger.info('Worker PROCURA AI iniciado');

const fmtCOP = (v) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    Number(v) || 0
  );

// ── IPC: comandos desde el API / bot ────────────────────────────────────────
subscribeToCommands(async (cmd) => {
  logger.info('[worker] Comando recibido:', cmd);
  try {
    if (cmd.action === 'init') {
      await botManager.initCompany(cmd.companyId);
    } else if (cmd.action === 'destroy') {
      await botManager.destroyCompany(cmd.companyId);
    } else if (cmd.action === 'send_quote_requests') {
      await sendQuoteRequests(cmd.companyId, cmd.quotationId);
    } else if (cmd.action === 'notify_req_for_approval') {
      await notifyReqForApproval(cmd.companyId, cmd.requisitionId, cmd.excludeUserId);
    } else if (cmd.action === 'notify_winner_selection') {
      await notifyWinnerSelection(cmd.companyId, cmd.quotationId);
    } else if (cmd.action === 'send_po_documents') {
      await sendPoDocuments(cmd.companyId, cmd.orderIds);
    } else if (cmd.action === 'send_password_reset_code') {
      const saludo = cmd.nombre ? `Hola ${cmd.nombre}, ` : '';
      const msg =
        `🔐 *Recuperación de contraseña — PROCURA AI*\n\n` +
        `${saludo}tu código para restablecer la contraseña es:\n\n` +
        `*${cmd.code}*\n\n` +
        `Vence en 10 minutos. Si no lo solicitaste, ignora este mensaje.`;
      enqueueText(cmd.companyId, cmd.phone, msg);
    }
  } catch (err) {
    logger.error('[worker] Error procesando comando:', err.message);
  }
});

// Restaura sesiones activas al arrancar
botManager.restoreActiveSessions().catch((err) =>
  logger.error('[worker] Error restaurando sesiones:', err.message)
);

// ── Notificar al director una requisición para aprobar ──────────────────────
async function notifyReqForApproval(companyId, requisitionId, excludeUserId) {
  const req = await requisitionsService.getRequisition(companyId, requisitionId);
  const analysis = await requisitionsService.analyzeRequisitionBudget(companyId, requisitionId).catch(() => null);
  const msg = botFlows.buildRequisitionApprovalMsg(req, analysis);

  const directors = await prisma.user.findMany({
    where: {
      companyId,
      rol: { in: ['DIRECTOR', 'APOYO_DIRECTOR'] },
      activo: true,
      whatsapp: { not: null },
    },
    select: { id: true, whatsapp: true },
  });

  for (const d of directors) {
    if (d.id === excludeUserId) continue;
    await botFlows.setPending(companyId, d.id, {
      type: 'APPROVE_REQ',
      requisitionId,
      consecutivo: req.consecutivo,
    });
    enqueueText(companyId, d.whatsapp, msg);
  }
  logger.info(`[worker] Requisición ${req.consecutivo} enviada a ${directors.length} director(es) para aprobar`);
}

// ── Notificar al director que ya puede adjudicar ────────────────────────────
async function notifyWinnerSelection(companyId, quotationId) {
  const quotation = await quotationsService.getQuotation(companyId, quotationId);
  if (quotation.estado === 'APROBADA') return; // ya adjudicada
  const comparison = quotation.comparison;
  const options = (comparison?.suppliers || []).map((s) => ({
    id: s.id,
    nombre: s.nombre,
    total: s.total,
    count: s.count,
  }));
  if (options.length === 0) {
    logger.info(`[worker] Cotización ${quotationId} sin proveedores que cotizaran — no se notifica`);
    return;
  }

  const consecutivo = quotation.requisition.consecutivo;
  const msg = botFlows.buildWinnerSelectionMsg(consecutivo, comparison, options);

  const directors = await prisma.user.findMany({
    where: {
      companyId,
      rol: { in: ['DIRECTOR', 'APOYO_DIRECTOR'] },
      activo: true,
      whatsapp: { not: null },
    },
    select: { id: true, whatsapp: true },
  });

  for (const d of directors) {
    await botFlows.setPending(companyId, d.id, {
      type: 'SELECT_WINNER',
      quotationId,
      consecutivo,
      options,
    });
    enqueueText(companyId, d.whatsapp, msg);
  }
  logger.info(`[worker] Adjudicación de ${consecutivo} ofrecida a ${directors.length} director(es)`);
}

// ── Generar y enviar PDFs de OC (proveedor + director + contabilidad) ────────
async function sendPoDocuments(companyId, orderIds) {
  if (!Array.isArray(orderIds) || !orderIds.length) return;

  const orders = await prisma.purchaseOrder.findMany({
    where: { id: { in: orderIds } },
    include: {
      proveedor: true,
      itemsAdjudicados: { include: { itemAPU: true } },
      quotation: {
        include: {
          requisition: {
            include: { project: true, items: { include: { itemAPU: true } } },
          },
        },
      },
    },
  });
  if (!orders.length) return;

  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const requisition = orders[0].quotation.requisition;
  const project = requisition.project;
  const reqItems = requisition.items;

  // 1) PDF individual por proveedor (solo sus ítems) → al proveedor
  const groups = [];
  for (const order of orders) {
    const items = normalizeAwardedItems(order.itemsAdjudicados, reqItems);
    groups.push({ supplier: order.proveedor, order, items });

    try {
      const pdf = await generateOrderPdf({
        company,
        order,
        supplier: order.proveedor,
        items,
        project,
        requisition,
      });
      if (order.proveedor.whatsapp) {
        enqueueDocument(
          companyId,
          order.proveedor.whatsapp,
          pdf.toString('base64'),
          `${order.consecutivo}.pdf`,
          `🎉 *${order.proveedor.nombre}*, fue seleccionado como proveedor.\n` +
            `Orden de compra *${order.consecutivo}* — ${fmtCOP(order.montoTotal)}.\n` +
            `Por favor confirme recibo y fecha de entrega.`
        );
      } else {
        logger.info(`[worker] Proveedor ${order.proveedor.nombre} sin WhatsApp — no se envía OC`);
      }
    } catch (err) {
      logger.error(`[worker] Error generando OC ${order.consecutivo}: ${err.message}`);
    }
  }

  // 2) PDF consolidado (todos los ítems con su proveedor) → director + contabilidad
  try {
    const consolidated = await generateConsolidatedPdf({ company, requisition, project, groups });
    const b64 = consolidated.toString('base64');
    const totalGlobal = orders.reduce((a, o) => a + Number(o.montoTotal), 0);

    const recipients = await prisma.user.findMany({
      where: {
        companyId,
        rol: { in: ['DIRECTOR', 'APOYO_DIRECTOR', 'CONTABILIDAD'] },
        activo: true,
        whatsapp: { not: null },
      },
      select: { whatsapp: true },
    });

    const caption =
      `📄 *Orden de compra — ${requisition.consecutivo}*\n` +
      `${orders.length} OC · ${groups.length} proveedor(es) · Total ${fmtCOP(totalGlobal)}\n` +
      `Documento para el área financiera.`;

    for (const r of recipients) {
      enqueueDocument(companyId, r.whatsapp, b64, `OC-${requisition.consecutivo}.pdf`, caption);
    }
    logger.info(`[worker] OC consolidada de ${requisition.consecutivo} encolada a ${recipients.length} destinatario(s)`);
  } catch (err) {
    logger.error(`[worker] Error generando OC consolidada: ${err.message}`);
  }
}

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
  if (!quotation) {
    logger.warn(`[worker] Cotización ${quotationId} no encontrada`);
    return;
  }

  const req = quotation.requisition;
  const items = req.items;

  const itemLines = items.map((it, i) => `${i + 1}. ${it.descripcion} — ${it.cantidad} ${it.unidad}`).join('\n');

  const suppliers = await prisma.supplier.findMany({
    where: { companyId, activo: true, whatsapp: { not: null } },
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

    // Encolar envío (con delay anti-spam)
    enqueueText(companyId, supplier.whatsapp, msg);

    // Registrar o actualizar el invite
    await prisma.quotationInvite
      .upsert({
        where: { quotationId_supplierId: { quotationId, supplierId: supplier.id } },
        update: { enviado: true, sentAt: new Date() },
        create: { quotationId, supplierId: supplier.id, enviado: true, sentAt: new Date() },
      })
      .catch((err) => logger.error(`[worker] Error registrando invite de ${supplier.nombre}: ${err.message}`));
  }

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { estado: 'PENDIENTE_APROBACION' },
  });
  logger.info(`[worker] Cotización ${quotationId}: solicitudes encoladas a ${suppliers.length} proveedores`);
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
            requisition: { include: { project: { include: { company: { select: { id: true } } } } } },
          },
        },
      },
    });

    for (const orden of ordenes) {
      const companyId = orden.quotation.requisition.project.company.id;
      if (orden.proveedor.whatsapp) {
        enqueueText(
          companyId,
          orden.proveedor.whatsapp,
          `⚠️ *Recordatorio PROCURA AI*\n\nLa Orden de Compra *${orden.consecutivo}* vence en menos de 48 horas.\nFecha pactada: ${new Date(orden.fechaEntregaPactada).toLocaleDateString('es-CO')}`
        );
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
          include: { requisition: { include: { project: { include: { company: true } } } } },
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
        enqueueText(
          companyId,
          d.whatsapp,
          `🔴 *Alerta PROCURA AI — OC Vencida*\n\nLa OC *${orden.consecutivo}* del proveedor *${orden.proveedor.nombre}* está vencida.\nFecha pactada: ${new Date(orden.fechaEntregaPactada).toLocaleDateString('es-CO')}\n\nRevisa el módulo de seguimiento.`
        );
      }
    }

    logger.info(`[worker] OC vencidas detectadas: ${vencidas.length}`);
  } catch (err) {
    logger.error('[worker] Error en escalada:', err.message);
  }
});

// ── Cron: expiración de requisiciones vencidas (diario 06:15) ───────────────
cron.schedule('15 6 * * *', async () => {
  logger.info('[worker] Revisando requisiciones vencidas...');
  try {
    const n = await requisitionsService.expireRequisitions();
    logger.info(`[worker] Requisiciones marcadas como EXPIRADA: ${n}`);
  } catch (err) {
    logger.error('[worker] Error expirando requisiciones:', err.message);
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
          where: {
            estado: { in: ['EMITIDA', 'ENVIADA'] },
            quotation: { requisition: { project: { companyId: company.id } } },
          },
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
        enqueueText(
          company.id,
          d.whatsapp,
          `📊 *Reporte Semanal — PROCURA AI*\n\n` +
            `Empresa: *${company.razonSocial}*\n` +
            `📦 OC activas: ${activas}\n` +
            `📋 Req. pendientes de aprobación: ${pendientes}\n\n` +
            `_Lunes — resumen semanal_`
        );
      }
    }
  } catch (err) {
    logger.error('[worker] Error en reporte semanal:', err.message);
  }
});
