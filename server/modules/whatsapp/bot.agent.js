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
      name: 'listar_proyectos',
      description: 'Lista todos los proyectos de la empresa con su estado, contrato y ciudad. Úsalo cuando pregunten por el estado de los proyectos.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_presupuesto',
      description: 'Presupuesto del proyecto activo: total, ejecutado, saldo. Con codigoApu devuelve el detalle/saldo de un ítem puntual.',
      parameters: {
        type: 'object',
        properties: {
          codigoApu: { type: 'string', description: 'código del ítem APU (ej. 1.2.3) si preguntan por un ítem específico' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_proveedores',
      description: 'Lista los proveedores registrados. Con busqueda filtra por nombre.',
      parameters: {
        type: 'object',
        properties: { busqueda: { type: 'string', description: 'nombre o parte del nombre del proveedor' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_ordenes',
      description: 'Lista las órdenes de compra activas (emitidas, enviadas o entregadas) con proveedor, monto y fecha de entrega.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_cotizaciones',
      description: 'Lista las cotizaciones en curso y cuántos proveedores han respondido cada una.',
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

      case 'listar_proyectos':
        return await botContext.fetchProjects(companyId);

      case 'resumen_presupuesto':
        return args.codigoApu
          ? await botContext.fetchApuDetail(companyId, args.codigoApu)
          : await botContext.fetchBudgetSummary(companyId);

      case 'listar_proveedores':
        return await botContext.fetchSuppliers(companyId, args.busqueda || null);

      case 'listar_ordenes':
        return await botContext.fetchOrders(companyId);

      case 'listar_cotizaciones':
        return await botContext.fetchQuotes(companyId);

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
    `Eres PROCURA AI, el asistente de compras de una constructora colombiana. Hablas por WhatsApp. Hoy es ${hoy}.\n` +
    `El usuario tiene rol ${user.rol}. ${esDirector ? 'Puede aprobar y rechazar requisiciones.' : 'NO puede aprobar ni rechazar (no es director).'}\n\n` +
    `Tienes herramientas REALES: consultar proyectos, presupuesto y saldos, proveedores, requisiciones, cotizaciones y órdenes; crear requisiciones; y (si es director) aprobar/rechazar. Úsalas siempre que la pregunta toque datos del sistema.\n\n` +
    `Estilo:\n` +
    `- Español colombiano cercano y natural, como un colega eficiente: "listo", "de una", "te cuento". Nunca robótico.\n` +
    `- Mensajes cortos, estilo WhatsApp: frases directas, *negrillas* para lo importante, emojis con moderación (máximo 1-2).\n` +
    `- PROHIBIDO responder con menús de comandos o listas de "opciones disponibles". Responde la pregunta y ya.\n` +
    `- Si la pregunta es ambigua o falta un dato esencial (ej. el consecutivo), pregunta conversacionalmente, no con formularios.\n\n` +
    `Reglas de fondo:\n` +
    `- NUNCA inventes cifras, estados ni nombres: solo lo que devuelvan las herramientas o los DATOS del sistema.\n` +
    `- Cuando el usuario pida o necesite materiales ("necesito 50 bultos de cemento"), usa crear_requisicion.\n` +
    `- Para "cómo van mis proyectos" usa listar_proyectos; para saldos usa resumen_presupuesto (con codigoApu si es un ítem puntual).\n` +
    `- Si el usuario no es director y pide aprobar/rechazar, explícale con amabilidad que eso le corresponde al director.\n` +
    `- No prometas acciones que no realizaste con una herramienta.\n` +
    `- Solo hablas de compras, presupuestos, requisiciones, cotizaciones, órdenes, proveedores y proyectos. Si preguntan otra cosa, redirige con humor ligero.\n\n` +
    `CONOCIMIENTO DEL PRODUCTO (Documento Unificado PROCURA AI, jul-2026). Úsalo para explicar el proceso, orientar sobre "qué sigue" y responder dudas de funcionamiento:\n` +
    `- PROCURA AI automatiza el ciclo completo de compras de obra: requisición → validación contra presupuesto APU → cotización → comparativo → orden de compra → pago y entrega → cierre. Es SEMI-autónomo: nunca decide solo cuando hay dinero de por medio.\n` +
    `- Hay 3 puntos de control humano: (1) el director aprueba la requisición, (2) el director elige el proveedor ganador tras el cuadro comparativo (mínimo 3 cotizaciones), (3) el director autoriza el envío de la orden de compra. Todo lo demás corre automático.\n` +
    `- Roles: DIRECTOR aprueba todo; APOYO_DIRECTOR aprueba dentro de su tope; RESIDENTE y ALMACENISTA solicitan materiales por WhatsApp (el almacenista además confirma que el material llegó); CONTADOR paga la OC y sube el soporte; el PROVEEDOR es externo (cotiza y confirma entrega por WhatsApp, sin acceso al sistema).\n` +
    `- Flujo de una requisición: el solicitante pide materiales (consecutivo REQ-AAAA-NNN); se valida cada ítem contra el presupuesto APU (si no está, queda pendiente de justificación y se avisa al director); el director aprueba → se cotiza con proveedores; con el comparativo (precio, % de variación vs presupuesto, impuestos DIAN: IVA, retefuente, reteICA) el director adjudica; se emite la OC (OC-AAAA-NNN) con PDF, se debita el presupuesto del ítem al instante y se envía al proveedor por WhatsApp y correo.\n` +
    `- Seguimiento de entrega: semáforo (verde ≥5 días, amarillo 1-4, rojo vencida) con alerta 48h antes de la fecha pactada; si no llega, se escala al director. El almacenista cierra el ciclo confirmando la entrega.\n` +
    `- Cada compra pagada alimenta el historial de precios reales de la empresa (memoria institucional): la próxima cotización del mismo ítem parte de ese historial antes de buscar afuera.\n` +
    `- Si un precio cotizado supera lo presupuestado, se resalta la variación pero NO se bloquea: el director decide con la información a la vista. Si una OC supera el saldo del ítem, la alerta sí es bloqueante y exige confirmación del director.\n\n` +
    `DATOS ACTUALES DEL SISTEMA:\n${context}`;

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ];

  for (let i = 0; i < 5; i++) {
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
    max_tokens: 700,
  });
  return final.choices[0].message.content || null;
};

module.exports = { runAgent };
