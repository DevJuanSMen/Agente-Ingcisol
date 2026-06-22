const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');
const requisitionsService = require('../requisitions/requisitions.service');
const quotationsService = require('../quotations/quotations.service');

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );

const PENDING_TTL = 60 * 60 * 24; // 24 h
// Se llavea por userId (estable) y no por teléfono, porque el formato del número
// entrante puede no coincidir con el guardado en el perfil del usuario.
const pendingKey = (companyId, userId) => `whatsapp:${companyId}:pending:${userId}`;

// ── Estado conversacional del director (Redis) ───────────────────────────────

const setPending = async (companyId, userId, state) => {
  await redis.set(pendingKey(companyId, userId), JSON.stringify(state), 'EX', PENDING_TTL);
};

const getPending = async (companyId, userId) => {
  const raw = await redis.get(pendingKey(companyId, userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const clearPending = async (companyId, userId) => {
  await redis.del(pendingKey(companyId, userId));
};

// ── Constructores de mensaje ─────────────────────────────────────────────────

// Resumen de una requisición para que el director apruebe desde WhatsApp.
// `analysis` proviene de requisitionsService.analyzeRequisitionBudget.
const buildRequisitionApprovalMsg = (req, analysis) => {
  const itemLines = (analysis?.items || []).map((it) => {
    const icono =
      it.veredicto === 'FUERA_APU' ? '⚠️' : it.veredicto === 'EXCEDE_SALDO' ? '🟠' : '✅';
    const precio = it.precioUnitario ? ` @ ${fmt(it.precioUnitario)}` : '';
    return `${icono} ${Number(it.cantidad)} ${it.unidad} *${it.descripcion}*${precio}`;
  });

  return (
    `📋 *Nueva requisición para aprobar*\n\n` +
    `*${req.consecutivo}*\n` +
    `🏗️ Proyecto: ${req.project?.nombre || '—'}\n` +
    `👤 Solicitante: ${req.solicitante?.nombre || '—'}\n` +
    `🔺 Prioridad: ${req.prioridad}\n\n` +
    `${itemLines.join('\n')}\n\n` +
    `📊 ${analysis?.resumen || ''}\n\n` +
    `Responde *aprobar* para iniciar la cotización con proveedores, ` +
    `o *rechazar <motivo>* para descartarla.`
  );
};

// Cuadro comparativo de cotizaciones para que el director adjudique.
const buildWinnerSelectionMsg = (consecutivoReq, comparison, options) => {
  const rows = (comparison?.rows || []).map((r) => {
    const best = r.quotes && r.quotes.length ? r.quotes.reduce((m, q) => (!m || q.precioUnitario < m.precioUnitario ? q : m), null) : null;
    const detalle = best
      ? `${best.nombre} → ${fmt(best.precioUnitario)}`
      : 'sin cotizaciones';
    return `• *${r.descripcion}* (${Number(r.cantidad)} ${r.unidad}): ${detalle}`;
  });

  const optLines = options.map((o, i) => `${i + 1}. ${o.nombre} — total ${fmt(o.total)} (${o.count} ítem(s))`);

  return (
    `💬 *Cotizaciones recibidas — ${consecutivoReq}*\n\n` +
    `Mejor precio por ítem:\n${rows.join('\n')}\n\n` +
    `Proveedores que cotizaron:\n${optLines.join('\n')}\n\n` +
    `Responde:\n` +
    `• *adjudicar* → reparte cada ítem al de menor precio (recomendado)\n` +
    `• *adjudicar <número>* → asigna TODA la compra a ese proveedor\n` +
    `_Ej: "adjudicar 1"_`
  );
};

// ── Manejo de respuestas del director ────────────────────────────────────────

const yes = /^(aprob|aprueb|si\b|s[ií]\b|ok|dale|confirm|1\b)/i;
const no = /^(rechaz|no\b|2\b)/i;

const handlePendingReply = async (text, companyId, user, pending) => {
  const t = text.trim();

  // ── Aprobar / rechazar requisición ──
  if (pending.type === 'APPROVE_REQ') {
    if (yes.test(t)) {
      try {
        await requisitionsService.approveRequisition(companyId, pending.requisitionId, user.id);
        await clearPending(companyId, user.id);
        return (
          `✅ Requisición *${pending.consecutivo}* aprobada.\n\n` +
          `Se inició la búsqueda de proveedores. Te avisaré cuando lleguen cotizaciones para adjudicar.`
        );
      } catch (err) {
        return `No pude aprobar la requisición: ${err.message}`;
      }
    }
    if (no.test(t)) {
      const motivo = t.replace(/^(rechaz\w*|no)\s*/i, '').trim() || 'Rechazada por el director vía WhatsApp';
      try {
        await requisitionsService.rejectRequisition(companyId, pending.requisitionId, user.id, motivo);
        await clearPending(companyId, user.id);
        return `❌ Requisición *${pending.consecutivo}* rechazada.\nMotivo: ${motivo}`;
      } catch (err) {
        return `No pude rechazar la requisición: ${err.message}`;
      }
    }
    return `Para la requisición *${pending.consecutivo}*, responde *aprobar* o *rechazar <motivo>*.`;
  }

  // ── Adjudicar ganador(es) ──
  if (pending.type === 'SELECT_WINNER') {
    const m = t.match(/adjudicar\s*(.*)$/i);
    const isAdjudicar = /^adjudicar/i.test(t) || /^\d+$/.test(t);
    if (!isAdjudicar) {
      return (
        `Para *${pending.consecutivo}*, responde *adjudicar* (reparte por mejor precio) ` +
        `o *adjudicar <número>* (todo a un proveedor).`
      );
    }

    const arg = (m && m[1] ? m[1] : /^\d+$/.test(t) ? t : '').trim();

    try {
      const quotation = await quotationsService.getQuotation(companyId, pending.quotationId);
      let awards;

      if (!arg) {
        // reparto recomendado (mejor precio por ítem)
        awards = quotationsService.buildRecommendedAwards(quotation);
      } else {
        // todo a un proveedor: por número de la lista o por nombre
        let supplierId = null;
        if (/^\d+$/.test(arg)) {
          supplierId = pending.options?.[Number(arg) - 1]?.id || null;
        } else {
          const opt = (pending.options || []).find((o) =>
            o.nombre.toLowerCase().includes(arg.toLowerCase())
          );
          supplierId = opt?.id || null;
        }
        if (!supplierId) return `No identifiqué el proveedor "${arg}". Revisa el número de la lista.`;
        awards = [{ supplierId }];
      }

      if (!awards.length) return 'No hay ítems cotizados para adjudicar.';

      const { orders } = await quotationsService.selectWinners(
        companyId,
        pending.quotationId,
        awards,
        user.id
      );
      await clearPending(companyId, user.id);

      const detalle = orders.map((o) => `• ${o.consecutivo}: ${fmt(o.montoTotal)}`).join('\n');
      return (
        `✅ *Adjudicación realizada* (${pending.consecutivo})\n\n` +
        `${orders.length > 1 ? `Se emitieron ${orders.length} órdenes de compra:` : 'Orden de compra emitida:'}\n` +
        `${detalle}\n\n` +
        `📄 Estoy generando los PDF y enviándolos al proveedor, a ti y a contabilidad.`
      );
    } catch (err) {
      logger.error('[bot.flows] Error adjudicando:', err.message);
      return `No pude completar la adjudicación: ${err.message}`;
    }
  }

  return null;
};

module.exports = {
  setPending,
  getPending,
  clearPending,
  buildRequisitionApprovalMsg,
  buildWinnerSelectionMsg,
  handlePendingReply,
};
