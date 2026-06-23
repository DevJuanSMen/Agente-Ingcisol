const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');
const { publishCommand } = require('./bot.ipc');
const apuService = require('../apu/apu.service');
const requisitionsService = require('../requisitions/requisitions.service');

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// ── Comandos de usuario ─────────────────────────────────────────────────────

const handleCommand = async (t, companyId, rol) => {
  if (t === 'ayuda' || t === 'help' || t === '?') {
    return (
      '*PROCURA AI Bot* 🤖\n\n' +
      'Comandos disponibles:\n' +
      '• *proyectos* — Lista de proyectos\n' +
      '• *presupuesto* — Resumen del proyecto activo\n' +
      '• *apu <código>* — Detalle ítem APU\n' +
      '• *apus* — Primeros 10 ítems APU\n' +
      '• *básicos* — Precios básicos\n' +
      '• *proveedores* — Lista de proveedores\n' +
      '• *proveedor <nombre>* — Buscar proveedor\n' +
      '• *requisiciones* — Requisiciones pendientes\n' +
      '• *ordenes* — Órdenes de compra activas\n' +
      '• *cotizaciones* — Cotizaciones en curso\n' +
      '• *estado* — Resumen general\n' +
      '• *ayuda* — Este menú\n\n' +
      '_También puedes escribir en lenguaje natural._'
    );
  }

  // ── Proyectos ──────────────────────────────────────────────────────────
  if (t === 'proyectos' || t.includes('cuántos proyecto') || t.includes('cuantos proyecto')) {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { nombre: true, estado: true, activo: true, contratoNo: true, ciudad: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!projects.length) return 'No hay proyectos registrados.';
    const lines = projects.map(
      (p) => `${p.activo ? '🟢' : '⚪'} *${p.nombre}* (${p.contratoNo})${p.ciudad ? ` — ${p.ciudad}` : ''} — ${p.estado.replace(/_/g, ' ')}`
    );
    return `*Proyectos (${projects.length})*\n\n${lines.join('\n')}`;
  }

  // ── Presupuesto ────────────────────────────────────────────────────────
  if (t === 'presupuesto' || t.includes('presupuesto')) {
    const project = await prisma.project.findFirst({
      where: { companyId, activo: true },
      include: { itemsAPU: true },
    });
    if (!project) return 'No hay proyecto activo.';
    const total = project.itemsAPU.reduce((a, i) => a + Number(i.cantidad) * Number(i.precioUnitario), 0);
    const saldo = project.itemsAPU.reduce((a, i) => a + Number(i.saldoValor), 0);
    const ejecutado = total - saldo;
    const pct = total > 0 ? Math.round((ejecutado / total) * 100) : 0;
    return (
      `*Presupuesto — ${project.nombre}*\n\n` +
      `💰 Total: ${fmt(total)}\n` +
      `✅ Ejecutado: ${fmt(ejecutado)} (${pct}%)\n` +
      `📊 Saldo: ${fmt(saldo)}\n` +
      `📐 Ítems APU: ${project.itemsAPU.length}`
    );
  }

  // ── APU ────────────────────────────────────────────────────────────────
  if (t === 'apus' || t === 'lista apu' || t === 'listar apu') {
    const items = await prisma.itemAPU.findMany({
      where: { project: { companyId, activo: true } },
      orderBy: { codigo: 'asc' },
      take: 15,
    });
    if (!items.length) return 'No hay ítems APU en el proyecto activo.';
    const lines = items.map(
      (i) => `• *${i.codigo}* ${i.descripcion.slice(0, 40)} — ${i.unidad} @ ${fmt(i.precioUnitario)}`
    );
    return `*Ítems APU (primeros ${items.length})*\n\n${lines.join('\n')}\n\n_Escribe "apu <código>" para ver detalle._`;
  }

  if (t.startsWith('apu ')) {
    const code = t.replace(/^apu\s+/, '').trim();
    const item = await prisma.itemAPU.findFirst({
      where: { project: { companyId, activo: true }, codigo: { contains: code, mode: 'insensitive' } },
    });
    if (!item) return `No encontré el ítem APU con código _"${code}"_.`;
    return (
      `*APU ${item.codigo}*\n\n` +
      `📝 ${item.descripcion}\n` +
      `📏 Unidad: ${item.unidad}\n` +
      `🔢 Cantidad: ${Number(item.cantidad)}\n` +
      `💲 Precio unitario: ${fmt(item.precioUnitario)}\n` +
      `💰 Valor total: ${fmt(Number(item.cantidad) * Number(item.precioUnitario))}\n` +
      `📊 Saldo: ${fmt(item.saldoValor)}`
    );
  }

  // ── Proveedores ────────────────────────────────────────────────────────
  if (t === 'proveedores' || t === 'lista proveedores') {
    const suppliers = await prisma.supplier.findMany({
      where: { companyId, activo: true },
      orderBy: { nombre: 'asc' },
      take: 20,
    });
    if (!suppliers.length) return 'No hay proveedores registrados.';
    const lines = suppliers.map(
      (s) =>
        `• *${s.nombre}*${s.ciudad ? ` (${s.ciudad})` : ''} — ${s.segmento}${s.whatsapp ? ` 📱${s.whatsapp}` : ''}`
    );
    return `*Proveedores (${suppliers.length})*\n\n${lines.join('\n')}`;
  }

  if (t.startsWith('proveedor ')) {
    const q = t.replace(/^proveedor\s+/, '').trim();
    const results = await prisma.supplier.findMany({
      where: { companyId, activo: true, nombre: { contains: q, mode: 'insensitive' } },
      take: 5,
    });
    if (!results.length) return `No encontré proveedores con nombre _"${q}"_.`;
    const lines = results.map(
      (s) =>
        `• *${s.nombre}*\n  Segmento: ${s.segmento} | Ciudad: ${s.ciudad || 'N/D'}\n  📱 ${s.whatsapp || 'Sin WhatsApp'} | ✉️ ${s.email || 'Sin email'}`
    );
    return `*Resultados para "${q}"*\n\n${lines.join('\n\n')}`;
  }

  // ── Precios básicos ────────────────────────────────────────────────────
  if (t === 'básicos' || t === 'basicos' || t === 'precios basicos' || t === 'precios básicos') {
    const items = await prisma.basicPrice.findMany({
      where: { companyId },
      orderBy: { codigo: 'asc' },
      take: 15,
    });
    if (!items.length) return 'No hay precios básicos registrados.';
    const lines = items.map(
      (b) => `• *${b.codigo}* ${b.descripcion.slice(0, 40)} — ${b.unidad} @ ${fmt(b.precioUnitario)}`
    );
    return `*Precios Básicos (${items.length})*\n\n${lines.join('\n')}`;
  }

  // ── Requisiciones ──────────────────────────────────────────────────────
  if (t === 'requisiciones' || t === 'requisicion' || t.includes('requisicion')) {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    const reqs = await prisma.requisition.findMany({
      where: {
        projectId: { in: projectIds },
        estado: { in: ['ENVIADA', 'PENDIENTE_JUST', 'EN_COTIZACION'] },
      },
      include: { project: { select: { nombre: true } }, solicitante: { select: { nombre: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (!reqs.length) return 'No hay requisiciones pendientes.';
    const lines = reqs.map(
      (r) => `• *${r.consecutivo}* — ${r.estado.replace(/_/g, ' ')}\n  📁 ${r.project.nombre} | 👤 ${r.solicitante.nombre}`
    );
    return `*Requisiciones activas (${reqs.length})*\n\n${lines.join('\n\n')}`;
  }

  // ── Órdenes de compra ──────────────────────────────────────────────────
  if (t === 'ordenes' || t === 'orden' || t === 'oc' || t.includes('orden de compra')) {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    const orders = await prisma.purchaseOrder.findMany({
      where: {
        estado: { in: ['EMITIDA', 'ENVIADA', 'ENTREGADA'] },
        quotation: { requisition: { projectId: { in: projectIds } } },
      },
      include: { proveedor: { select: { nombre: true } } },
      orderBy: { fechaEmision: 'desc' },
      take: 10,
    });
    if (!orders.length) return 'No hay órdenes de compra activas.';
    const lines = orders.map(
      (o) =>
        `• *${o.consecutivo}* — ${o.estado} — ${fmt(o.montoTotal)}\n  🏭 ${o.proveedor.nombre}${o.fechaEntregaPactada ? ` | Entrega: ${new Date(o.fechaEntregaPactada).toLocaleDateString('es-CO')}` : ''}`
    );
    return `*Órdenes de compra (${orders.length})*\n\n${lines.join('\n\n')}`;
  }

  // ── Cotizaciones ───────────────────────────────────────────────────────
  if (t === 'cotizaciones' || t === 'cotizacion') {
    const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
    const projectIds = projects.map((p) => p.id);
    const quotes = await prisma.quotation.findMany({
      where: {
        estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] },
        requisition: { projectId: { in: projectIds } },
      },
      include: {
        requisition: { select: { consecutivo: true } },
        invites: { include: { supplier: { select: { nombre: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (!quotes.length) return 'No hay cotizaciones en curso.';
    const lines = quotes.map((q) => {
      const respondidos = q.invites.filter((i) => i.respondido).length;
      return `• Cotiz. de *${q.requisition.consecutivo}* — ${q.estado.replace(/_/g, ' ')}\n  ${respondidos}/${q.invites.length} proveedores han respondido`;
    });
    return `*Cotizaciones en curso (${quotes.length})*\n\n${lines.join('\n\n')}`;
  }

  // ── Estado general ─────────────────────────────────────────────────────
  if (t === 'estado') {
    const [totalProyectos, reqPendientes, ocActivas, cotActivas] = await Promise.all([
      prisma.project.count({ where: { companyId } }),
      prisma.requisition.count({
        where: { project: { companyId }, estado: { in: ['ENVIADA', 'PENDIENTE_JUST'] } },
      }),
      prisma.purchaseOrder.count({
        where: { estado: { in: ['EMITIDA', 'ENVIADA'] }, quotation: { requisition: { project: { companyId } } } },
      }),
      prisma.quotation.count({
        where: { estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] }, requisition: { project: { companyId } } },
      }),
    ]);
    const activeProject = await prisma.project.findFirst({
      where: { companyId, activo: true },
      select: { nombre: true },
    });
    return (
      `*Estado PROCURA AI*\n\n` +
      `🏗️ Proyecto activo: ${activeProject?.nombre || 'Ninguno'}\n` +
      `📁 Total proyectos: ${totalProyectos}\n` +
      `📋 Req. pendientes de aprobación: ${reqPendientes}\n` +
      `💬 Cotizaciones en curso: ${cotActivas}\n` +
      `📦 OC activas: ${ocActivas}`
    );
  }

  return null;
};

// ── Contexto para IA ────────────────────────────────────────────────────────

const buildDbContext = async (companyId) => {
  const [company, activeProject, reqPendientes, ocActivas, ultimasOC, proveedores, cotActivas] =
    await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { razonSocial: true } }),
      prisma.project.findFirst({
        where: { companyId, activo: true },
        include: { itemsAPU: { select: { codigo: true, descripcion: true, cantidad: true, precioUnitario: true, saldoValor: true } } },
      }),
      prisma.requisition.count({
        where: { project: { companyId }, estado: { in: ['ENVIADA', 'PENDIENTE_JUST', 'EN_COTIZACION'] } },
      }),
      prisma.purchaseOrder.count({
        where: { estado: { in: ['EMITIDA', 'ENVIADA'] }, quotation: { requisition: { project: { companyId } } } },
      }),
      prisma.purchaseOrder.findMany({
        where: { quotation: { requisition: { project: { companyId } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { consecutivo: true, estado: true, montoTotal: true, fechaEntregaPactada: true, proveedor: { select: { nombre: true } } },
      }),
      prisma.supplier.findMany({
        where: { companyId, activo: true },
        select: { nombre: true, segmento: true, ciudad: true },
        orderBy: { nombre: 'asc' },
        take: 20,
      }),
      prisma.quotation.count({
        where: { estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] }, requisition: { project: { companyId } } },
      }),
    ]);

  let presupuestoInfo = 'Sin proyecto activo.';
  if (activeProject) {
    const total = activeProject.itemsAPU.reduce((a, i) => a + Number(i.cantidad) * Number(i.precioUnitario), 0);
    const saldo = activeProject.itemsAPU.reduce((a, i) => a + Number(i.saldoValor), 0);
    const pct = total > 0 ? Math.round(((total - saldo) / total) * 100) : 0;
    presupuestoInfo =
      `Proyecto activo: ${activeProject.nombre} | ` +
      `Presupuesto: ${fmt(total)} | Ejecutado: ${pct}% | Saldo: ${fmt(saldo)} | ` +
      `Ítems APU: ${activeProject.itemsAPU.length}`;
  }

  const ocInfo =
    ultimasOC
      .map(
        (o) =>
          `${o.consecutivo} (${o.estado}) ${fmt(o.montoTotal)} — ${o.proveedor.nombre}${o.fechaEntregaPactada ? ` entrega ${new Date(o.fechaEntregaPactada).toLocaleDateString('es-CO')}` : ''}`
      )
      .join('; ') || 'Sin OC recientes.';

  const provInfo = proveedores.length
    ? proveedores.map((p) => `${p.nombre} (${p.segmento}${p.ciudad ? ` — ${p.ciudad}` : ''})`).join(', ')
    : 'Sin proveedores registrados.';

  return (
    `Empresa: ${company?.razonSocial || 'INGCISOL'}\n` +
    `${presupuestoInfo}\n` +
    `Requisiciones pendientes/en cotización: ${reqPendientes}\n` +
    `Cotizaciones activas: ${cotActivas}\n` +
    `OC activas: ${ocActivas}\n` +
    `Últimas OC: ${ocInfo}\n` +
    `Proveedores registrados (${proveedores.length}): ${provInfo}`
  );
};

// ── Manejo de respuestas de proveedores ─────────────────────────────────────

// Punto de entrada: decide si el mensaje del proveedor es una cotización (precios)
// o una respuesta sobre una orden de compra (confirmación / fecha de entrega).
const handleSupplierMessage = async (text, companyId, supplierId, supplierName) => {
  logger.info(`[bot.context] Mensaje de proveedor ${supplierName}: "${text.slice(0, 80)}"`);

  // Contexto A: cotización abierta donde fue invitado (permite re-cotizar/corregir).
  const invite = await prisma.quotationInvite.findFirst({
    where: {
      supplierId,
      quotation: {
        estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] },
        requisition: { project: { companyId } },
      },
    },
    include: {
      quotation: {
        include: { requisition: { include: { items: { include: { itemAPU: true } } } } },
      },
    },
    orderBy: { sentAt: 'desc' },
  });

  // Contexto B: orden de compra activa pendiente de confirmar/entregar.
  const activePO = await prisma.purchaseOrder.findFirst({
    where: {
      supplierId,
      estado: { in: ['EMITIDA', 'ENVIADA'] },
      quotation: { requisition: { project: { companyId } } },
    },
    include: {
      quotation: { include: { requisition: { select: { consecutivo: true } } } },
    },
    orderBy: { fechaEmision: 'desc' },
  });

  // Sin contexto → conversación general.
  if (!invite && !activePO) {
    return groqFallback(text, companyId, { isSupplier: true, supplierName });
  }

  // Un solo contexto → ruta directa. Con ambos, la IA decide la intención.
  if (invite && !activePO) return handleSupplierQuote(text, companyId, supplierId, supplierName, invite);
  if (activePO && !invite) return handleSupplierDelivery(text, companyId, supplierName, activePO);

  const intent = await classifySupplierIntent(text);
  if (intent === 'ENTREGA') return handleSupplierDelivery(text, companyId, supplierName, activePO);
  // COTIZACION o ambiguo: por defecto tratamos como cotización (el parser pedirá
  // precios si no los encuentra), porque tiene una solicitud de precios abierta.
  return handleSupplierQuote(text, companyId, supplierId, supplierName, invite);
};

// Clasifica la intención cuando el proveedor tiene cotización Y orden activas.
const classifySupplierIntent = async (text) => {
  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const c = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Clasifica el mensaje de un proveedor en UNA categoría. Responde SOLO JSON {"intent":"COTIZACION|ENTREGA|OTRO"}.
- COTIZACION: está dando precios o cotizando materiales.
- ENTREGA: confirma una orden de compra, da/cambia una fecha de entrega, o avisa que ya entregó/despachó.
- OTRO: saludo u otra cosa.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0,
      max_tokens: 40,
      response_format: { type: 'json_object' },
    });
    return JSON.parse(c.choices[0].message.content).intent || 'OTRO';
  } catch {
    return 'OTRO';
  }
};

// ── Cotización: parsea precios y los guarda (un ítem por requisición/proveedor) ──
const handleSupplierQuote = async (text, companyId, supplierId, supplierName, invite) => {
  const quotation = invite.quotation;
  const reqItems = quotation.requisition.items;

  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const itemsList = reqItems.map((it, i) => `${i + 1}. ${it.descripcion} (${it.unidad})`).join('\n');

    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de cotizaciones para el sector construcción en Colombia.
El proveedor respondió a una solicitud de precios. Los ítems solicitados fueron:
${itemsList}

Extrae los precios de la respuesta. Responde SOLO con JSON válido:
{
  "items": [
    {"itemIndex": 0, "descripcion": "...", "precioUnitario": 28000, "tiempoEntregaDias": 3}
  ],
  "notas": "observación adicional o null"
}
Si el proveedor no puede suministrar un ítem, no lo incluyas en items.
Los precios deben ser en pesos colombianos (COP). Si menciona miles, multiplica (ej: "28 mil" = 28000).`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 800,
      response_format: { type: 'json_object' },
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch {
      logger.error('[bot.context] Groq devolvió JSON inválido para cotización');
      return `Gracias ${supplierName}. No pude interpretar su respuesta. Por favor use el formato:\n"Item1: precio, Item2: precio, Entrega: X días"`;
    }

    const parsedItems = parsed.items || [];
    if (parsedItems.length === 0) {
      return `Gracias ${supplierName}. No encontré precios en su respuesta. Por favor indique el precio de cada ítem: ${reqItems.map((i) => i.descripcion).join(', ')}.`;
    }

    // Guardar los QuotationItem — upsert por (cotización, proveedor, ítem de
    // requisición): si el proveedor recotiza, ACTUALIZA en vez de duplicar.
    const createdItems = [];
    for (const pi of parsedItems) {
      const reqItem = reqItems[pi.itemIndex];
      if (!reqItem) continue;
      const cantidad = Number(reqItem.cantidad) || 1;
      const precioUnitario = Number(pi.precioUnitario) || 0;

      await prisma.quotationItem.upsert({
        where: {
          quotationId_supplierId_requisitionItemId: {
            quotationId: quotation.id,
            supplierId,
            requisitionItemId: reqItem.id,
          },
        },
        update: {
          precioUnitario,
          precioTotal: precioUnitario * cantidad,
          tiempoEntrega: pi.tiempoEntregaDias || 0,
          itemApuId: reqItem.itemApuId || null,
          descripcion: reqItem.descripcion,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
        create: {
          quotationId: quotation.id,
          supplierId,
          requisitionItemId: reqItem.id,
          itemApuId: reqItem.itemApuId || null,
          descripcion: reqItem.descripcion,
          precioUnitario,
          precioTotal: precioUnitario * cantidad,
          tiempoEntrega: pi.tiempoEntregaDias || 0,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
      });
      createdItems.push({ descripcion: reqItem.descripcion, precioUnitario, cantidad });
    }

    // Marcar invite como respondido
    await prisma.quotationInvite.update({
      where: { id: invite.id },
      data: { respondido: true, respondedAt: new Date() },
    });

    // ¿Ya respondieron todos los proveedores invitados? → avisar al director
    // por WhatsApp para que adjudique al/los ganador(es).
    const pendientes = await prisma.quotationInvite.count({
      where: { quotationId: quotation.id, respondido: false },
    });
    if (pendientes === 0) {
      await publishCommand(redis, 'notify_winner_selection', {
        companyId,
        quotationId: quotation.id,
      }).catch(() => {});
    }

    // Notificar in-app a directores
    const directors = await prisma.user.findMany({
      where: { companyId, rol: { in: ['DIRECTOR', 'APOYO_DIRECTOR'] }, activo: true },
      select: { id: true },
    });
    await prisma.notification.createMany({
      data: directors.map((d) => ({
        companyId,
        userId: d.id,
        tipo: 'COTIZACION_INICIADA',
        titulo: `${supplierName} cotizó ${createdItems.length} ítem(s)`,
        mensaje: `Respondió a cotización de ${quotation.requisition.consecutivo}`,
        entidad: 'Quotation',
        entidadId: quotation.id,
      })),
    });

    const resumen = createdItems.map((i) => `- ${i.descripcion}: ${fmt(i.precioUnitario)}`).join('\n');
    const totalResp = createdItems.reduce((a, i) => a + i.precioUnitario * i.cantidad, 0);

    return (
      `✅ *Cotización registrada*\n\n` +
      `Gracias *${supplierName}*. Hemos registrado su cotización:\n\n` +
      `${resumen}\n\n` +
      `💰 Total estimado: *${fmt(totalResp)}*\n\n` +
      (parsed.notas ? `📝 Nota: ${parsed.notas}\n\n` : '') +
      `Le notificaremos si es seleccionado como proveedor ganador.`
    );
  } catch (err) {
    logger.error('[bot.context] Error procesando cotización proveedor:', err.message);
    return `Gracias ${supplierName}. Recibimos su mensaje pero hubo un error al procesarlo. Un agente lo revisará pronto.`;
  }
};

// ── Entrega: el proveedor confirma la OC, fija fecha o avisa que ya entregó ──────
const handleSupplierDelivery = async (text, companyId, supplierName, activePO) => {
  const trackingService = require('../tracking/tracking.service');
  const consecutivo = activePO.consecutivo;

  let parsed = { tipo: 'OTRO', fechaEntrega: null, notas: null };
  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const hoy = new Date().toISOString().slice(0, 10);
    const c = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Hoy es ${hoy}. Un proveedor responde sobre la orden de compra ${consecutivo}. Extrae en JSON válido:
{"tipo":"CONFIRMAR|ENTREGADO|OTRO","fechaEntrega":"YYYY-MM-DD"|null,"notas":"texto"|null}
- CONFIRMAR: acepta la orden y/o dice cuándo entregará. Si menciona una fecha (incluso relativa como "el viernes" o "en 3 días"), conviértela a YYYY-MM-DD respecto a hoy.
- ENTREGADO: dice que ya entregó o despachó el material.
- OTRO: no se entiende o no tiene que ver con la entrega.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    });
    parsed = JSON.parse(c.choices[0].message.content);
  } catch (err) {
    logger.error('[bot.context] Error parseando confirmación de entrega:', err.message);
  }

  if (parsed.tipo !== 'CONFIRMAR' && parsed.tipo !== 'ENTREGADO') {
    return `Gracias *${supplierName}*. Sobre la orden *${consecutivo}*, por favor confirme la fecha de entrega (ej: "entrego el 30 de junio") o avísenos cuando haya entregado.`;
  }

  const fecha = parsed.fechaEntrega ? new Date(parsed.fechaEntrega) : null;
  if (fecha && Number.isNaN(fecha.getTime())) {
    return `Gracias *${supplierName}*. No entendí la fecha. ¿Podría indicarla así: "entrego el 30 de junio"?`;
  }

  try {
    const { order } = await trackingService.confirmOrderFromSupplier(companyId, activePO.id, {
      tipo: parsed.tipo,
      fecha,
    });
    await notifyDirectorsOrderUpdate(companyId, order, supplierName, parsed);

    if (parsed.tipo === 'ENTREGADO') {
      return `✅ Gracias *${supplierName}*. Registramos la *entrega* de la orden *${consecutivo}*. Avisamos al equipo para el cierre y pago.`;
    }
    const fechaTxt = order.fechaEntregaPactada
      ? ` con entrega pactada para el *${new Date(order.fechaEntregaPactada).toLocaleDateString('es-CO')}*`
      : '';
    return `✅ Gracias *${supplierName}*. Confirmamos la orden *${consecutivo}*${fechaTxt}.\nLe enviaremos un recordatorio cerca de la fecha de entrega.`;
  } catch (err) {
    logger.error('[bot.context] Error confirmando OC del proveedor:', err.message);
    return `Gracias ${supplierName}. Recibimos su mensaje sobre la orden ${consecutivo}, pero hubo un error al registrarlo. Un agente lo revisará.`;
  }
};

// Avisa a los directores (in-app + WhatsApp) que un proveedor confirmó/entregó.
const notifyDirectorsOrderUpdate = async (companyId, order, supplierName, parsed) => {
  const entregado = parsed.tipo === 'ENTREGADO';
  const titulo = entregado
    ? `${supplierName} marcó ENTREGADA la OC ${order.consecutivo}`
    : `${supplierName} confirmó la OC ${order.consecutivo}`;
  const fechaTxt = order.fechaEntregaPactada
    ? ` Entrega: ${new Date(order.fechaEntregaPactada).toLocaleDateString('es-CO')}.`
    : '';
  const mensaje = `${parsed.notas ? parsed.notas + '.' : ''}${fechaTxt}`.trim() || 'Actualización del proveedor.';

  const directors = await prisma.user.findMany({
    where: { companyId, rol: { in: ['DIRECTOR', 'APOYO_DIRECTOR'] }, activo: true },
    select: { id: true, whatsapp: true },
  });

  await prisma.notification
    .createMany({
      data: directors.map((d) => ({
        companyId,
        userId: d.id,
        tipo: entregado ? 'OC_ENTREGADA' : 'OC_EMITIDA',
        titulo,
        mensaje,
        entidad: 'PurchaseOrder',
        entidadId: order.id,
      })),
    })
    .catch(() => {});

  try {
    const { enqueueText } = require('./sendQueue');
    const icono = entregado ? '📦' : '✅';
    for (const d of directors) {
      if (d.whatsapp) enqueueText(companyId, d.whatsapp, `${icono} *${titulo}*.${fechaTxt}${parsed.notas ? `\n📝 ${parsed.notas}` : ''}`);
    }
  } catch (err) {
    logger.error('[bot.context] No se pudo notificar a directores por WhatsApp:', err.message);
  }
};

// ── Fallback IA ─────────────────────────────────────────────────────────────

const groqFallback = async (text, companyId, opts = {}) => {
  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const context = await buildDbContext(companyId);

    const systemContent = opts.isSupplier
      ? `Eres el asistente de PROCURA AI para proveedores. El proveedor "${opts.supplierName}" te escribió.
Responde en español de forma amable y concisa. Si no es una cotización, oriéntalo sobre cómo responder correctamente.

DATOS DEL SISTEMA:
${context}`
      : `Eres el agente de compras de PROCURA AI, sistema de gestión de procura para constructoras colombianas.
El usuario que te habla es ${opts.rol || 'un usuario'} de la empresa.
Responde en español, de forma clara y concisa (máximo 3 párrafos cortos), usando *negrillas* para énfasis en WhatsApp.
Solo responde sobre compras, presupuestos, requisiciones, cotizaciones, órdenes de compra, proveedores y proyectos.
Puedes crear requisiciones, consultar el estado, aprobar y rechazar directamente desde este chat: invita al usuario a pedírtelo en lenguaje natural (ej: "necesito 50 bultos de cemento", "¿en qué va REQ-2026-003?", "aprueba REQ-2026-003").

DATOS ACTUALES DEL SISTEMA:
${context}`;

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemContent },
        { role: 'user', content: text },
      ],
      temperature: 0.4,
      max_tokens: 400,
    });

    return completion.choices[0].message.content || null;
  } catch (err) {
    logger.error('[bot.context] Error en Groq fallback:', err.message);
    return null;
  }
};

// ── Creación de requisición ──────────────────────────────────────────────────

// Casa ítems extraídos (descripción/cantidad/unidad) contra el APU/insumos del
// proyecto y arma el payload de creación + un resumen legible para WhatsApp.
const matchExtractedItems = async (companyId, extracted) => {
  const items = [];
  const resumen = [];
  for (const ex of extracted) {
    const cantidad = Number(ex.cantidad) || 1;
    const matches = await apuService.findBudgetMatches(companyId, ex.descripcion, 1);
    const best = matches[0];
    if (best) {
      items.push({
        descripcion: best.descripcion,
        cantidad,
        unidad: ex.unidad || best.unidad || 'UND',
        codigo: best.codigo,
        itemApuId: best.itemApuId,
        itemApuInsumoId: best.itemApuInsumoId || null,
      });
      const etiqueta = best.type === 'INSUMO' ? `insumo de ${best.codigo}` : `APU ${best.codigo}`;
      resumen.push(`✅ ${cantidad} ${ex.unidad || best.unidad} *${best.descripcion}* — ${etiqueta} (${fmt(best.precioUnitario)})`);
    } else {
      items.push({
        descripcion: ex.descripcion,
        cantidad,
        unidad: ex.unidad || 'UND',
        codigo: '',
        itemApuId: null,
        itemApuInsumoId: null,
      });
      resumen.push(`⚠️ ${cantidad} ${ex.unidad || ''} *${ex.descripcion}* — no está en el APU (requiere justificación)`);
    }
  }
  return { items, resumen };
};

// Crea la requisición a partir de ítems ya extraídos. Reutilizable por el flujo
// de lenguaje natural y por el agente IA (herramienta crear_requisicion).
const createRequisitionFromItems = async (companyId, user, extracted, prioridad = 'MEDIA') => {
  const project = await prisma.project.findFirst({ where: { companyId, activo: true } });
  if (!project) {
    return { ok: false, message: 'No hay un proyecto activo. Pide al director que active un proyecto antes de crear requisiciones.' };
  }
  if (!Array.isArray(extracted) || extracted.length === 0) {
    return { ok: false, message: 'No identifiqué materiales para la requisición. Indícame qué necesitas y cuánto.' };
  }

  const { items, resumen } = await matchExtractedItems(companyId, extracted);
  const prio = ['ALTA', 'MEDIA', 'BAJA'].includes(prioridad) ? prioridad : 'MEDIA';

  try {
    const req = await requisitionsService.createRequisition(companyId, user.id, {
      projectId: project.id,
      items,
      prioridad: prio,
      canal: 'WHATSAPP',
    });
    const fueraApu = items.filter((i) => !i.itemApuId).length;
    const message =
      `📋 *Requisición ${req.consecutivo} creada*\n\n` +
      `${resumen.join('\n')}\n\n` +
      `Estado: *${req.estado.replace(/_/g, ' ')}*` +
      (fueraApu > 0
        ? `\n\n⚠️ ${fueraApu} ítem(s) fuera del APU. El director debe justificarlos antes de aprobar.`
        : `\n\n✅ Todos los ítems están en el presupuesto. Pendiente de aprobación del director.`);
    return { ok: true, message, consecutivo: req.consecutivo };
  } catch (err) {
    logger.error('[bot.context] Error creando requisición:', err.message);
    return { ok: false, message: `No pude crear la requisición: ${err.message}` };
  }
};

// ── Entrada principal ────────────────────────────────────────────────────────

const buildResponse = async (text, companyId, user) => {
  const rol = typeof user === 'string' ? user : user?.rol;
  const userId = typeof user === 'object' ? user?.id : null;
  const t = text.toLowerCase().trim();

  // 1. Comandos exactos / consultas rápidas y deterministas.
  const commandResult = await handleCommand(t, companyId, rol);
  if (commandResult !== null) return commandResult;

  // 2. Usuarios internos → agente IA (consulta y ejecuta acciones).
  if (userId) {
    try {
      const { runAgent } = require('./bot.agent');
      const reply = await runAgent(text, companyId, { id: userId, rol });
      if (reply) return reply;
    } catch (err) {
      logger.error('[bot.context] Error en agente IA:', err.message);
    }
  }

  // 3. Fallback IA conversacional.
  return groqFallback(text, companyId, { rol });
};

module.exports = {
  buildResponse,
  buildDbContext,
  handleSupplierMessage,
  handleCommand,
  groqFallback,
  createRequisitionFromItems,
};
