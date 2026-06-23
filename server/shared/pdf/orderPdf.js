const PDFDocument = require('pdfkit');

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmtCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-CO') : '—');

// Convierte un data URL base64 (data:image/png;base64,...) a Buffer para PDFKit.
// PDFKit solo soporta PNG y JPEG; si el formato no sirve, devuelve null.
const dataUrlToBuffer = (dataUrl) => {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:(image\/(png|jpe?g));base64,(.+)$/is);
  if (!m) return null;
  try {
    return Buffer.from(m[3], 'base64');
  } catch {
    return null;
  }
};

// Paleta de marca INGCISOL
const COLORS = {
  primary: '#E85D04', // naranja
  primaryDark: '#A03E00', // orange dim
  ink: '#0F1114',
  ink2: '#15181D',
  ink3: '#1C2027',
  text: '#1C2027',
  muted: '#5E6571', // silver 400
  soft: '#9097A1', // silver 300
  border: '#E2E5EA', // silver 100
  borderSoft: '#EDEFF2',
  card: '#F4F6F8', // silver 50
  white: '#FFFFFF',
};

const MARGIN = 45;
const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;
const RIGHT = PAGE_W - MARGIN;

const renderToBuffer = (draw) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      paintFooters(doc);
    } catch (err) {
      reject(err);
      return;
    }
    doc.end();
  });

// ── Bloques ──────────────────────────────────────────────────────────────────

// Barra de acento superior (marca).
const drawAccentBar = (doc) => {
  doc.rect(0, 0, PAGE_W, 5).fill(COLORS.primary);
  doc.rect(0, 5, PAGE_W, 1.5).fill(COLORS.primaryDark);
};

// Encabezado: logo + datos de empresa (izq) y badge de título (der).
const drawHeader = (doc, company, titulo, consecutivo, fecha) => {
  const top = 32;
  const logoBuf = dataUrlToBuffer(company?.logoUrl);
  let textX = MARGIN;

  if (logoBuf) {
    try {
      doc.image(logoBuf, MARGIN, top, { fit: [108, 54] });
      textX = MARGIN + 122;
    } catch {
      /* imagen inválida */
    }
  }

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(company?.razonSocial || 'PROCURA AI', textX, top, { width: 250 });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  const lineas = [
    company?.nit ? `NIT ${company.nit}` : null,
    company?.direccion || null,
    [company?.ciudad, company?.telefono].filter(Boolean).join(' · ') || null,
    company?.emailCorporativo || null,
  ].filter(Boolean);
  doc.text(lineas.join('\n'), textX, doc.y + 3, { width: 250, lineGap: 1.5 });

  // Badge de título (derecha)
  const boxW = 178;
  const boxH = 62;
  const boxX = RIGHT - boxW;
  doc.roundedRect(boxX, top, boxW, boxH, 8).fill(COLORS.ink);
  doc.roundedRect(boxX, top, 4, boxH, 2).fill(COLORS.primary);
  doc
    .fillColor('#C0C5CC')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(titulo, boxX + 14, top + 11, { width: boxW - 26, align: 'right', characterSpacing: 1 });
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(consecutivo || '—', boxX + 14, top + 24, { width: boxW - 26, align: 'right' });
  doc
    .fillColor('#9097A1')
    .font('Helvetica')
    .fontSize(8)
    .text(`Emitida: ${fmtDate(fecha)}`, boxX + 14, top + 46, { width: boxW - 26, align: 'right' });

  doc.y = top + Math.max(boxH, 70) + 16;
};

// Tarjeta redondeada con título y filas clave/valor. Devuelve la altura usada.
const measureCard = (doc, rows) => {
  // título (14) + filas (cada una ~12.5) + padding (12+12)
  return 14 + rows.length * 13 + 22;
};

const drawCard = (doc, x, y, w, h, { title, rows, chip }) => {
  doc.roundedRect(x, y, w, h, 7).fillAndStroke(COLORS.card, COLORS.border);
  const padX = 12;
  // título
  doc
    .fillColor(COLORS.primary)
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(title, x + padX, y + 11, { characterSpacing: 0.6, width: w - padX * 2 });

  // chip opcional (estado) a la derecha del título
  if (chip) {
    const cw = doc.widthOfString(chip, { fontSize: 7 }) + 14;
    doc.roundedRect(x + w - padX - cw, y + 9, cw, 14, 7).fill(COLORS.ink2);
    doc
      .fillColor(COLORS.white)
      .font('Helvetica-Bold')
      .fontSize(7)
      .text(chip, x + w - padX - cw, y + 13, { width: cw, align: 'center', characterSpacing: 0.4 });
  }

  let ry = y + 28;
  for (const [label, value] of rows) {
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica-Bold')
      .fontSize(7.5)
      .text(`${label}`, x + padX, ry, { width: 72, continued: false });
    doc
      .fillColor(COLORS.text)
      .font('Helvetica')
      .fontSize(8.5)
      .text(value == null || value === '' ? '—' : String(value), x + padX + 74, ry - 0.5, {
        width: w - padX * 2 - 74,
        ellipsis: true,
        height: 12,
      });
    ry += 13;
  }
};

// Dos tarjetas lado a lado, misma altura.
const drawTwoCards = (doc, left, right) => {
  const gap = 14;
  const w = (CONTENT_W - gap) / 2;
  const y = doc.y;
  const h = Math.max(measureCard(doc, left.rows), measureCard(doc, right.rows));
  drawCard(doc, MARGIN, y, w, h, left);
  drawCard(doc, MARGIN + w + gap, y, w, h, right);
  doc.y = y + h + 16;
};

// Tabla de ítems con encabezado oscuro, filas cebra y borde exterior.
// `items`: [{ descripcion, unidad, cantidad, precioUnitario, precioTotal, proveedor? }]
const drawItemsTable = (doc, items, { showSupplier = false } = {}) => {
  const x0 = MARGIN;
  const fullW = CONTENT_W;
  const cols = showSupplier
    ? [
        { key: 'idx', label: '#', w: 0.045, align: 'left' },
        { key: 'descripcion', label: 'DESCRIPCIÓN', w: 0.295, align: 'left' },
        { key: 'proveedor', label: 'PROVEEDOR', w: 0.18, align: 'left' },
        { key: 'unidad', label: 'UND', w: 0.09, align: 'center' },
        { key: 'cantidad', label: 'CANT.', w: 0.085, align: 'right' },
        { key: 'precioUnitario', label: 'V. UNIT.', w: 0.13, align: 'right' },
        { key: 'precioTotal', label: 'V. TOTAL', w: 0.165, align: 'right' },
      ]
    : [
        { key: 'idx', label: '#', w: 0.06, align: 'left' },
        { key: 'descripcion', label: 'DESCRIPCIÓN', w: 0.40, align: 'left' },
        { key: 'unidad', label: 'UND', w: 0.10, align: 'center' },
        { key: 'cantidad', label: 'CANT.', w: 0.11, align: 'right' },
        { key: 'precioUnitario', label: 'V. UNITARIO', w: 0.16, align: 'right' },
        { key: 'precioTotal', label: 'V. TOTAL', w: 0.17, align: 'right' },
      ];

  const colX = [];
  let acc = x0;
  for (const c of cols) {
    colX.push(acc);
    c.px = c.w * fullW;
    acc += c.px;
  }

  const PAD = 7;
  const writeRow = (row, y, font, size) => {
    cols.forEach((c, i) => {
      doc.font(font).fontSize(size);
      const val = row[c.key];
      doc.text(val == null ? '' : String(val), colX[i] + PAD, y, {
        width: c.px - PAD * 2,
        align: c.align,
      });
    });
  };

  const tableTop = doc.y;

  // Encabezado
  const headerH = 20;
  doc.roundedRect(x0, tableTop, fullW, headerH, 4).fill(COLORS.ink);
  doc.fillColor('#DCE0E5');
  writeRow(Object.fromEntries(cols.map((c) => [c.key, c.label])), tableTop + 6.5, 'Helvetica-Bold', 7.5);
  doc.y = tableTop + headerH;

  // Filas
  let total = 0;
  items.forEach((it, idx) => {
    const cantidad =
      it.cantidad != null
        ? it.cantidad
        : Number(it.precioUnitario)
        ? Number(it.precioTotal) / Number(it.precioUnitario)
        : 0;
    const row = {
      idx: idx + 1,
      descripcion: it.descripcion || '—',
      proveedor: it.proveedor || '',
      unidad: it.unidad || 'UND',
      cantidad: Number(cantidad).toLocaleString('es-CO', { maximumFractionDigits: 2 }),
      precioUnitario: fmtCOP(it.precioUnitario),
      precioTotal: fmtCOP(it.precioTotal),
    };
    total += Number(it.precioTotal) || 0;

    doc.font('Helvetica').fontSize(8.5);
    const descCol = cols.find((c) => c.key === 'descripcion');
    const descH = doc.heightOfString(row.descripcion, { width: descCol.px - PAD * 2 });
    let contentH = descH;
    if (showSupplier) {
      const provCol = cols.find((c) => c.key === 'proveedor');
      const provH = doc.heightOfString(row.proveedor || '', { width: provCol.px - PAD * 2 });
      contentH = Math.max(descH, provH);
    }
    const rowH = Math.max(19, contentH + PAD * 2 - 3);

    if (doc.y + rowH > PAGE_H - MARGIN - 60) {
      doc.addPage();
      doc.y = MARGIN + 6;
    }

    const y = doc.y;
    if (idx % 2 === 1) doc.rect(x0, y, fullW, rowH).fill(COLORS.card);
    doc.fillColor(COLORS.text);
    writeRow(row, y + PAD - 1, 'Helvetica', 8.5);
    // valor total en seminegrita
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(COLORS.ink2);
    const tc = cols[cols.length - 1];
    doc.text(row.precioTotal, colX[colX.length - 1] + PAD, y + PAD - 1, {
      width: tc.px - PAD * 2,
      align: 'right',
    });
    doc.y = y + rowH;
  });

  // borde exterior de la tabla
  doc
    .roundedRect(x0, tableTop, fullW, doc.y - tableTop, 4)
    .lineWidth(0.8)
    .strokeColor(COLORS.border)
    .stroke();

  doc.y += 14;
  return total;
};

// Calcula la discriminación tributaria (DIAN) a partir del subtotal de ítems.
// Toma el override de la OC y, si falta, la configuración de la empresa.
const computeTaxes = (subtotal, company = {}, order = {}) => {
  const pick = (a, b, def) => (a != null ? Number(a) : b != null ? Number(b) : def);
  const ivaPct = pick(order.ivaPorcentaje, company.ivaPorcentaje, 19);
  const retefuentePct = pick(order.retefuentePorcentaje, company.retefuentePorcentaje, 0);
  const reteIcaPorMil = pick(order.reteIcaPorMil, company.reteIcaPorMil, 0);
  const transporte = Number(order.transporte || 0);

  const iva = (subtotal * ivaPct) / 100;
  const retefuente = (subtotal * retefuentePct) / 100;
  const reteIca = (subtotal * reteIcaPorMil) / 1000;
  const total = subtotal + iva + transporte - retefuente - reteIca;

  return { subtotal, ivaPct, iva, transporte, retefuentePct, retefuente, reteIcaPorMil, reteIca, total };
};

// Bloque de discriminación de impuestos (estilo factura DIAN) alineado a la derecha.
const drawTaxBreakdown = (doc, t) => {
  const w = 250;
  const x = RIGHT - w;
  let y = doc.y;

  const line = (label, value, opts = {}) => {
    doc
      .fillColor(opts.muted ? COLORS.muted : COLORS.text)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(8.5)
      .text(label, x, y, { width: w * 0.55 });
    doc
      .fillColor(opts.neg ? COLORS.primaryDark : COLORS.ink2)
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(8.5)
      .text((opts.neg ? '−' : '') + fmtCOP(value), x + w * 0.55, y, { width: w * 0.45, align: 'right' });
    y += 14;
  };

  line('Subtotal', t.subtotal);
  line(`IVA (${Number(t.ivaPct).toLocaleString('es-CO')}%)`, t.iva);
  if (t.transporte > 0) line('Transporte / Flete', t.transporte);
  if (t.retefuente > 0) line(`Retefuente (${Number(t.retefuentePct).toLocaleString('es-CO')}%)`, t.retefuente, { neg: true });
  if (t.reteIca > 0) line(`ReteICA (${Number(t.reteIcaPorMil).toLocaleString('es-CO')}×1000)`, t.reteIca, { neg: true });

  // Caja del total a pagar
  y += 2;
  const h = 46;
  doc.roundedRect(x, y, w, h, 8).fill(COLORS.ink);
  doc.roundedRect(x, y, 5, h, 2.5).fill(COLORS.primary);
  doc
    .fillColor('#9097A1')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('TOTAL A PAGAR', x + 16, y + 9, { characterSpacing: 0.8 });
  doc
    .fillColor(COLORS.white)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(fmtCOP(t.total), x + 16, y + 21, { width: w - 28 });
  doc.y = y + h + 6;
  doc
    .fillColor(COLORS.soft)
    .font('Helvetica-Oblique')
    .fontSize(7)
    .text('Valores en pesos colombianos (COP). Impuestos discriminados conforme a normativa DIAN.', x - 30, doc.y, {
      width: w + 30,
      align: 'right',
    });
};

// Datos de pago (izquierda) + observaciones, a la altura de la caja de total.
const drawPaymentInfo = (doc, company, topY) => {
  if (!company?.banco && !company?.numeroCuenta) return;
  const w = 250;
  const x = MARGIN;
  const rows = [
    ['Banco', company.banco],
    ['Tipo de cuenta', company.tipoCuenta],
    ['N.º de cuenta', company.numeroCuenta],
  ].filter((r) => r[1]);
  const h = 14 + rows.length * 13 + 22;
  drawCard(doc, x, topY, w, h, { title: 'DATOS DE PAGO', rows });
};

// Firmas: empresa (con firma) y proveedor (línea en blanco).
const drawSignatures = (doc, company, supplierName) => {
  let y = Math.max(doc.y + 24, PAGE_H - MARGIN - 96);
  if (y + 96 > PAGE_H - MARGIN) {
    doc.addPage();
    y = PAGE_H - MARGIN - 96;
  }
  const colW = (CONTENT_W - 50) / 2;
  const x1 = MARGIN;
  const x2 = MARGIN + colW + 50;
  const lineY = y + 54;

  // firma de la empresa
  const firmaBuf = dataUrlToBuffer(company?.firmaUrl);
  if (firmaBuf) {
    try {
      doc.image(firmaBuf, x1, y, { fit: [150, 50] });
    } catch {
      /* ignore */
    }
  }

  const sigBlock = (x, line1, line2) => {
    doc
      .moveTo(x, lineY)
      .lineTo(x + colW, lineY)
      .lineWidth(0.8)
      .strokeColor(COLORS.soft)
      .stroke();
    doc.fillColor(COLORS.ink2).font('Helvetica-Bold').fontSize(9).text(line1, x, lineY + 5, { width: colW });
    doc.fillColor(COLORS.muted).font('Helvetica').fontSize(7.5).text(line2, x, doc.y + 1, { width: colW });
  };

  sigBlock(
    x1,
    company?.representanteLegal || company?.razonSocial || 'Representante',
    [company?.razonSocial, company?.nit ? `NIT ${company.nit}` : null].filter(Boolean).join(' — ') +
      '  ·  Aprobado por la empresa'
  );
  sigBlock(x2, supplierName || 'Proveedor', 'Recibido y aceptado por el proveedor');
};

// Pie con paginación, en todas las páginas.
const paintFooters = (doc) => {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = PAGE_H - MARGIN + 6;
    doc
      .moveTo(MARGIN, y)
      .lineTo(RIGHT, y)
      .lineWidth(0.6)
      .strokeColor(COLORS.border)
      .stroke();
    doc
      .fillColor(COLORS.soft)
      .font('Helvetica')
      .fontSize(7)
      .text('Generado por PROCURA AI — Sistema de Gestión de Procura', MARGIN, y + 5, {
        width: CONTENT_W - 60,
        align: 'left',
      });
    doc.text(`Página ${i + 1} de ${range.count}`, MARGIN, y + 5, {
      width: CONTENT_W,
      align: 'right',
    });
  }
};

// ── Generadores públicos ─────────────────────────────────────────────────────

// OC de un único proveedor (la que recibe el proveedor: solo sus ítems).
const generateOrderPdf = ({ company, order, supplier, items, project, requisition }) =>
  renderToBuffer((doc) => {
    drawAccentBar(doc);
    drawHeader(doc, company, 'ORDEN DE COMPRA', order?.consecutivo, order?.fechaEmision);

    drawTwoCards(
      doc,
      {
        title: 'PROVEEDOR',
        rows: [
          ['Nombre', supplier?.nombre],
          ['NIT', supplier?.nit],
          ['Ciudad', supplier?.ciudad],
          ['WhatsApp', supplier?.whatsapp],
          ['Email', supplier?.email],
        ],
      },
      {
        title: 'DETALLES',
        chip: order?.estado || 'EMITIDA',
        rows: [
          ['Proyecto', project?.nombre],
          ['Contrato', project?.contratoNo],
          ['Requisición', requisition?.consecutivo],
          ['Entrega', fmtDate(order?.fechaEntregaPactada)],
          ['Fecha', fmtDate(order?.fechaEmision)],
        ],
      }
    );

    const subtotal = drawItemsTable(doc, items, { showSupplier: false });
    const taxes = computeTaxes(subtotal, company, order);
    const bandY = doc.y;
    drawTaxBreakdown(doc, taxes);
    drawPaymentInfo(doc, company, bandY);
    drawSignatures(doc, company, supplier?.nombre);
  });

// Documento consolidado (director / contabilidad): todos los ítems con su proveedor.
const generateConsolidatedPdf = ({ company, requisition, project, groups }) =>
  renderToBuffer((doc) => {
    const consecutivos = groups.map((g) => g.order?.consecutivo).filter(Boolean).join(', ');
    const nProv = new Set(groups.map((g) => g.supplier?.id || g.supplier?.nombre)).size;

    drawAccentBar(doc);
    drawHeader(doc, company, 'ORDEN DE COMPRA', requisition?.consecutivo || consecutivos, new Date());

    drawTwoCards(
      doc,
      {
        title: 'REQUISICIÓN',
        rows: [
          ['Proyecto', project?.nombre],
          ['Contrato', project?.contratoNo],
          ['Requisición', requisition?.consecutivo],
        ],
      },
      {
        title: 'ADJUDICACIÓN',
        chip: groups.length > 1 ? 'DIVIDIDA' : 'ÚNICA',
        rows: [
          ['OC emitidas', String(groups.length)],
          ['Proveedores', String(nProv)],
          ['Consecutivos', consecutivos],
        ],
      }
    );

    const flatItems = [];
    for (const g of groups) for (const it of g.items) flatItems.push({ ...it, proveedor: g.supplier?.nombre });
    const total = drawItemsTable(doc, flatItems, { showSupplier: true });

    // Resumen por proveedor
    doc.fillColor(COLORS.primary).font('Helvetica-Bold').fontSize(8.5).text('RESUMEN POR PROVEEDOR', MARGIN, doc.y, { characterSpacing: 0.6 });
    doc.moveDown(0.35);
    groups.forEach((g) => {
      const subtotal = g.items.reduce((a, i) => a + (Number(i.precioTotal) || 0), 0);
      const y = doc.y;
      doc.fillColor(COLORS.text).font('Helvetica').fontSize(8.5).text(`${g.supplier?.nombre || 'Proveedor'}  ·  ${g.order?.consecutivo || ''}`, MARGIN, y, { width: CONTENT_W - 130 });
      doc.font('Helvetica-Bold').fillColor(COLORS.ink2).text(fmtCOP(subtotal), RIGHT - 130, y, { width: 130, align: 'right' });
      doc.y = y + 13;
    });

    doc.y += 6;
    const transporte = groups.reduce((a, g) => a + Number(g.order?.transporte || 0), 0);
    const taxes = computeTaxes(total, company, { transporte });
    const bandY = doc.y;
    drawTaxBreakdown(doc, taxes);
    drawPaymentInfo(doc, company, bandY);
    drawSignatures(doc, company, null);
  });

// ── Preparación de datos (compartido entre worker y API) ─────────────────────

// Mismo criterio de casamiento ítem-requisición que computeComparison.
const itemMatches = (ri, qi) =>
  (ri.itemApuId && qi.itemApuId && qi.itemApuId === ri.itemApuId) ||
  (qi.descripcion &&
    ri.descripcion &&
    qi.descripcion.toLowerCase().trim() === ri.descripcion.toLowerCase().trim());

// Normaliza QuotationItem adjudicados → filas para el PDF, tomando unidad y
// cantidad del ítem de requisición correspondiente.
const normalizeAwardedItems = (adjItems, reqItems) =>
  (adjItems || []).map((qi) => {
    const ri = (reqItems || []).find((r) => itemMatches(r, qi));
    const cantidad = ri
      ? Number(ri.cantidad)
      : Number(qi.precioUnitario)
      ? Number(qi.precioTotal) / Number(qi.precioUnitario)
      : 0;
    return {
      descripcion: qi.descripcion || qi.itemAPU?.descripcion || ri?.descripcion || 'Ítem',
      unidad: ri?.unidad || 'UND',
      cantidad,
      precioUnitario: Number(qi.precioUnitario),
      precioTotal: Number(qi.precioTotal),
      tiempoEntrega: qi.tiempoEntrega,
    };
  });

module.exports = {
  generateOrderPdf,
  generateConsolidatedPdf,
  computeTaxes,
  fmtCOP,
  dataUrlToBuffer,
  itemMatches,
  normalizeAwardedItems,
};
