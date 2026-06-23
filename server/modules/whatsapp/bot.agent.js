const prisma = require('../../shared/db');
const { logger } = require('../../shared/utils/logger');
const { getGroq } = require('../../shared/utils/groq');
const requisitionsService = require('../requisitions/requisitions.service');
const botContext = require('./bot.context');

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

const ROLES_APRUEBAN = ['DIRECTOR', 'APOYO_DIRECTOR'];

// ── Helpers de búsqueda ───────────────────────────────────────────────────────

const projectIdsOf = async (companyId) => {
  const projects = await prisma.project.findMany({ where: { companyId }, select: { id: true } });
  return projects.map((p) => p.id);
};

const REQ_INCLUDE = {
  project: { select: { nombre: true } },
  solicitante: { select: { nombre: true } },
  items: true,
  quotation: {
    select: {
      estado: true,
      purchaseOrders: {
        select: { consecutivo: true, estado: true, montoTotal: true, fechaEntregaPactada: true, proveedor: { select: { nombre: true } } },
      },
    },
  },
};

// Busca UNA requisición por consecutivo (ej REQ-2026-003) o, si no, por material/proyecto.
const findRequisitionByRef = async (companyId, ref) => {
  const ids = await projectIdsOf(companyId);
  if (!ids.length) return null;
  const q = (ref || '').trim();

  let req = await prisma.requisition.findFirst({
    where: { projectId: { in: ids }, consecutivo: { contains: q, mode: 'insensitive' } },
    include: REQ_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  if (req) return req;

  return prisma.requisition.findFirst({
    where: {
      projectId: { in: ids },
      OR: [
        { items: { some: { descripcion: { contains: q, mode: 'insensitive' } } } },
        { project: { nombre: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: REQ_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
};

const findOrderByRef = async (companyId, ref) => {
  const ids = await projectIdsOf(companyId);
  if (!ids.length) return null;
  const q = (ref || '').trim();
  return prisma.purchaseOrder.findFirst({
    where: {
      quotation: { requisition: { projectId: { in: ids } } },
      OR: [
        { consecutivo: { contains: q, mode: 'insensitive' } },
        { proveedor: { nombre: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: {
      proveedor: { select: { nombre: true, whatsapp: true } },
      quotation: { include: { requisition: { select: { consecutivo: true, project: { select: { nombre: true } } } } } },
    },
    orderBy: { fechaEmision: 'desc' },
  });
};

// ── Herramientas (function calling) ──────────────────────────────────────────

const tools = [
  {
    type: 'function',
    function: {
      name: 'resumen_estado',
      description: 'Resumen general de compras: proyecto activo, requisiciones pendientes, cotizaciones en curso y órdenes activas.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_requisiciones',
      description: 'Lista las requisiciones activas de la empresa.',
      parameters: {
        type: 'object',
        properties: {
          soloPendientes: { type: 'boolean', description: 'true = solo las que esperan aprobación del director' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_requisicion',
      description: 'Estado detallado de UNA requisición. Acepta el consecutivo (ej REQ-2026-003) o una descripción de material/proyecto.',
      parameters: {
        type: 'object',
        properties: { referencia: { type: 'string', description: 'consecutivo o material/proyecto' } },
        required: ['referencia'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_orden',
      description: 'Estado de UNA orden de compra. Acepta el consecutivo (ej OC-2026-005) o el nombre del proveedor.',
      parameters: {
        type: 'object',
        properties: { referencia: { type: 'string' } },
        required: ['referencia'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'crear_requisicion',
      description: 'Crea una requisición de materiales/insumos para el proyecto activo. Úsalo cuando el usuario pide o necesita materiales.',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Materiales solicitados',
            items: {
              type: 'object',
              properties: {
                descripcion: { type: 'string' },
                cantidad: { type: 'number' },
                unidad: { type: 'string', description: 'ej: bulto, m3, UND, kg' },
              },
              required: ['descripcion'],
            },
          },
          prioridad: { type: 'string', enum: ['ALTA', 'MEDIA', 'BAJA'] },
        },
        required: ['items'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'aprobar_requisicion',
      description: 'Aprueba una requisición pendiente e inicia la cotización con proveedores. Solo director o apoyo de dirección.',
      parameters: {
        type: 'object',
        properties: { consecutivo: { type: 'string' } },
        required: ['consecutivo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rechazar_requisicion',
      description: 'Rechaza una requisición pendiente. Solo director o apoyo de dirección.',
      parameters: {
        type: 'object',
        properties: { consecutivo: { type: 'string' }, motivo: { type: 'string' } },
        required: ['consecutivo'],
      },
    },
  },
];

// ── Ejecutores ────────────────────────────────────────────────────────────────

const fmtReqDetail = (req) => {
  const itemLines = req.items
    .map((it) => `  • ${Number(it.cantidad)} ${it.unidad} ${it.descripcion}${it.enAPU ? '' : ' (fuera de APU)'}`)
    .join('\n');
  const oc = (req.quotation?.purchaseOrders || [])
    .map((o) => `  • ${o.consecutivo} (${o.estado}) ${fmt(o.montoTotal)} — ${o.proveedor?.nombre || '—'}${o.fechaEntregaPactada ? `, entrega ${new Date(o.fechaEntregaPactada).toLocaleDateString('es-CO')}` : ''}`)
    .join('\n');
  return (
    `Requisición ${req.consecutivo}\n` +
    `Estado: ${req.estado}\n` +
    `Proyecto: ${req.project?.nombre || '—'}\n` +
    `Solicitante: ${req.solicitante?.nombre || '—'}\n` +
    `Prioridad: ${req.prioridad}\n` +
    `Cotización: ${req.quotation?.estado || 'aún no inicia'}\n` +
    `Ítems:\n${itemLines || '  (sin ítems)'}` +
    (oc ? `\nÓrdenes de compra:\n${oc}` : '')
  );
};

const execTool = async (name, args, companyId, user) => {
  try {
    switch (name) {
      case 'resumen_estado':
        return await botContext.buildDbContext(companyId);

      case 'listar_requisiciones': {
        const ids = await projectIdsOf(companyId);
        const estados = args.soloPendientes
          ? ['ENVIADA', 'PENDIENTE_JUST']
          : ['ENVIADA', 'PENDIENTE_JUST', 'EN_COTIZACION', 'OC_EMITIDA'];
        const reqs = await prisma.requisition.findMany({
          where: { projectId: { in: ids }, estado: { in: estados } },
          include: { project: { select: { nombre: true } }, solicitante: { select: { nombre: true } } },
          orderBy: { createdAt: 'desc' },
          take: 15,
        });
        if (!reqs.length) return 'No hay requisiciones que coincidan.';
        return reqs
          .map((r) => `${r.consecutivo} — ${r.estado} — ${r.project.nombre} — solicita ${r.solicitante.nombre}`)
          .join('\n');
      }

      case 'consultar_requisicion': {
        const req = await findRequisitionByRef(companyId, args.referencia);
        if (!req) return `No encontré ninguna requisición que coincida con "${args.referencia}".`;
        return fmtReqDetail(req);
      }

      case 'consultar_orden': {
        const o = await findOrderByRef(companyId, args.referencia);
        if (!o) return `No encontré ninguna orden de compra que coincida con "${args.referencia}".`;
        return (
          `Orden ${o.consecutivo}\n` +
          `Estado: ${o.estado}\n` +
          `Proveedor: ${o.proveedor?.nombre || '—'}\n` +
          `Monto: ${fmt(o.montoTotal)}\n` +
          `Requisición: ${o.quotation?.requisition?.consecutivo || '—'} (${o.quotation?.requisition?.project?.nombre || '—'})\n` +
          (o.fechaEntregaPactada ? `Entrega pactada: ${new Date(o.fechaEntregaPactada).toLocaleDateString('es-CO')}\n` : '') +
          (o.fechaEntregaReal ? `Entregada el: ${new Date(o.fechaEntregaReal).toLocaleDateString('es-CO')}\n` : '')
        );
      }

      case 'crear_requisicion': {
        const result = await botContext.createRequisitionFromItems(companyId, user, args.items || [], args.prioridad || 'MEDIA');
        return result.message;
      }

      case 'aprobar_requisicion': {
        if (!ROLES_APRUEBAN.includes(user.rol)) return 'Solo el director o el apoyo de dirección pueden aprobar requisiciones.';
        const req = await findRequisitionByRef(companyId, args.consecutivo);
        if (!req) return `No encontré la requisición "${args.consecutivo}".`;
        await requisitionsService.approveRequisition(companyId, req.id, user.id);
        return `Requisición ${req.consecutivo} APROBADA. Se inició la búsqueda de proveedores; avisaré cuando lleguen cotizaciones.`;
      }

      case 'rechazar_requisicion': {
        if (!ROLES_APRUEBAN.includes(user.rol)) return 'Solo el director o el apoyo de dirección pueden rechazar requisiciones.';
        const req = await findRequisitionByRef(companyId, args.consecutivo);
        if (!req) return `No encontré la requisición "${args.consecutivo}".`;
        const motivo = args.motivo || 'Rechazada por el director vía WhatsApp';
        await requisitionsService.rejectRequisition(companyId, req.id, user.id, motivo);
        return `Requisición ${req.consecutivo} RECHAZADA. Motivo: ${motivo}`;
      }

      default:
        return `Herramienta desconocida: ${name}`;
    }
  } catch (err) {
    logger.error(`[bot.agent] Error en herramienta ${name}: ${err.message}`);
    return `Hubo un error ejecutando "${name}": ${err.message}`;
  }
};

// ── Bucle del agente ──────────────────────────────────────────────────────────

const runAgent = async (text, companyId, user) => {
  const groq = getGroq();
  const context = await botContext.buildDbContext(companyId);
  const hoy = new Date().toLocaleDateString('es-CO');
  const esDirector = ROLES_APRUEBAN.includes(user.rol);

  const system =
    `Eres el agente de compras de PROCURA AI para constructoras colombianas, operando por WhatsApp. Hoy es ${hoy}.\n` +
    `El usuario tiene rol ${user.rol}. ${esDirector ? 'Puede aprobar y rechazar requisiciones.' : 'NO puede aprobar ni rechazar (no es director).'}\n\n` +
    `Puedes ejecutar acciones reales usando las herramientas disponibles: crear requisiciones, consultar estado de requisiciones y órdenes, listar pendientes, y (si es director) aprobar/rechazar.\n` +
    `Reglas:\n` +
    `- Responde SIEMPRE en español, breve y claro, estilo WhatsApp, con *negrillas* para lo importante.\n` +
    `- Cuando el usuario pida o necesite materiales, usa crear_requisicion.\n` +
    `- Para consultar "en qué va" una requisición/orden, usa la herramienta de consulta y relata fielmente el resultado; NO inventes datos.\n` +
    `- Para aprobar/rechazar identifica la requisición por su consecutivo. Si el usuario no es director, explícale que no tiene permiso.\n` +
    `- Si te falta un dato esencial (ej. el consecutivo), pídelo en vez de adivinar.\n` +
    `- No prometas acciones que no realizaste con una herramienta.\n\n` +
    `DATOS ACTUALES DEL SISTEMA:\n${context}`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];

  for (let i = 0; i < 4; i++) {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 700,
    });
    const msg = completion.choices[0].message;

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || null;
    }

    messages.push(msg);
    for (const call of msg.tool_calls) {
      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(call.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }
      const result = await execTool(call.function.name, parsedArgs, companyId, user);
      messages.push({ role: 'tool', tool_call_id: call.id, content: String(result) });
    }
  }

  // Se agotaron las iteraciones de herramientas: pedir respuesta final sin tools.
  const final = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.2,
    max_tokens: 500,
  });
  return final.choices[0].message.content || null;
};

module.exports = { runAgent };
