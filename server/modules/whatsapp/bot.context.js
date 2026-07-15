const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');
const { publishCommand } = require('./bot.ipc');
const apuService = require('../apu/apu.service');
const requisitionsService = require('../requisitions/requisitions.service');

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// ── Consultas de datos (reutilizadas por comandos exactos y por el agente IA) ──

const fetchProjects = async (companyId) => {
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
};

const fetchBudgetSummary = async (companyId) => {
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
};

const fetchApuList = async (companyId) => {
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
};

const fetchApuDetail = async (companyId, code) => {
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
};

const fetchSuppliers = async (companyId, busqueda) => {
  const where = { companyId, activo: true };
  if (busqueda) where.nombre = { contains: busqueda, mode: 'insensitive' };
  const suppliers = await prisma.supplier.findMany({
    where,
    orderBy: { nombre: 'asc' },
    take: busqueda ? 5 : 20,
  });
  if (!suppliers.length) {
    return busqueda ? `No encontré proveedores con nombre _"${busqueda}"_.` : 'No hay proveedores registrados.';
  }
  if (busqueda) {
    const lines = suppliers.map(
      (s) =>
        `• *${s.nombre}*\n  Segmento: ${s.segmento} | Ciudad: ${s.ciudad || 'N/D'}\n  📱 ${s.whatsapp || 'Sin WhatsApp'} | ✉️ ${s.email || 'Sin email'}`
    );
    return `*Resultados para "${busqueda}"*\n\n${lines.join('\n\n')}`;
  }
  const lines = suppliers.map(
    (s) =>
      `• *${s.nombre}*${s.ciudad ? ` (${s.ciudad})` : ''} — ${s.segmento}${s.whatsapp ? ` 📱${s.whatsapp}` : ''}`
  );
  return `*Proveedores (${suppliers.length})*\n\n${lines.join('\n')}`;
};

const fetchBasicPrices = async (companyId) => {
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
};

const fetchRequisitions = async (companyId) => {
  const reqs = await prisma.requisition.findMany({
    where: {
      project: { companyId },
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
};

const fetchOrders = async (companyId) => {
  const orders = await prisma.purchaseOrder.findMany({
    where: {
      estado: { in: ['EMITIDA', 'ENVIADA', 'ENTREGADA'] },
      quotation: { requisition: { project: { companyId } } },
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
};

const fetchQuotes = async (companyId) => {
  const quotes = await prisma.quotation.findMany({
    where: {
      estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] },
      requisition: { project: { companyId } },
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
};

const fetchStatus = async (companyId) => {
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
};

// ── Comandos EXACTOS (atajos instantáneos, sin gastar tokens) ────────────────
// Solo palabras exactas o prefijos "apu <código>" / "proveedor <nombre>".
// Todo lo demás (frases naturales) va SIEMPRE al agente IA — no se secuestran
// frases con includes() como antes.

const handleCommand = async (t, companyId, rol) => {
  if (t === 'ayuda' || t === 'help' || t === '?') {
    return (
      '*PROCURA AI* 🤖\n\n' +
      'Escríbeme como le escribirías a una persona, yo entiendo. Por ejemplo:\n' +
      '• _"dame el estado de mis proyectos"_\n' +
      '• _"¿cuánto presupuesto queda?"_\n' +
      '• _"necesito 50 bultos de cemento para el viernes"_\n' +
      '• _"¿en qué va la REQ-2026-003?"_\n' +
      '• _"aprueba la última requisición"_\n\n' +
      'También tengo atajos rápidos: *estado*, *proyectos*, *presupuesto*, *requisiciones*, ' +
      '*cotizaciones*, *ordenes*, *proveedores*, *apus*, *básicos*.'
    );
  }

  if (t === 'proyectos') return fetchProjects(companyId);
  if (t === 'presupuesto') return fetchBudgetSummary(companyId);
  if (t === 'apus' || t === 'lista apu' || t === 'listar apu') return fetchApuList(companyId);
  if (t.startsWith('apu ')) return fetchApuDetail(companyId, t.replace(/^apu\s+/, '').trim());
  if (t === 'proveedores' || t === 'lista proveedores') return fetchSuppliers(companyId);
  if (t.startsWith('proveedor ')) return fetchSuppliers(companyId, t.replace(/^proveedor\s+/, '').trim());
  if (t === 'básicos' || t === 'basicos' || t === 'precios basicos' || t === 'precios básicos') return fetchBasicPrices(companyId);
  if (t === 'requisiciones' || t === 'requisicion') return fetchRequisitions(companyId);
  if (t === 'ordenes' || t === 'órdenes' || t === 'orden' || t === 'oc') return fetchOrders(companyId);
  if (t === 'cotizaciones' || t === 'cotizacion') return fetchQuotes(companyId);
  if (t === 'estado') return fetchStatus(companyId);

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

const { logParse } = require('./bot.parselog');
const { similarity, bestMatch } = require('../../shared/utils/fuzzy');

// Llamada a Groq que DEBE devolver JSON. Si el primer intento devuelve algo
// no parseable (o falla), reintenta UNA vez con temperature 0 y recordatorio
// estricto. Si aun así falla, lanza y el caller responde en tono natural.
const groqJson = async ({ system, user, maxTokens = 800 }) => {
  const { getGroq, GROQ_MODEL, GROQ_MODEL_FAST } = require('../../shared/utils/groq');
  const groq = getGroq();
  const ask = async (temperature, extraSystem) => {
    const c = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: extraSystem ? `${system}\n\n${extraSystem}` : system },
        { role: 'user', content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
    return c.choices[0].message.content;
  };
  try {
    return JSON.parse(await ask(0.1));
  } catch (err) {
    logger.warn(`[bot.context] Primer intento de JSON falló (${err.message}); reintentando estricto`);
  }
  return JSON.parse(await ask(0, 'IMPORTANTE: responde ÚNICAMENTE el objeto JSON válido, sin ningún texto adicional.'));
};

// Confirmación de lectura pendiente ("¿Correcto?") tras registrar cotización o
// entrega. Si el proveedor afirma, se agradece; si corrige, se re-parsea (el
// upsert actualiza sin duplicar).
const qconfirmKey = (companyId, supplierId) => `whatsapp:qconfirm:${companyId}:${supplierId}`;
const QCONFIRM_TTL = 60 * 60 * 24;
const AFFIRM_RE = /^(s[ií]+( se(ñ|n)or(a)?)?|correcto|ok(ay)?|listo|dale|va|perfecto|as[ií] es|exacto|de acuerdo|confirmado|todo bien|est[aá] bien)[.!👍🙏\s]*$/i;

const fmtFechaCorta = (d) =>
  new Date(d).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' });

// Punto de entrada: decide si el mensaje del proveedor es una cotización (precios)
// o una respuesta sobre una orden de compra (confirmación / fecha de entrega).
const handleSupplierMessage = async (text, companyId, supplierId, supplierName) => {
  logger.info(`[bot.context] Mensaje de proveedor ${supplierName}: "${text.slice(0, 80)}"`);

  // ¿Hay un "¿Correcto?" pendiente? Afirmación → cerrar; otra cosa → tratar
  // como corrección/mensaje nuevo (se limpia el estado y sigue el flujo).
  const pendingConfirm = await redis.get(qconfirmKey(companyId, supplierId)).catch(() => null);
  if (pendingConfirm) {
    await redis.del(qconfirmKey(companyId, supplierId)).catch(() => {});
    if (AFFIRM_RE.test(text.trim())) {
      return `¡Perfecto, *${supplierName}*! Quedó registrado. Cualquier cambio me escribes por aquí. 🙌`;
    }
  }

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
  if (activePO && !invite) return handleSupplierDelivery(text, companyId, supplierId, supplierName, activePO);

  const intent = await classifySupplierIntent(text, companyId, supplierId);
  if (intent === 'ENTREGA') return handleSupplierDelivery(text, companyId, supplierId, supplierName, activePO);
  // COTIZACION o ambiguo: por defecto tratamos como cotización (el parser pedirá
  // precios si no los encuentra), porque tiene una solicitud de precios abierta.
  return handleSupplierQuote(text, companyId, supplierId, supplierName, invite);
};

// Clasifica la intención cuando el proveedor tiene cotización Y orden activas.
// Usa el modelo grande (se invoca poco y el pequeño clasifica mal coloquialismos).
const classifySupplierIntent = async (text, companyId, supplierId) => {
  try {
    const parsed = await groqJson({
      system: `Clasifica el mensaje de un proveedor colombiano en UNA categoría. Responde SOLO JSON {"intent":"COTIZACION|ENTREGA|OTRO"}.
- COTIZACION: está dando precios o cotizando materiales (aunque sea coloquial: "te lo dejo en 30", "el bulto sale a 28 mil").
- ENTREGA: confirma una orden de compra, da/cambia una fecha de entrega, o avisa que ya entregó/despachó.
- OTRO: saludo u otra cosa.`,
      user: text,
      maxTokens: 40,
    });
    const intent = parsed.intent || 'OTRO';
    await logParse({ companyId, supplierId, contexto: 'INTENT', entrada: text, salida: parsed, exito: true });
    return intent;
  } catch (err) {
    await logParse({ companyId, supplierId, contexto: 'INTENT', entrada: text, exito: false, error: err.message });
    return 'OTRO';
  }
};

// ── Cotización: parsea precios en lenguaje natural y los guarda ──────────────
// Tolera respuestas libres ("tengo el cemento a 30mil para entregártelo el
// viernes"): el ítem se casa por descripción con match difuso (no se confía
// ciegamente en el índice del LLM), las fechas relativas se convierten, lo
// parcial se guarda preguntando solo lo que falta, y todo intento queda en
// BotParseLog para depurar.
const handleSupplierQuote = async (text, companyId, supplierId, supplierName, invite) => {
  const quotation = invite.quotation;
  const reqItems = quotation.requisition.items;
  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);

  let parsed;
  try {
    const itemsList = reqItems
      .map((it, i) => `${i}. ${it.descripcion} — ${Number(it.cantidad)} ${it.unidad}`)
      .join('\n');

    parsed = await groqJson({
      system: `Eres un extractor de cotizaciones para construcción en Colombia. Hoy es ${hoyISO}.
El proveedor responde EN LENGUAJE LIBRE a una solicitud de precios. Ítems solicitados (índice. descripción — cantidad unidad):
${itemsList}

Extrae lo que el proveedor cotiza. Responde SOLO JSON válido:
{
  "items": [
    {
      "descripcion": "el material tal como lo nombró el proveedor",
      "itemIndex": 0,
      "precioUnitario": 30000,
      "entregaDias": 3,
      "fechaEntrega": "YYYY-MM-DD"
    }
  ],
  "noSuministra": [1],
  "notas": "observación adicional o null"
}
Reglas:
- itemIndex: índice del ítem de la lista al que corresponde (0-based), o null si no estás seguro.
- precioUnitario en COP. "30mil"/"30 mil" = 30000; "1.2 millones" = 1200000. null si no dio precio para ese ítem.
- entregaDias: días de entrega si los menciona como plazo ("en 3 días"), si no null.
- fechaEntrega: si menciona una fecha o día ("el viernes", "el 20", "pasado mañana"), conviértela a fecha YYYY-MM-DD respecto a hoy (${hoyISO}); si no, null.
- noSuministra: índices de ítems que el proveedor dice explícitamente que NO puede suministrar (si no dice nada, []).
- Incluye en items SOLO lo que realmente cotizó.`,
      user: text,
      maxTokens: 900,
    });
  } catch (err) {
    logger.error('[bot.context] Cotización: JSON inválido tras reintento:', err.message);
    await logParse({ companyId, supplierId, contexto: 'QUOTE', entrada: text, exito: false, error: err.message });
    return (
      `Gracias *${supplierName}* 🙏. Recibí tu mensaje pero no logré identificar los precios. ` +
      `¿Me ayudas diciéndome cuánto vale cada uno? Necesito: ${reqItems.map((i) => i.descripcion).join(', ')}.`
    );
  }

  try {
    const parsedItems = Array.isArray(parsed.items) ? parsed.items : [];
    const noSuministraIdx = Array.isArray(parsed.noSuministra) ? parsed.noSuministra : [];

    // ── Casar cada ítem extraído con el ítem de requisición correcto ──
    // El índice del LLM solo se acepta si su descripción también coincide;
    // si no, gana el mejor match difuso. Nada se descarta en silencio.
    const reqDescs = reqItems.map((r) => r.descripcion);
    const matched = []; // { reqItem, precioUnitario, entregaDias }
    const unmatched = [];

    for (const pi of parsedItems) {
      const precioUnitario = Number(pi.precioUnitario) || 0;
      if (precioUnitario <= 0) continue; // sin precio no hay nada que guardar

      let idx = -1;
      const byIndex = Number.isInteger(pi.itemIndex) && reqItems[pi.itemIndex] ? pi.itemIndex : -1;
      if (byIndex >= 0 && (!pi.descripcion || similarity(pi.descripcion, reqDescs[byIndex]) >= 0.35)) {
        idx = byIndex;
      } else if (pi.descripcion) {
        idx = bestMatch(pi.descripcion, reqDescs, 0.35);
      } else {
        idx = byIndex;
      }

      if (idx < 0) {
        unmatched.push(pi.descripcion || '(sin descripción)');
        continue;
      }

      // Días de entrega: plazo directo o derivado de la fecha absoluta.
      let entregaDias = Number(pi.entregaDias) || 0;
      let fechaEntrega = null;
      if (pi.fechaEntrega) {
        const f = new Date(pi.fechaEntrega);
        if (!Number.isNaN(f.getTime())) {
          fechaEntrega = f;
          if (!entregaDias) entregaDias = Math.max(0, Math.ceil((f - hoy) / 86400000));
        }
      }
      matched.push({ reqItem: reqItems[idx], precioUnitario, entregaDias, fechaEntrega });
    }

    await logParse({
      companyId,
      supplierId,
      contexto: 'QUOTE',
      entrada: text,
      salida: { parsed, casados: matched.length, sinCasar: unmatched },
      exito: matched.length > 0,
      error: matched.length === 0 ? 'Sin ítems casados' : null,
    });

    if (!matched.length && !noSuministraIdx.length) {
      return (
        `Gracias *${supplierName}* 🙏. Leí tu mensaje pero no logré asociar precios a los materiales solicitados` +
        (unmatched.length ? ` (mencionaste: ${unmatched.join(', ')})` : '') +
        `. ¿Me confirmas el precio de cada uno? Necesito: ${reqItems.map((i) => i.descripcion).join(', ')}.`
      );
    }

    // ── Guardar (upsert: recotizar corrige, no duplica) ──
    const createdItems = [];
    for (const m of matched) {
      const cantidad = Number(m.reqItem.cantidad) || 1;
      await prisma.quotationItem.upsert({
        where: {
          quotationId_supplierId_requisitionItemId: {
            quotationId: quotation.id,
            supplierId,
            requisitionItemId: m.reqItem.id,
          },
        },
        update: {
          precioUnitario: m.precioUnitario,
          precioTotal: m.precioUnitario * cantidad,
          tiempoEntrega: m.entregaDias,
          itemApuId: m.reqItem.itemApuId || null,
          descripcion: m.reqItem.descripcion,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
        create: {
          quotationId: quotation.id,
          supplierId,
          requisitionItemId: m.reqItem.id,
          itemApuId: m.reqItem.itemApuId || null,
          descripcion: m.reqItem.descripcion,
          precioUnitario: m.precioUnitario,
          precioTotal: m.precioUnitario * cantidad,
          tiempoEntrega: m.entregaDias,
          fuente: 'LOCAL',
          confiabilidad: 'LOCAL',
        },
      });
      createdItems.push({
        descripcion: m.reqItem.descripcion,
        precioUnitario: m.precioUnitario,
        cantidad,
        entregaDias: m.entregaDias,
        fechaEntrega: m.fechaEntrega,
      });
    }

    // ── ¿Cubrió todos los ítems (cotizados ahora + antes + los que no suministra)? ──
    const cotizados = await prisma.quotationItem.findMany({
      where: { quotationId: quotation.id, supplierId },
      select: { requisitionItemId: true },
    });
    const cubiertos = new Set(cotizados.map((c) => c.requisitionItemId));
    for (const i of noSuministraIdx) {
      if (reqItems[i]) cubiertos.add(reqItems[i].id);
    }
    const faltantes = reqItems.filter((r) => !cubiertos.has(r.id));
    const completo = faltantes.length === 0;

    if (completo && !invite.respondido) {
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
    }

    // Notificar in-app a directores
    if (createdItems.length) {
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
      }).catch(() => {});
    }

    // ── Respuesta: read-back natural de lo capturado + solo lo que falta ──
    const resumen = createdItems
      .map((i) => {
        const entrega = i.fechaEntrega
          ? `, entrega ${fmtFechaCorta(i.fechaEntrega)}`
          : i.entregaDias
            ? `, entrega en ${i.entregaDias} día(s)`
            : '';
        return `• *${i.descripcion}*: ${fmt(i.precioUnitario)}${entrega}`;
      })
      .join('\n');
    const totalResp = createdItems.reduce((a, i) => a + i.precioUnitario * i.cantidad, 0);

    let reply = `Perfecto, *${supplierName}* 🙌. Esto fue lo que anoté:\n\n${resumen}\n`;
    if (createdItems.length > 1) reply += `\n💰 Total estimado: *${fmt(totalResp)}*\n`;
    if (noSuministraIdx.length) {
      const noNames = noSuministraIdx.map((i) => reqItems[i]?.descripcion).filter(Boolean);
      if (noNames.length) reply += `\n🚫 Sin suministro: ${noNames.join(', ')}\n`;
    }
    if (unmatched.length) {
      reply += `\n⚠️ No logré ubicar "${unmatched.join('", "')}" entre los materiales solicitados.\n`;
    }
    if (parsed.notas) reply += `\n📝 Nota: ${parsed.notas}\n`;

    if (completo) {
      reply += `\n¿Está todo correcto? Si algo quedó mal, escríbeme la corrección y lo actualizo. Le avisaremos si resulta seleccionado. ✅`;
      await redis.set(qconfirmKey(companyId, supplierId), '1', 'EX', QCONFIRM_TTL).catch(() => {});
    } else {
      reply += `\n¿Correcto? Y para completar tu cotización solo me falta el precio de: *${faltantes.map((f) => f.descripcion).join('*, *')}*. 😊`;
      await redis.set(qconfirmKey(companyId, supplierId), '1', 'EX', QCONFIRM_TTL).catch(() => {});
    }
    return reply;
  } catch (err) {
    logger.error('[bot.context] Error procesando cotización proveedor:', err.message);
    await logParse({ companyId, supplierId, contexto: 'QUOTE', entrada: text, exito: false, error: err.message });
    return `Gracias ${supplierName}. Recibimos su mensaje pero hubo un error al procesarlo. Un agente lo revisará pronto.`;
  }
};

// ── Entrega: el proveedor confirma la OC, fija fecha o avisa que ya entregó ──────
const handleSupplierDelivery = async (text, companyId, supplierId, supplierName, activePO) => {
  const trackingService = require('../tracking/tracking.service');
  const consecutivo = activePO.consecutivo;

  let parsed = { tipo: 'OTRO', fechaEntrega: null, notas: null };
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    parsed = await groqJson({
      system: `Hoy es ${hoy}. Un proveedor colombiano responde EN LENGUAJE LIBRE sobre la orden de compra ${consecutivo}. Extrae en JSON válido:
{"tipo":"CONFIRMAR|ENTREGADO|OTRO","fechaEntrega":"YYYY-MM-DD"|null,"notas":"texto"|null}
- CONFIRMAR: acepta la orden y/o dice cuándo entregará. Si menciona una fecha (incluso relativa o coloquial: "el viernes", "en 3 días", "la otra semana", "pasado mañana"), conviértela a YYYY-MM-DD respecto a hoy.
- ENTREGADO: dice que ya entregó o despachó el material.
- OTRO: no se entiende o no tiene que ver con la entrega.`,
      user: text,
      maxTokens: 150,
    });
    await logParse({ companyId, supplierId, contexto: 'DELIVERY', entrada: text, salida: parsed, exito: parsed.tipo !== 'OTRO' });
  } catch (err) {
    logger.error('[bot.context] Error parseando confirmación de entrega:', err.message);
    await logParse({ companyId, supplierId, contexto: 'DELIVERY', entrada: text, exito: false, error: err.message });
  }

  if (parsed.tipo !== 'CONFIRMAR' && parsed.tipo !== 'ENTREGADO') {
    return `Gracias *${supplierName}*. Sobre la orden *${consecutivo}*, ¿me confirmas para qué fecha nos entregas? (ej: "te lo llevo el viernes"). O avísame cuando ya hayas entregado.`;
  }

  const fecha = parsed.fechaEntrega ? new Date(parsed.fechaEntrega) : null;
  if (fecha && Number.isNaN(fecha.getTime())) {
    return `Gracias *${supplierName}*. No entendí bien la fecha 😅. ¿Me la confirmas? (ej: "entrego el 30 de julio").`;
  }

  try {
    const { order } = await trackingService.confirmOrderFromSupplier(companyId, activePO.id, {
      tipo: parsed.tipo,
      fecha,
    });
    await notifyDirectorsOrderUpdate(companyId, order, supplierName, parsed);

    if (parsed.tipo === 'ENTREGADO') {
      return `✅ ¡Gracias *${supplierName}*! Registramos la *entrega* de la orden *${consecutivo}*. Avisamos al equipo para el cierre y pago.`;
    }
    const fechaTxt = order.fechaEntregaPactada
      ? ` con entrega el *${fmtFechaCorta(order.fechaEntregaPactada)}*`
      : '';
    await redis.set(qconfirmKey(companyId, supplierId), '1', 'EX', QCONFIRM_TTL).catch(() => {});
    return `✅ Listo, *${supplierName}*: registramos la orden *${consecutivo}*${fechaTxt}. ¿Correcto? Si la fecha cambia, escríbeme por aquí. Te recordaremos cerca de la entrega.`;
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
    const { getGroq, GROQ_MODEL, GROQ_MODEL_FAST } = require('../../shared/utils/groq');
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
      model: GROQ_MODEL_FAST,
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

  // 1. Atajos exactos: respuesta instantánea y determinista, sin gastar tokens.
  const commandResult = await handleCommand(t, companyId, rol);
  if (commandResult !== null) return commandResult;

  // 2. TODO lo demás va al agente IA (lenguaje natural con herramientas reales).
  //    groqFallback queda solo como red de seguridad si el agente falla
  //    (p. ej. Groq caído a mitad del tool-calling).
  let agentError = null;
  if (userId) {
    try {
      const { runAgent } = require('./bot.agent');
      const reply = await runAgent(text, companyId, { id: userId, rol });
      if (reply) return reply;
    } catch (err) {
      agentError = err;
      logger.error('[bot.context] Error en agente IA:', err.message);
    }
  }

  const fallback = await groqFallback(text, companyId, { rol });
  if (fallback) return fallback;

  // Ambos caminos de IA fallaron: NUNCA responder con silencio. Se registra la
  // causa en BotParseLog (visible en el panel superadmin) y se avisa al usuario.
  await logParse({
    companyId,
    contexto: 'AGENT_ERROR',
    entrada: String(text).slice(0, 2000),
    exito: false,
    error: agentError ? agentError.message : 'Agente y fallback devolvieron vacío',
  });
  return (
    '⚠️ Estoy teniendo un problema técnico para procesar tu mensaje en este momento. ' +
    'Ya quedó registrado para revisión; intenta de nuevo en unos minutos o usa el panel web.'
  );
};

module.exports = {
  buildResponse,
  buildDbContext,
  handleSupplierMessage,
  handleCommand,
  groqFallback,
  createRequisitionFromItems,
  // Fetchers puros (reutilizados por las tools del agente IA)
  fetchProjects,
  fetchBudgetSummary,
  fetchApuList,
  fetchApuDetail,
  fetchSuppliers,
  fetchBasicPrices,
  fetchRequisitions,
  fetchOrders,
  fetchQuotes,
  fetchStatus,
};
