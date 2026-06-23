const prisma = require('../../shared/db');
const { logger } = require('../../shared/utils/logger');

// Normalización para emparejar un insumo de APU con su básico compuesto.
// Quita acentos, separa letras de dígitos ("3000PSI" → "3000 psi"), elimina
// puntos de miles ("3.000" → "3000") y deja tokens comparables.
const STOPWORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'con']);
const matchTokens = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,](?=\d)/g, '')          // 3.000 → 3000
    .replace(/([a-z])(\d)/g, '$1 $2')    // psi3000 → psi 3000
    .replace(/(\d)([a-z])/g, '$1 $2')    // 3000psi → 3000 psi
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t && !STOPWORDS.has(t));

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

  // Ítems ya existentes del proyecto (para actualizar en vez de borrar+recrear).
  // Borrar y recrear rompía con llaves foráneas (requisiciones, historial de
  // precios) y generaba conflictos. Ahora se hace UPSERT por código: lo que ya
  // existe se actualiza, lo nuevo se crea, y nada se duplica.
  const existing = await prisma.itemAPU.findMany({
    where: { projectId: activeProject.id },
    select: { id: true, codigo: true, cantidad: true, saldoCantidad: true },
  });
  const existingByCode = new Map(existing.map((e) => [e.codigo, e]));

  let apuCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const it of apuDeduped) {
      const codigo         = String(it.codigo).trim().toUpperCase();
      const cantidad       = parseFloat(it.cantidad) || 0;
      const precioUnitario = parseFloat(it.precioUnitario) || 0;
      const base = {
        descripcion: String(it.descripcion).trim(),
        unidad:      String(it.unidad || 'UND').trim() || 'UND',
        capitulo:    it.capitulo ? String(it.capitulo).trim() : null,
        cantidad,
        precioUnitario,
      };

      const prev = existingByCode.get(codigo);
      // El saldo se reinicia a la nueva cantidad solo si el ítem es nuevo o no ha
      // tenido consumo (saldo == cantidad). Si ya hubo consumo, se preserva.
      const reiniciarSaldo = !prev || Number(prev.saldoCantidad) === Number(prev.cantidad);
      const saldo = reiniciarSaldo
        ? { saldoCantidad: cantidad, saldoValor: cantidad * precioUnitario }
        : {};

      let itemId;
      if (prev) {
        await tx.itemAPU.update({ where: { id: prev.id }, data: { ...base, ...saldo } });
        // Reemplazar insumos (RequisitionItem.itemApuInsumoId queda en null por SetNull)
        await tx.itemAPUInsumo.deleteMany({ where: { itemApuId: prev.id } });
        itemId = prev.id;
      } else {
        const created = await tx.itemAPU.create({
          data: { projectId: activeProject.id, codigo, ...base, saldoCantidad: cantidad, saldoValor: cantidad * precioUnitario },
        });
        itemId = created.id;
      }

      const ins = Array.isArray(it.insumos) ? it.insumos : [];
      if (ins.length > 0) {
        await tx.itemAPUInsumo.createMany({
          data: ins.map((x) => ({
            itemApuId:      itemId,
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
  }, { timeout: 60000 });

  // ── 2. BasicPrice: compuestos (BASICO-N) + simples (INS-NNN) ────────────────
  // Los compuestos traen `insumos` (su desglose); los marcamos y lo persistimos
  // en BasicPriceInsumo para poder requisicionar un sub-insumo (ej. cemento).
  const allBasics = new Map();
  for (const b of basicPrices) {
    const codigo = String(b.codigo || '').trim().toUpperCase();
    if (!codigo || !b.descripcion) continue;
    const desglose = Array.isArray(b.insumos) ? b.insumos : [];
    allBasics.set(codigo, {
      codigo,
      descripcion: String(b.descripcion).trim(),
      unidad: String(b.unidad || 'UND').trim() || 'UND',
      precioUnitario: parseFloat(b.precioUnitario) || 0,
      fuente: b.fuente || 'BASICO',
      esCompuesto: desglose.length > 0,
      desglose,
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
      esCompuesto: false,
      desglose: [],
    });
  }
  const basicsList = [...allBasics.values()];

  if (basicsList.length > 0) {
    const saved = await prisma.$transaction(
      basicsList.map((b) =>
        prisma.basicPrice.upsert({
          where: { companyId_codigo: { companyId, codigo: b.codigo } },
          update: { descripcion: b.descripcion, unidad: b.unidad, precioUnitario: b.precioUnitario, fuente: b.fuente, esCompuesto: b.esCompuesto },
          create: { companyId, codigo: b.codigo, descripcion: b.descripcion, unidad: b.unidad, precioUnitario: b.precioUnitario, fuente: b.fuente, esCompuesto: b.esCompuesto },
          select: { id: true, codigo: true },
        })
      ),
      { timeout: 30000 }
    );
    const idByCode = new Map(saved.map((s) => [s.codigo, s.id]));

    // Desglose de los compuestos → BasicPriceInsumo (reemplazo completo)
    const compuestos = basicsList.filter((b) => b.esCompuesto);
    for (const b of compuestos) {
      const basicPriceId = idByCode.get(b.codigo);
      if (!basicPriceId) continue;
      await prisma.basicPriceInsumo.deleteMany({ where: { basicPriceId } });
      await prisma.basicPriceInsumo.createMany({
        data: b.desglose.map((x) => ({
          basicPriceId,
          tipo:           String(x.tipo || 'MATERIAL').toUpperCase(),
          descripcion:    String(x.descripcion || '').trim(),
          unidad:         String(x.unidad || 'UND').trim() || 'UND',
          rendimiento:    parseFloat(x.rendimiento)    || 0,
          precioUnitario: parseFloat(x.precioUnitario) || 0,
          precioTotal:    parseFloat(x.precioTotal)    || 0,
        })).filter((x) => x.descripcion),
      });
    }
  }

  // ── 3. Vincular insumos de APU con su básico compuesto (match difuso) ───────
  // Ej.: el insumo "CONCRETO 3.000 PSI" de un APU se vincula al básico
  // "CONCRETO de 3.000 PSI", para poder desglosarlo al requisicionar.
  const linkResult = await linkApuInsumosToBasics(companyId, activeProject.id);

  logger.info(
    `[masterimport] Guardado: ${apuCount} APU, ${basicsList.length} básicos, ` +
    `${linkResult.linked} insumos vinculados a compuestos (proyecto ${activeProject.nombre})`
  );

  return {
    proyecto: activeProject.nombre,
    counts: {
      apu: apuCount,
      basicos: basicsList.length,
      insumosVinculados: linkResult.linked,
    },
  };
};

// Empareja cada ItemAPUInsumo del proyecto con un BasicPrice compuesto de la
// empresa cuando todos los tokens del compuesto están en el insumo.
const linkApuInsumosToBasics = async (companyId, projectId) => {
  const compuestos = await prisma.basicPrice.findMany({
    where: { companyId, esCompuesto: true },
    select: { id: true, descripcion: true },
  });
  if (compuestos.length === 0) return { linked: 0 };

  const compTok = compuestos.map((c) => ({
    id: c.id,
    tokens: matchTokens(c.descripcion),
  })).filter((c) => c.tokens.length > 0);

  const projInsumos = await prisma.itemAPUInsumo.findMany({
    where: { itemAPU: { projectId } },
    select: { id: true, descripcion: true },
  });

  // matchesByBasic: basicPriceId → [insumoIds]
  const matchesByBasic = new Map();
  for (const ins of projInsumos) {
    const tks = new Set(matchTokens(ins.descripcion));
    if (tks.size === 0) continue;
    const hit = compTok.find((c) => c.tokens.every((t) => tks.has(t)));
    if (!hit) continue;
    if (!matchesByBasic.has(hit.id)) matchesByBasic.set(hit.id, []);
    matchesByBasic.get(hit.id).push(ins.id);
  }

  let linked = 0;
  for (const [basicPriceId, ids] of matchesByBasic) {
    const res = await prisma.itemAPUInsumo.updateMany({
      where: { id: { in: ids } },
      data: { basicPriceId },
    });
    linked += res.count;
  }
  return { linked };
};

module.exports = { confirmImport, matchTokens };
