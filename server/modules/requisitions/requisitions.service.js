const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const notifications = require('../notifications/notifications.service');
const { publishCommand } = require('../whatsapp/bot.ipc');

const generateConsecutivo = async (projectId) => {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const year = new Date().getFullYear();
  const count = await prisma.requisition.count({
    where: { projectId, consecutivo: { startsWith: `REQ-${year}` } },
  });
  const projCode = project.contratoNo.split('-').pop() || 'PROY';
  return `REQ-${year}-${String(count + 1).padStart(3, '0')}-${projCode}`;
};

const listRequisitions = async (companyId, filters = {}) => {
  const { estado, projectId, solicitanteId } = filters;

  const projects = await prisma.project.findMany({
    where: { companyId },
    select: { id: true },
  });
  const projectIds = projects.map((p) => p.id);

  const where = { projectId: { in: projectIds } };
  // estado acepta valor único o lista separada por comas (ej: "ENVIADA,PENDIENTE_JUST")
  if (estado) {
    const estados = String(estado).split(',').map((e) => e.trim()).filter(Boolean);
    where.estado = estados.length > 1 ? { in: estados } : estados[0];
  }
  if (projectId) where.projectId = projectId;
  if (solicitanteId) where.solicitanteId = solicitanteId;

  return prisma.requisition.findMany({
    where,
    include: {
      project: { select: { nombre: true, contratoNo: true } },
      solicitante: { select: { nombre: true, rol: true } },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

const getRequisition = async (companyId, requisitionId) => {
  const req = await prisma.requisition.findUnique({
    where: { id: requisitionId },
    include: {
      project: { select: { companyId: true, nombre: true, contratoNo: true } },
      solicitante: { select: { nombre: true, rol: true, email: true } },
      aprobador: { select: { nombre: true, rol: true } },
      items: { include: { itemAPU: true, itemAPUInsumo: { include: { itemAPU: true } } } },
      quotation: { include: { items: { include: { supplier: true, itemAPU: true } } } },
    },
  });
  if (!req || req.project.companyId !== companyId) {
    throw Object.assign(new Error('Requisición no encontrada'), { statusCode: 404 });
  }
  return req;
};

const createRequisition = async (companyId, userId, data) => {
  const { projectId, items, prioridad, fechaLimite, canal } = data;

  const project = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });

  // Verifica qué ítems están en el APU — acepta tanto código como ID directo
  const apuCodes = (items || []).map((i) => i.codigo).filter(Boolean);
  const apuItems = apuCodes.length
    ? await prisma.itemAPU.findMany({ where: { projectId, codigo: { in: apuCodes } } })
    : [];
  const apuMapByCodigo = Object.fromEntries(apuItems.map((a) => [a.codigo, a]));

  const allInAPU = items.every((i) => i.itemApuId || (!i.codigo || apuMapByCodigo[i.codigo]));
  const estado = allInAPU ? 'ENVIADA' : 'PENDIENTE_JUST';

  const consecutivo = await generateConsecutivo(projectId);

  const requisition = await prisma.requisition.create({
    data: {
      consecutivo,
      projectId,
      solicitanteId: userId,
      canal: canal || 'APP',
      estado,
      prioridad: prioridad || 'MEDIA',
      fechaLimite: fechaLimite ? new Date(fechaLimite) : null,
      items: {
        create: items.map((item) => {
          const resolvedApuId = item.itemApuId || apuMapByCodigo[item.codigo]?.id || null;
          return {
            descripcion:     item.descripcion,
            cantidad:        parseFloat(item.cantidad) || 1,
            unidad:          item.unidad || 'GL',
            itemApuId:       resolvedApuId,
            itemApuInsumoId: item.itemApuInsumoId || null,
            enAPU:           !!resolvedApuId,
          };
        }),
      },
    },
    include: { items: true },
  });

  // Notificación in-app a quienes aprueban
  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR'], {
    tipo: 'REQUISICION_CREADA',
    titulo: `Nueva requisición ${consecutivo}`,
    mensaje: `${items.length} ítem(s) en ${project.nombre} — pendiente de aprobación`,
    entidad: 'Requisition',
    entidadId: requisition.id,
    excludeUserId: userId,
  });

  return requisition;
};

// Análisis del agente: compara los ítems de la requisición contra el presupuesto APU
const analyzeRequisitionBudget = async (companyId, requisitionId) => {
  const req = await getRequisition(companyId, requisitionId);

  const items = req.items.map((item) => {
    const cantidad = Number(item.cantidad);

    // Caso A: ítem ligado a un INSUMO específico de un APU
    if (item.itemAPUInsumo) {
      const ins = item.itemAPUInsumo;
      const apu = ins.itemAPU;
      const precioUnitario = Number(ins.precioUnitario);
      return {
        id: item.id,
        descripcion: item.descripcion,
        cantidad,
        unidad: item.unidad,
        codigoAPU: apu?.codigo || null,
        tipoInsumo: ins.tipo,
        precioUnitario,
        valorEstimado: cantidad * precioUnitario,
        veredicto: 'DENTRO_PRESUPUESTO',
        detalle: `Insumo del APU ${apu?.codigo || ''} (${ins.tipo.replace(/_/g, ' ')}). Precio ref.: $${precioUnitario.toLocaleString('es-CO')}.`,
      };
    }

    // Caso B: ítem ligado a un APU completo
    if (item.itemAPU) {
      const saldoCantidad = Number(item.itemAPU.saldoCantidad);
      const precioUnitario = Number(item.itemAPU.precioUnitario);
      const valorEstimado = cantidad * precioUnitario;
      const saldoValor = Number(item.itemAPU.saldoValor);
      const excede = cantidad > saldoCantidad;
      return {
        id: item.id,
        descripcion: item.descripcion,
        cantidad,
        unidad: item.unidad,
        codigoAPU: item.itemAPU.codigo,
        saldoCantidad,
        precioUnitario,
        valorEstimado,
        saldoValor,
        veredicto: excede ? 'EXCEDE_SALDO' : 'DENTRO_PRESUPUESTO',
        detalle: excede
          ? `Solicita ${cantidad} ${item.unidad} pero el saldo APU es ${saldoCantidad}. Excede en ${(cantidad - saldoCantidad).toFixed(2)}.`
          : `Dentro del saldo APU (${saldoCantidad} ${item.unidad} disponibles).`,
      };
    }

    // Caso C: ítem libre, fuera del APU
    return {
      id: item.id,
      descripcion: item.descripcion,
      cantidad,
      unidad: item.unidad,
      veredicto: 'FUERA_APU',
      detalle: 'No corresponde a ningún ítem del presupuesto APU. Requiere justificación.',
    };
  });

  const fueraAPU = items.filter((i) => i.veredicto === 'FUERA_APU').length;
  const excedidos = items.filter((i) => i.veredicto === 'EXCEDE_SALDO').length;
  const conforme = fueraAPU === 0 && excedidos === 0;

  return {
    requisitionId,
    consecutivo: req.consecutivo,
    estado: req.estado,
    conforme,
    resumen: conforme
      ? 'Todos los insumos están de acuerdo al presupuesto APU del proyecto.'
      : `${excedidos} ítem(s) exceden el saldo y ${fueraAPU} ítem(s) están fuera del APU.`,
    items,
  };
};

const approveRequisition = async (companyId, requisitionId, approverId) => {
  const req = await getRequisition(companyId, requisitionId);
  if (!['ENVIADA', 'PENDIENTE_JUST'].includes(req.estado)) {
    throw Object.assign(
      new Error(`No se puede aprobar una requisición en estado ${req.estado}`),
      { statusCode: 400 }
    );
  }

  // Al aprobar se inicia el proceso de cotización: la requisición pasa a
  // EN_COTIZACION y se crea la cotización en estado EN_BUSQUEDA
  const [updated] = await prisma.$transaction([
    prisma.requisition.update({
      where: { id: requisitionId },
      data: { estado: 'EN_COTIZACION', aprobadorId: approverId },
    }),
    prisma.quotation.create({
      data: { requisitionId, estado: 'EN_BUSQUEDA' },
    }),
    prisma.auditLog.create({
      data: {
        companyId,
        userId: approverId,
        accion: 'APROBAR_REQUISICION',
        entidad: 'Requisition',
        entidadId: requisitionId,
        metadata: { consecutivo: req.consecutivo },
      },
    }),
  ]);

  await notifications.notifyUser(companyId, req.solicitanteId, {
    tipo: 'REQUISICION_APROBADA',
    titulo: `Requisición ${req.consecutivo} aprobada`,
    mensaje: 'Se inició el proceso de cotización (en búsqueda de proveedores).',
    entidad: 'Requisition',
    entidadId: requisitionId,
  });
  await notifications.notifyRoles(companyId, ['DIRECTOR', 'APOYO_DIRECTOR'], {
    tipo: 'COTIZACION_INICIADA',
    titulo: `Cotización iniciada — ${req.consecutivo}`,
    mensaje: 'La requisición aprobada entró en proceso de cotización.',
    entidad: 'Requisition',
    entidadId: requisitionId,
    excludeUserId: approverId,
  });

  // Publicar al worker para que envíe WhatsApp a proveedores
  const quotation = await prisma.quotation.findUnique({
    where: { requisitionId },
    select: { id: true },
  });
  if (quotation) {
    await publishCommand(redis, 'send_quote_requests', {
      companyId,
      quotationId: quotation.id,
    }).catch(() => {}); // no bloquear si Redis no disponible
  }

  return updated;
};

const rejectRequisition = async (companyId, requisitionId, approverId, motivo) => {
  const req = await getRequisition(companyId, requisitionId);
  if (!['ENVIADA', 'PENDIENTE_JUST', 'APROBADA'].includes(req.estado)) {
    throw Object.assign(new Error(`No se puede rechazar en estado ${req.estado}`), { statusCode: 400 });
  }

  const updated = await prisma.requisition.update({
    where: { id: requisitionId },
    data: { estado: 'RECHAZADA', aprobadorId: approverId, motivoRechazo: motivo },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: approverId,
      accion: 'RECHAZAR_REQUISICION',
      entidad: 'Requisition',
      entidadId: requisitionId,
      metadata: { consecutivo: req.consecutivo, motivo },
    },
  });

  await notifications.notifyUser(companyId, req.solicitanteId, {
    tipo: 'REQUISICION_RECHAZADA',
    titulo: `Requisición ${req.consecutivo} rechazada`,
    mensaje: motivo ? `Motivo: ${motivo}` : null,
    entidad: 'Requisition',
    entidadId: requisitionId,
  });

  return updated;
};

module.exports = {
  listRequisitions,
  getRequisition,
  createRequisition,
  approveRequisition,
  rejectRequisition,
  analyzeRequisitionBudget,
};
