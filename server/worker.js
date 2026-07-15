// Silencia el volcado ruidoso de libsignal ("Closing session: SessionEntry {…}")
// que Baileys imprime por console.log en cada rotación de sesión de cifrado. No
// aporta y satura los logs. Los logs de la app usan winston, no console.log, así
// que no se ven afectados.
const _origConsoleLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Closing session')) return;
  _origConsoleLog(...args);
};

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
const { sendMail } = require('./shared/mailer');

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
      // Sesión única global: init/destroy ya no llevan companyId.
      await botManager.init();
    } else if (cmd.action === 'destroy') {
      await botManager.destroy();
    } else if (cmd.action === 'send_quote_requests') {
      await sendQuoteRequests(cmd.companyId, cmd.quotationId);
    } else if (cmd.action === 'notify_req_for_approval') {
      await notifyReqForApproval(cmd.companyId, cmd.requisitionId, cmd.excludeUserId);
    } else if (cmd.action === 'notify_winner_selection') {
      await notifyWinnerSelection(cmd.companyId, cmd.quotationId);
    } else if (cmd.action === 'send_po_documents') {
      await sendPoDocuments(cmd.companyId, cmd.orderIds);
    } else if (cmd.action === 'reload_groq_key') {
      // El panel guardó una key nueva en Redis: recargarla en este proceso.
      const { initGroqKeyFromRedis } = require('./shared/utils/groq');
      const loaded = await initGroqKeyFromRedis(redis);
      logger.info(`[worker] API key de Groq recargada desde Redis: ${loaded ? 'sí' : 'no había'}`);
    } else if (cmd.action === 'reload_smtp') {
      const { initSmtpFromRedis } = require('./shared/mailer');
      const loaded = await initSmtpFromRedis(redis);
      logger.info(`[worker] Config SMTP recargada desde Redis: ${loaded ? 'sí' : 'no había'}`);
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

// Si el superadmin guardó una API key de Groq desde el panel, cargarla antes de
// atender mensajes (tiene prioridad sobre la del entorno).
const { initGroqKeyFromRedis } = require('./shared/utils/groq');
initGroqKeyFromRedis(redis)
  .then((loaded) => loaded && logger.info('[worker] API key de Groq cargada desde Redis (panel)'))
  .catch((err) => logger.warn(`[worker] No se pudo leer la key de Groq en Redis: ${err.message}`));
const { initSmtpFromRedis } = require('./shared/mailer');
initSmtpFromRedis(redis)
  .then((loaded) => loaded && logger.info('[worker] Config SMTP cargada desde Redis (panel)'))
  .catch((err) => logger.warn(`[worker] No se pudo leer la config SMTP en Redis: ${err.message}`));

// Restaura la sesión global al arrancar (si ya fue vinculada por QR)
botManager.restoreSession().catch((err) =>
  logger.error('[worker] Error restaurando sesión:', err.message)
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
    },
    select: { id: true, whatsapp: true, email: true, nombre: true },
  });

  const itemLines = (analysis?.items || [])
    .map((it) => `<li>${Number(it.cantidad)} ${it.unidad} — ${it.descripcion}${it.precioUnitario ? ` (${fmtCOP(it.precioUnitario)} c/u)` : ''}</li>`)
    .join('');

  for (const d of directors) {
    if (d.id === excludeUserId) continue;
    if (d.whatsapp) {
      await botFlows.setPending(companyId, d.id, {
        type: 'APPROVE_REQ',
        requisitionId,
        consecutivo: req.consecutivo,
      });
      enqueueText(companyId, d.whatsapp, msg);
    }
    // Copia por correo (informativa; la aprobación se hace por WhatsApp o el panel)
    if (d.email) {
      sendMail({
        to: d.email,
        subject: `Requisición ${req.consecutivo} pendiente de aprobación`,
        titulo: req.project?.nombre || 'Nueva requisición',
        html: `
          <p>Hola <strong>${d.nombre}</strong>,</p>
          <p>Hay una nueva requisición pendiente de tu aprobación:</p>
          <p><strong>${req.consecutivo}</strong> · Proyecto ${req.project?.nombre || '—'} · Solicita ${req.solicitante?.nombre || '—'} · Prioridad ${req.prioridad}</p>
          <ul>${itemLines}</ul>
          <p>${analysis?.resumen || ''}</p>
          <p style="color:#64748b;font-size:12px">Puedes aprobarla respondiendo el mensaje de WhatsApp o desde el panel (Requisiciones).</p>
        `,
      }).catch(() => {});
    }
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
    },
    select: { id: true, whatsapp: true, email: true, nombre: true },
  });

  const optRows = options
    .map((o, i) => `<li>${i + 1}. ${o.nombre} — total ${fmtCOP(o.total)} (${o.count} ítem(s))</li>`)
    .join('');

  for (const d of directors) {
    if (d.whatsapp) {
      await botFlows.setPending(companyId, d.id, {
        type: 'SELECT_WINNER',
        quotationId,
        consecutivo,
        options,
      });
      enqueueText(companyId, d.whatsapp, msg);
    }
    if (d.email) {
      sendMail({
        to: d.email,
        subject: `Cotizaciones listas para adjudicar — ${consecutivo}`,
        titulo: 'Cotizaciones recibidas',
        html: `
          <p>Hola <strong>${d.nombre}</strong>,</p>
          <p>Todos los proveedores invitados respondieron la cotización de <strong>${consecutivo}</strong>. Ya puedes adjudicar:</p>
          <ul>${optRows}</ul>
          <p style="color:#64748b;font-size:12px">Adjudica respondiendo el mensaje de WhatsApp o desde el panel (Cotizaciones).</p>
        `,
      }).catch(() => {});
    }
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
        logger.info(`[worker] Proveedor ${order.proveedor.nombre} sin WhatsApp — no se envía OC por WhatsApp`);
      }
      // Copia por correo con el PDF adjunto
      if (order.proveedor.email) {
        sendMail({
          to: order.proveedor.email,
          subject: `Orden de compra ${order.consecutivo} — ${company?.razonSocial || 'PROCURA AI'}`,
          titulo: 'Orden de compra adjudicada',
          html: `
            <p>Estimado(a) <strong>${order.proveedor.nombre}</strong>,</p>
            <p>Fue seleccionado como proveedor. Adjuntamos la orden de compra
            <strong>${order.consecutivo}</strong> por <strong>${fmtCOP(order.montoTotal)}</strong>
            (proyecto ${project?.nombre || '—'}).</p>
            <p>Por favor confirme recibo y fecha de entrega.</p>
          `,
          attachments: [{ filename: `${order.consecutivo}.pdf`, content: pdf, contentType: 'application/pdf' }],
        }).catch(() => {});
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
      },
      select: { whatsapp: true, email: true, nombre: true },
    });

    const caption =
      `📄 *Orden de compra — ${requisition.consecutivo}*\n` +
      `${orders.length} OC · ${groups.length} proveedor(es) · Total ${fmtCOP(totalGlobal)}\n` +
      `Documento para el área financiera.`;

    for (const r of recipients) {
      if (r.whatsapp) enqueueDocument(companyId, r.whatsapp, b64, `OC-${requisition.consecutivo}.pdf`, caption);
      if (r.email) {
        sendMail({
          to: r.email,
          subject: `OC emitida — ${requisition.consecutivo} (${fmtCOP(totalGlobal)})`,
          titulo: 'Orden de compra emitida',
          html: `
            <p>Hola <strong>${r.nombre}</strong>,</p>
            <p>Se adjudicó la requisición <strong>${requisition.consecutivo}</strong>:
            ${orders.length} OC a ${groups.length} proveedor(es) por un total de
            <strong>${fmtCOP(totalGlobal)}</strong>.</p>
            <p>Adjuntamos el consolidado para el área financiera.</p>
          `,
          attachments: [{ filename: `OC-${requisition.consecutivo}.pdf`, content: consolidated, contentType: 'application/pdf' }],
        }).catch(() => {});
      }
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

  // Proveedores con WhatsApp O correo (se cotiza por ambos canales disponibles)
  const suppliers = await prisma.supplier.findMany({
    where: {
      companyId,
      activo: true,
      OR: [{ whatsapp: { not: null } }, { email: { not: null } }],
    },
    select: { id: true, nombre: true, whatsapp: true, email: true },
  });

  if (suppliers.length === 0) {
    logger.info(`[worker] Sin proveedores con WhatsApp/correo para empresa ${companyId}`);
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
      `Respóndanos por aquí con el precio de cada material que pueda suministrar y cuándo lo entregaría. ` +
      `Puede escribir con sus palabras, nuestro asistente entiende.\n` +
      `_Ej: "el cemento se lo dejo a 28 mil el bulto y se lo entrego el viernes"_`;

    // Encolar envío (con delay anti-spam)
    if (supplier.whatsapp) enqueueText(companyId, supplier.whatsapp, msg);

    // Copia por correo, si el proveedor tiene email registrado
    if (supplier.email) {
      const itemRows = items
        .map((it, i) => `<li>${i + 1}. ${it.descripcion} — ${Number(it.cantidad)} ${it.unidad}</li>`)
        .join('');
      sendMail({
        to: supplier.email,
        subject: `Solicitud de cotización ${req.consecutivo} — ${company?.razonSocial || 'PROCURA AI'}`,
        titulo: 'Solicitud de cotización',
        html: `
          <p>Estimado(a) <strong>${supplier.nombre}</strong>,</p>
          <p>La empresa <strong>${company?.razonSocial || 'PROCURA AI'}</strong> solicita su mejor precio para:</p>
          <ul>${itemRows}</ul>
          <p>📋 Requisición: <strong>${req.consecutivo}</strong><br/>
             🏗️ Proyecto: <strong>${req.project.nombre}</strong><br/>
             📅 Fecha límite: <strong>${fechaLimite}</strong></p>
          <p>Por favor responda por WhatsApp con el precio unitario de cada ítem que pueda suministrar y el tiempo de entrega.<br/>
          <em>Ej: "Cemento 28000, Arena 45000, Entrega 3 días"</em></p>
        `,
      }).catch(() => {});
    }

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
      if (enabled === '0') continue; // sin flag = habilitada (exclusión explícita)

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
