const prisma = require('../../shared/db');

const getAPUTree = async (companyId) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  const items = await prisma.itemAPU.findMany({
    where: { projectId: activeProject.id },
    include: {
      insumos: {
        orderBy: { createdAt: 'asc' },
        // Si el insumo es un básico compuesto (ej. concreto), traemos su desglose
        // (cemento, arena, gravilla) para poder requisicionar un sub-insumo.
        include: {
          basicPrice: {
            select: {
              id: true, descripcion: true, unidad: true, precioUnitario: true,
              insumos: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      },
    },
  });

  // Usar capitulo guardado, o inferir del primer segmento del código
  const tree = {};
  for (const item of items) {
    const chapter = item.capitulo || item.codigo.split('.')[0];
    if (!tree[chapter]) tree[chapter] = { capitulo: chapter, items: [] };
    tree[chapter].items.push(item);
  }

  // Orden natural (numérico) de códigos: "1.2" < "1.10" < "2.1"
  const natKey = (s) => String(s || '').split(/[.\-/\s]+/).map((p) => {
    const n = parseInt(p, 10);
    return Number.isNaN(n) ? p : n;
  });
  const cmpNat = (a, b) => {
    const ka = natKey(a), kb = natKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i], y = kb[i];
      if (x === undefined) return -1;
      if (y === undefined) return 1;
      if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x - y; }
      else { const s = String(x).localeCompare(String(y)); if (s !== 0) return s; }
    }
    return 0;
  };
  // Número de capítulo a partir de su etiqueta ("1. PRELIMINARES" → 1)
  const chapterNum = (label) => {
    const m = String(label || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
  };

  // Ordenar ítems dentro de cada capítulo y capítulos del 1 al final
  const ordered = Object.values(tree).sort((a, b) => {
    const d = chapterNum(a.capitulo) - chapterNum(b.capitulo);
    return d !== 0 ? d : String(a.capitulo).localeCompare(String(b.capitulo));
  });
  for (const ch of ordered) ch.items.sort((a, b) => cmpNat(a.codigo, b.codigo));

  return { project: activeProject, tree: ordered };
};

const getItem = async (companyId, itemId) => {
  const item = await prisma.itemAPU.findUnique({
    where: { id: itemId },
    include: {
      project:     { select: { companyId: true, nombre: true } },
      insumos:     { orderBy: { createdAt: 'asc' } },
      priceHistory: { include: { supplier: true }, orderBy: { fecha: 'desc' }, take: 10 },
    },
  });
  if (!item || item.project.companyId !== companyId) {
    throw Object.assign(new Error('Ítem APU no encontrado'), { statusCode: 404 });
  }
  return item;
};

const createItem = async (companyId, data) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  const codigo      = String(data.codigo      || '').trim();
  const descripcion = String(data.descripcion || '').trim();
  if (!codigo || !descripcion) {
    throw Object.assign(new Error('Código y descripción son requeridos'), { statusCode: 400 });
  }

  const existing = await prisma.itemAPU.findUnique({
    where: { projectId_codigo: { projectId: activeProject.id, codigo } },
  });
  if (existing) {
    throw Object.assign(
      new Error(`Ya existe un ítem APU con el código ${codigo} en este proyecto`),
      { statusCode: 409 }
    );
  }

  const cantidad       = parseFloat(data.cantidad)       || 0;
  const precioUnitario = parseFloat(data.precioUnitario) || 0;

  return prisma.itemAPU.create({
    data: {
      projectId: activeProject.id,
      codigo,
      descripcion,
      unidad:        String(data.unidad || 'GL').trim() || 'GL',
      capitulo:      data.capitulo || null,
      cantidad,
      precioUnitario,
      saldoCantidad: cantidad,
      saldoValor:    cantidad * precioUnitario,
    },
  });
};

// items = [{ codigo, descripcion, unidad, cantidad, precioUnitario, capitulo?, insumos?: [...] }]
const importAPU = async (companyId, items) => {
  const activeProject = await prisma.project.findFirst({
    where: { companyId, activo: true },
  });
  if (!activeProject) throw Object.assign(new Error('No hay proyecto activo'), { statusCode: 404 });

  // Deduplicar por codigo
  const seen = new Map();
  for (const item of items) {
    const codigo      = String(item.codigo      || '').trim();
    const descripcion = String(item.descripcion || '').trim();
    if (!codigo || !descripcion) continue;
    seen.set(codigo, item);
  }
  const deduped = [...seen.values()];

  await prisma.$transaction(async (tx) => {
    // Borra insumos en cascada por el onDelete: Cascade
    await tx.itemAPU.deleteMany({ where: { projectId: activeProject.id } });

    for (const item of deduped) {
      const cantidad       = parseFloat(item.cantidad)       || 0;
      const precioUnitario = parseFloat(item.precioUnitario || item.precio_unitario || 0);

      const created = await tx.itemAPU.create({
        data: {
          projectId:      activeProject.id,
          codigo:         String(item.codigo).trim(),
          descripcion:    String(item.descripcion).trim(),
          unidad:         String(item.unidad || 'GL'),
          capitulo:       item.capitulo || null,
          cantidad,
          precioUnitario,
          saldoCantidad:  cantidad,
          saldoValor:     cantidad * precioUnitario,
        },
      });

      // Guardar insumos si vienen en el item
      if (Array.isArray(item.insumos) && item.insumos.length > 0) {
        await tx.itemAPUInsumo.createMany({
          data: item.insumos.map((ins) => ({
            itemApuId:      created.id,
            tipo:           String(ins.tipo        || 'MATERIAL').toUpperCase(),
            descripcion:    String(ins.descripcion || '').trim(),
            unidad:         String(ins.unidad      || 'UND').trim() || 'UND',
            rendimiento:    parseFloat(ins.rendimiento)    || 0,
            precioUnitario: parseFloat(ins.precioUnitario) || 0,
            precioTotal:    parseFloat(ins.precioTotal)    || 0,
          })),
        });
      }
    }
  });

  return prisma.itemAPU.count({ where: { projectId: activeProject.id } });
};

// ── Buscador difuso de ítems APU e insumos (para el bot y requisiciones) ──────
const normalize = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Devuelve candidatos (APU completos + insumos) ordenados por relevancia
const findBudgetMatches = async (companyId, query, limit = 6) => {
  const project = await prisma.project.findFirst({ where: { companyId, activo: true } });
  if (!project) return [];

  const items = await prisma.itemAPU.findMany({
    where: { projectId: project.id },
    include: { insumos: true },
  });

  const q = normalize(query);
  const qTokens = q.split(' ').filter((t) => t.length > 2);
  if (!q) return [];

  const candidates = [];
  for (const it of items) {
    candidates.push({
      type: 'APU',
      itemApuId: it.id,
      itemApuInsumoId: null,
      codigo: it.codigo,
      descripcion: it.descripcion,
      unidad: it.unidad,
      precioUnitario: Number(it.precioUnitario),
      saldoCantidad: Number(it.saldoCantidad),
      text: normalize(`${it.codigo} ${it.descripcion}`),
    });
    for (const ins of it.insumos) {
      candidates.push({
        type: 'INSUMO',
        itemApuId: it.id,
        itemApuInsumoId: ins.id,
        codigo: it.codigo,
        tipo: ins.tipo,
        descripcion: ins.descripcion,
        unidad: ins.unidad,
        precioUnitario: Number(ins.precioUnitario),
        text: normalize(ins.descripcion),
      });
    }
  }

  const scored = candidates
    .map((c) => {
      let score = 0;
      const codeNorm = normalize(c.codigo);
      if (codeNorm && q.includes(codeNorm)) score += 60;
      if (c.text.includes(q) && q.length > 4) score += 25;
      for (const t of qTokens) if (c.text.includes(t)) score += 10;
      return { ...c, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
};

module.exports = { getAPUTree, getItem, createItem, importAPU, findBudgetMatches };
