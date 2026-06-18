const prisma = require('../../shared/db');
const { logger } = require('../../shared/utils/logger');

// Guarda TODO lo importado: ItemAPU + insumos, BasicPrice (compuestos + simples)
// payload = { apuItems[], basicPrices[], insumos[] }  (ya parseado/editado en el front)
const confirmImport = async (companyId, payload) => {
  const activeProject = await prisma.project.findFirst({ where: { companyId, activo: true } });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  const apuItems    = Array.isArray(payload.apuItems)    ? payload.apuItems    : [];
  const basicPrices = Array.isArray(payload.basicPrices) ? payload.basicPrices : [];
  const insumos     = Array.isArray(payload.insumos)     ? payload.insumos     : [];

  // ── 1. ItemAPU + insumos ───────────────────────────────────────────────────
  // Deduplicar por código (gana el último)
  const apuSeen = new Map();
  for (const it of apuItems) {
    const codigo = String(it.codigo || '').trim().toUpperCase();
    const descripcion = String(it.descripcion || '').trim();
    if (!codigo || !descripcion) continue;
    apuSeen.set(codigo, it);
  }
  const apuDeduped = [...apuSeen.values()];

  let apuCount = 0;
  await prisma.$transaction(async (tx) => {
    // Borra ítems anteriores del proyecto (insumos caen en cascada)
    await tx.itemAPU.deleteMany({ where: { projectId: activeProject.id } });

    for (const it of apuDeduped) {
      const cantidad       = parseFloat(it.cantidad) || 0;
      const precioUnitario = parseFloat(it.precioUnitario) || 0;
      const created = await tx.itemAPU.create({
        data: {
          projectId:     activeProject.id,
          codigo:        String(it.codigo).trim().toUpperCase(),
          descripcion:   String(it.descripcion).trim(),
          unidad:        String(it.unidad || 'UND').trim() || 'UND',
          capitulo:      it.capitulo ? String(it.capitulo).trim() : null,
          cantidad,
          precioUnitario,
          saldoCantidad: cantidad,
          saldoValor:    cantidad * precioUnitario,
        },
      });
      const ins = Array.isArray(it.insumos) ? it.insumos : [];
      if (ins.length > 0) {
        await tx.itemAPUInsumo.createMany({
          data: ins.map((x) => ({
            itemApuId:      created.id,
            tipo:           String(x.tipo || 'MATERIAL').toUpperCase(),
            descripcion:    String(x.descripcion || '').trim(),
            unidad:         String(x.unidad || 'UND').trim() || 'UND',
            rendimiento:    parseFloat(x.rendimiento)    || 0,
            precioUnitario: parseFloat(x.precioUnitario) || 0,
            precioTotal:    parseFloat(x.precioTotal)    || 0,
          })),
        });
      }
      apuCount += 1;
    }
  }, { timeout: 30000 });

  // ── 2. BasicPrice: compuestos (BASICO-N) + simples (INS-NNN) ────────────────
  const allBasics = new Map();
  for (const b of basicPrices) {
    const codigo = String(b.codigo || '').trim().toUpperCase();
    if (!codigo || !b.descripcion) continue;
    allBasics.set(codigo, {
      codigo,
      descripcion: String(b.descripcion).trim(),
      unidad: String(b.unidad || 'UND').trim() || 'UND',
      precioUnitario: parseFloat(b.precioUnitario) || 0,
      fuente: b.fuente || 'BASICO',
    });
  }
  for (const i of insumos) {
    const codigo = String(i.codigo || '').trim().toUpperCase();
    if (!codigo || !i.descripcion) continue;
    allBasics.set(codigo, {
      codigo,
      descripcion: String(i.descripcion).trim(),
      unidad: String(i.unidad || 'UND').trim() || 'UND',
      precioUnitario: parseFloat(i.precioUnitario) || 0,
      fuente: i.fuente || 'INSUMO',
    });
  }
  const basicsList = [...allBasics.values()];

  if (basicsList.length > 0) {
    await prisma.$transaction(
      basicsList.map((b) =>
        prisma.basicPrice.upsert({
          where: { companyId_codigo: { companyId, codigo: b.codigo } },
          update: { descripcion: b.descripcion, unidad: b.unidad, precioUnitario: b.precioUnitario, fuente: b.fuente },
          create: { companyId, codigo: b.codigo, descripcion: b.descripcion, unidad: b.unidad, precioUnitario: b.precioUnitario, fuente: b.fuente },
        })
      ),
      { timeout: 30000 }
    );
  }

  logger.info(`[masterimport] Guardado: ${apuCount} APU, ${basicsList.length} precios básicos (proyecto ${activeProject.nombre})`);

  return {
    proyecto: activeProject.nombre,
    counts: {
      apu: apuCount,
      basicos: basicsList.length,
    },
  };
};

module.exports = { confirmImport };
