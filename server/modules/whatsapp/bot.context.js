const prisma = require('../../shared/db');
const { logger } = require('../../shared/utils/logger');

const fmt = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(n) || 0);

// ── Respuestas por comando exacto ──────────────────────────────────────────

const handleCommand = async (t, companyId) => {
  if (t === 'ayuda' || t === 'help' || t === '?') {
    return (
      '*PROCURA AI Bot* 🤖\n\n' +
      'Puedes escribirme en lenguaje natural o usar comandos:\n' +
      '• *proyectos* — Lista de proyectos\n' +
      '• *presupuesto* — Resumen del proyecto activo\n' +
      '• *apu <código>* — Detalle de un ítem APU\n' +
      '• *apus* — Primeros ítems APU\n' +
      '• *básicos* — Precios básicos\n' +
      '• *estado* — Estado general\n' +
      '• *ayuda* — Este menú'
    );
  }

  if (t === 'proyectos' || t.includes('cuántos proyecto') || t.includes('cuantos proyecto') || t === 'listar proyectos') {
    const projects = await prisma.project.findMany({
      where: { companyId },
      select: { nombre: true, estado: true, activo: true, contratoNo: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!projects.length) return 'No hay proyectos registrados.';
    const lines = projects.map(
      (p) => `${p.activo ? '🟢' : '⚪'} *${p.nombre}* (${p.contratoNo}) — ${p.estado.replace(/_/g, ' ')}`
    );
    return `*Proyectos (${projects.length})*\n\n${lines.join('\n')}`;
  }

  if (t === 'presupuesto' || t.includes('presupuesto del proyecto') || t.includes('ver presupuesto')) {
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

  if (t === 'apus' || t === 'lista apu' || t === 'listar apu') {
    const items = await prisma.itemAPU.findMany({
      where: { project: { companyId, activo: true } },
      orderBy: { codigo: 'asc' },
      take: 10,
    });
    if (!items.length) return 'No hay ítems APU en el proyecto activo.';
    const lines = items.map(
      (i) => `• *${i.codigo}* ${i.descripcion} — ${i.unidad} @ ${fmt(i.precioUnitario)}`
    );
    return `*Ítems APU (primeros 10)*\n\n${lines.join('\n')}\n\n_Escribe "apu <código>" para ver detalle._`;
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
      `🔢 Cantidad: ${item.cantidad}\n` +
      `💲 P.Unitario: ${fmt(item.precioUnitario)}\n` +
      `💰 Valor total: ${fmt(Number(item.cantidad) * Number(item.precioUnitario))}\n` +
      `📊 Saldo: ${fmt(item.saldoValor)}`
    );
  }

  if (t === 'básicos' || t === 'basicos' || t === 'precios basicos' || t === 'precios básicos') {
    const items = await prisma.basicPrice.findMany({
      where: { companyId },
      orderBy: { codigo: 'asc' },
      take: 10,
    });
    if (!items.length) return 'No hay precios básicos registrados.';
    const lines = items.map(
      (b) => `• *${b.codigo}* ${b.descripcion} — ${b.unidad} @ ${fmt(b.precioUnitario)}`
    );
    return `*Precios Básicos (primeros 10)*\n\n${lines.join('\n')}`;
  }

  if (t === 'estado') {
    const [totalProyectos, reqPendientes, ocActivas] = await Promise.all([
      prisma.project.count({ where: { companyId } }),
      prisma.requisition.count({ where: { project: { companyId }, estado: { in: ['ENVIADA', 'EN_COTIZACION'] } } }),
      prisma.purchaseOrder.count({
        where: { estado: { in: ['EMITIDA', 'ENVIADA'] }, quotation: { requisition: { project: { companyId } } } },
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
      `📋 Req. pendientes: ${reqPendientes}\n` +
      `📦 OC activas: ${ocActivas}`
    );
  }

  return null;
};

// ── Contexto para Groq ─────────────────────────────────────────────────────

const buildDbContext = async (companyId) => {
  const [company, activeProject, reqPendientes, ocActivas, ultimasOC] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { razonSocial: true } }),
    prisma.project.findFirst({
      where: { companyId, activo: true },
      include: { itemsAPU: { select: { cantidad: true, precioUnitario: true, saldoValor: true } } },
    }),
    prisma.requisition.count({ where: { project: { companyId }, estado: { in: ['ENVIADA', 'EN_COTIZACION'] } } }),
    prisma.purchaseOrder.count({
      where: { estado: { in: ['EMITIDA', 'ENVIADA'] }, quotation: { requisition: { project: { companyId } } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { quotation: { requisition: { project: { companyId } } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { consecutivo: true, estado: true, montoTotal: true, fechaEntregaPactada: true },
    }),
  ]);

  let presupuestoInfo = 'Sin proyecto activo.';
  if (activeProject) {
    const total = activeProject.itemsAPU.reduce((a, i) => a + Number(i.cantidad) * Number(i.precioUnitario), 0);
    const saldo = activeProject.itemsAPU.reduce((a, i) => a + Number(i.saldoValor), 0);
    const pct = total > 0 ? Math.round(((total - saldo) / total) * 100) : 0;
    presupuestoInfo = `Proyecto: ${activeProject.nombre} | Presupuesto total: ${fmt(total)} | Ejecutado: ${pct}% | Saldo: ${fmt(saldo)} | Ítems APU: ${activeProject.itemsAPU.length}`;
  }

  const ocInfo = ultimasOC.map(
    (o) => `${o.consecutivo} ${o.estado} ${fmt(o.montoTotal)}${o.fechaEntregaPactada ? ` entrega ${new Date(o.fechaEntregaPactada).toLocaleDateString('es-CO')}` : ''}`
  ).join('; ') || 'Sin OC recientes.';

  return `Empresa: ${company?.razonSocial || 'INGCISOL'}
${presupuestoInfo}
Requisiciones pendientes: ${reqPendientes}
OC activas: ${ocActivas}
Últimas OC: ${ocInfo}`;
};

// ── Fallback IA ────────────────────────────────────────────────────────────

const groqFallback = async (text, companyId) => {
  try {
    const { getGroq } = require('../../shared/utils/groq');
    const groq = getGroq();
    const context = await buildDbContext(companyId);

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `Eres el asistente de PROCURA AI, sistema de gestión de compras y licitaciones para constructoras colombianas.
Responde en español, de forma concisa (máximo 3 párrafos cortos), usando *negrillas* para énfasis en WhatsApp.
Solo responde sobre temas relacionados con compras, presupuestos, requisiciones, órdenes de compra y proyectos de construcción.
Si no tienes la información exacta, dilo claramente.

DATOS ACTUALES DEL SISTEMA:
${context}`,
        },
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

// ── Entrada principal ──────────────────────────────────────────────────────

const buildResponse = async (text, companyId) => {
  const t = text.toLowerCase().trim();
  const commandResult = await handleCommand(t, companyId);
  if (commandResult !== null) return commandResult;
  return groqFallback(text, companyId);
};

module.exports = { buildResponse };
