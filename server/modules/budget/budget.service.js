const prisma = require('../../shared/db');

const listSheets = async (companyId, projectId) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });

  return prisma.budgetSheet.findMany({
    where: { projectId },
    select: { id: true, nombre: true, orden: true, createdAt: true, updatedAt: true },
    orderBy: { orden: 'asc' },
  });
};

const getSheet = async (companyId, projectId, sheetId) => {
  const sheet = await prisma.budgetSheet.findFirst({
    where: { id: sheetId, projectId },
    include: { project: { select: { companyId: true, nombre: true } } },
  });
  if (!sheet || sheet.project.companyId !== companyId) {
    throw Object.assign(new Error('Hoja no encontrada'), { statusCode: 404 });
  }
  return sheet;
};

const saveSheets = async (companyId, projectId, sheets) => {
  const project = await prisma.project.findFirst({ where: { id: projectId, companyId } });
  if (!project) throw Object.assign(new Error('Proyecto no encontrado'), { statusCode: 404 });

  // sheets = [{ nombre, orden, headers, filas }]
  const ops = sheets.map((s, i) =>
    prisma.budgetSheet.upsert({
      where: { projectId_nombre: { projectId, nombre: s.nombre } },
      update: { orden: s.orden ?? i, headers: s.headers, filas: s.filas },
      create: { projectId, nombre: s.nombre, orden: s.orden ?? i, headers: s.headers, filas: s.filas },
    })
  );
  return prisma.$transaction(ops);
};

const deleteSheet = async (companyId, projectId, sheetId) => {
  const sheet = await prisma.budgetSheet.findFirst({
    where: { id: sheetId, projectId },
    include: { project: { select: { companyId: true } } },
  });
  if (!sheet || sheet.project.companyId !== companyId) {
    throw Object.assign(new Error('Hoja no encontrada'), { statusCode: 404 });
  }
  return prisma.budgetSheet.delete({ where: { id: sheetId } });
};

// Cruce de información: busca coincidencias en una columna entre dos hojas
const crossReference = async (companyId, projectId, sheet1Id, sheet2Id, keyCol1, keyCol2) => {
  const [s1, s2] = await Promise.all([
    getSheet(companyId, projectId, sheet1Id),
    getSheet(companyId, projectId, sheet2Id),
  ]);

  const map2 = new Map();
  for (const row of s2.filas) {
    const k = String(row[keyCol2] ?? '').trim().toLowerCase();
    if (k) map2.set(k, row);
  }

  const result = s1.filas.map((row) => {
    const k = String(row[keyCol1] ?? '').trim().toLowerCase();
    const match = map2.get(k) || null;
    return { ...row, _cruce: match };
  });

  return {
    hoja1: s1.nombre,
    hoja2: s2.nombre,
    keyCol1,
    keyCol2,
    totalHoja1: s1.filas.length,
    totalCruces: result.filter((r) => r._cruce).length,
    filas: result,
  };
};

const importSheetAsAPU = async (companyId, projectId, sheetId, colMap) => {
  const sheet = await getSheet(companyId, projectId, sheetId);

  // Deduplicar por codigo: si el Excel tiene filas con el mismo código, gana la última
  const seen = new Map();
  for (const row of sheet.filas) {
    const codigo      = String(row[colMap.codigo]      ?? '').trim();
    const descripcion = String(row[colMap.descripcion] ?? '').trim();
    if (!codigo || !descripcion) continue;
    seen.set(codigo, {
      codigo,
      descripcion,
      unidad:         String(row[colMap.unidad] ?? 'GL').trim() || 'GL',
      cantidad:       parseFloat(row[colMap.cantidad])       || 0,
      precioUnitario: parseFloat(row[colMap.precioUnitario]) || 0,
    });
  }
  const items = [...seen.values()];

  await prisma.$transaction(async (tx) => {
    await tx.itemAPU.deleteMany({ where: { projectId } });
    await tx.itemAPU.createMany({
      data: items.map((i) => ({
        projectId,
        codigo:         i.codigo,
        descripcion:    i.descripcion,
        unidad:         i.unidad,
        cantidad:       i.cantidad,
        precioUnitario: i.precioUnitario,
        saldoCantidad:  i.cantidad,
        saldoValor:     i.cantidad * i.precioUnitario,
      })),
    });
  });

  return prisma.itemAPU.count({ where: { projectId } });
};

const importSheetAsBasicPrices = async (companyId, projectId, sheetId, colMap) => {
  const sheet = await getSheet(companyId, projectId, sheetId);
  const items = sheet.filas
    .map((row) => ({
      codigo: String(row[colMap.codigo] ?? '').trim(),
      descripcion: String(row[colMap.descripcion] ?? '').trim(),
      unidad: String(row[colMap.unidad] ?? 'GL').trim() || 'GL',
      precioUnitario: parseFloat(row[colMap.precioUnitario]) || 0,
    }))
    .filter((i) => i.codigo && i.descripcion);

  const ops = items.map((i) =>
    prisma.basicPrice.upsert({
      where: { companyId_codigo: { companyId, codigo: i.codigo } },
      update: { descripcion: i.descripcion, unidad: i.unidad, precioUnitario: i.precioUnitario },
      create: { companyId, codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, precioUnitario: i.precioUnitario },
    })
  );
  await prisma.$transaction(ops);
  return items.length;
};

module.exports = { listSheets, getSheet, saveSheets, deleteSheet, crossReference, importSheetAsAPU, importSheetAsBasicPrices };
