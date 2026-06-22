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

const handleSupplierMessage = async (text, companyId, supplierId, supplierName) => {
  logger.info(`[bot.context] Mensaje de proveedor ${supplierName}: "${text.slice(0, 80)}"`);

  // Buscar cotización activa donde este proveedor fue invitado y no ha respondido
  const invite = await prisma.quotationInvite.findFirst({
    where: {
      supplierId,
      respondido: false,
      quotation: {
        estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] },
        requisition: { project: { companyId } },
      },
    },
    include: {
      quotation: {
        include: {
          requisition: {
            include: { items: { include: { itemAPU: true } } },
          },
        },
      },
    },
    orderBy: { sentAt: 'desc' },
  });

  if (!invite) {
    // Puede ser un saludo o mensaje sin contexto de cotización
    return groqFallback(text, companyId, { isSupplier: true, supplierName });
  }

  const quotation = invite.quotation;
  const reqItems = quotation.requisition.items;

  // Usar Groq para parsear los precios de la respuesta del proveedor
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
    {"itemIndex": 0, "descripcion": "...", "precioUnitario": 28000, "tiempoEntregaDias": 3},
    ...
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

    // Guardar los QuotationItem
    const createdItems = [];
    for (const pi of parsedItems) {
      const reqItem = reqItems[pi.itemIndex];
      if (!reqItem) continue;
      const cantidad = Number(reqItem.cantidad) || 1;
      const precioUnitario = Number(pi.precioUnitario) || 0;

      await prisma.quotationItem.upsert({
        where: {
          id: `${quotation.id}_${supplierId}_${reqItem.id}`.slice(0, 30) + '_dummy', // fallback
        },
        update: {
          precioUnitario,
          precioTotal: precioUnitario * cantidad,
          tiempoEntrega: pi.tiempoEntregaDias || 0,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
        create: {
          quotationId: quotation.id,
          supplierId,
          itemApuId: reqItem.itemApuId || null,
          descripcion: reqItem.descripcion,
          precioUnitario,
          precioTotal: precioUnitario * cantidad,
          tiempoEntrega: pi.tiempoEntregaDias || 0,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
      }).catch(() => {
        // Si upsert falla por id generado, hacer create directo
        return prisma.quotationItem.create({
          data: {
            quotationId: quotation.id,
            supplierId,
            itemApuId: reqItem.itemApuId || null,
            descripcion: reqItem.descripcion,
            precioUnitario,
            precioTotal: precioUnitario * cantidad,
            tiempoEntrega: pi.tiempoEntregaDias || 0,
            fuente: 'LOCAL',
            confiabilidad: 'LOCAL',
          },
        });
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
Si el usuario necesita ejecutar una acción (aprobar, crear requisición, etc.), indícale que lo haga desde el panel web.

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

// ── Creación de requisición por lenguaje natural ─────────────────────────────

// Palabras que indican intención de solicitar materiales
const REQ_INTENT_RE = /\b(necesito|necesitamos|requiero|requerimos|solicito|solicitamos|pido|pedir|hace falta|hacen falta|requisici[oó]n|me mandan|env[ií]en|comprar|compra de|para obra)\b/i;

const tryCreateRequisition = async (text, companyId, user) => {
  const project = await prisma.project.findFirst({ where: { companyId, activo: true } });
  if (!project) return 'No hay un proyecto activo. Pide al director que active un proyecto antes de crear requisiciones.';

  // 1. Extraer ítems con IA
  let extracted = [];
  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de requisiciones de obra en Colombia. El usuario solicita materiales/insumos.
Extrae cada ítem solicitado. Responde SOLO JSON válido:
{"items":[{"descripcion":"cemento gris","cantidad":50,"unidad":"bulto"}],"prioridad":"ALTA|MEDIA|BAJA"}
Si no menciona cantidad usa 1. Si no menciona unidad usa "UND". Si no menciona prioridad usa "MEDIA".
Si el mensaje NO es una solicitud de materiales, responde {"items":[]}.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
      max_tokens: 600,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    extracted = Array.isArray(parsed.items) ? parsed.items : [];
    var prioridad = ['ALTA', 'MEDIA', 'BAJA'].includes(parsed.prioridad) ? parsed.prioridad : 'MEDIA';
  } catch (err) {
    logger.error('[bot.context] Error extrayendo requisición:', err.message);
    return null; // dejar que caiga al fallback general
  }

  if (extracted.length === 0) return null; // no era una requisición → fallback

  // 2. Casar cada ítem contra el APU / insumos del proyecto
  const items = [];
  const resumen = [];
  for (const ex of extracted) {
    const matches = await apuService.findBudgetMatches(companyId, ex.descripcion, 1);
    const best = matches[0];
    if (best) {
      items.push({
        descripcion: best.descripcion,
        cantidad: Number(ex.cantidad) || 1,
        unidad: ex.unidad || best.unidad || 'UND',
        codigo: best.codigo,
        itemApuId: best.itemApuId,
        itemApuInsumoId: best.itemApuInsumoId || null,
      });
      const etiqueta = best.type === 'INSUMO' ? `insumo de ${best.codigo}` : `APU ${best.codigo}`;
      resumen.push(`✅ ${ex.cantidad || 1} ${ex.unidad || best.unidad} *${best.descripcion}* — ${etiqueta} (${fmt(best.precioUnitario)})`);
    } else {
      // No casó: ítem libre, fuera de APU
      items.push({
        descripcion: ex.descripcion,
        cantidad: Number(ex.cantidad) || 1,
        unidad: ex.unidad || 'UND',
        codigo: '',
        itemApuId: null,
        itemApuInsumoId: null,
      });
      resumen.push(`⚠️ ${ex.cantidad || 1} ${ex.unidad || ''} *${ex.descripcion}* — no está en el APU (requiere justificación)`);
    }
  }

  // 3. Crear la requisición
  try {
    const req = await requisitionsService.createRequisition(companyId, user.id, {
      projectId: project.id,
      items,
      prioridad,
      canal: 'WHATSAPP',
    });
    const fueraApu = items.filter((i) => !i.itemApuId).length;
    return (
      `📋 *Requisición ${req.consecutivo} creada*\n\n` +
      `${resumen.join('\n')}\n\n` +
      `Estado: *${req.estado.replace(/_/g, ' ')}*` +
      (fueraApu > 0
        ? `\n\n⚠️ ${fueraApu} ítem(s) fuera del APU. El director debe justificarlos antes de aprobar.`
        : `\n\n✅ Todos los ítems están en el presupuesto. Pendiente de aprobación del director.`)
    );
  } catch (err) {
    logger.error('[bot.context] Error creando requisición:', err.message);
    return `No pude crear la requisición: ${err.message}`;
  }
};

// ── Entrada principal ────────────────────────────────────────────────────────

const buildResponse = async (text, companyId, user) => {
  const rol = typeof user === 'string' ? user : user?.rol;
  const t = text.toLowerCase().trim();

  // 1. Comandos exactos / consultas
  const commandResult = await handleCommand(t, companyId, rol);
  if (commandResult !== null) return commandResult;

  // 2. Intención de crear requisición (solo usuarios internos con id)
  const userId = typeof user === 'object' ? user?.id : null;
  if (userId && REQ_INTENT_RE.test(t)) {
    const reqResult = await tryCreateRequisition(text, companyId, { id: userId, rol });
    if (reqResult !== null) return reqResult;
  }

  // 3. Fallback IA
  return groqFallback(text, companyId, { rol });
};

module.exports = { buildResponse, buildDbContext, handleSupplierMessage };
