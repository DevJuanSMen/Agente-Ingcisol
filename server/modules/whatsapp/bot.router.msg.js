const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');
const { nationalNumber } = require('../../shared/utils/phone');
const { buildResponse, handleSupplierMessage } = require('./bot.context');
const botFlows = require('./bot.flows');

// Ruteo de mensajes entrantes con sesión ÚNICA global: el número del remitente
// decide a qué empresa y con qué rol se responde. Se busca en TODAS las
// empresas (usuarios y proveedores) y se desambigua con una precedencia fija:
//   1. Proveedor con cotización abierta (invite más reciente)
//   2. Proveedor con orden de compra activa
//   3. Usuario con acción pendiente (aprobar/adjudicar)
//   4. Usuario activo (el de registro más reciente si hay varios)
//   5. Proveedor sin contexto abierto (conversación general)
//   6. Desconocido → aviso único de "no eres usuario de PROCURA AI"

// Mensaje para números no registrados: se envía UNA sola vez por número (7 días)
// para no spamear a desconocidos.
const UNKNOWN_TTL = 7 * 24 * 60 * 60;
const unknownKey = (phoneNat) => `whatsapp:unknown:${phoneNat}`;

const enabledKey = (companyId) => `whatsapp:${companyId}:enabled`;

// Registra el evento en BotParseLog sin romper el flujo si la tabla no existe aún.
const logParse = async (data) => {
  try {
    await prisma.botParseLog.create({ data });
  } catch (err) {
    logger.warn(`[bot.route] No se pudo guardar BotParseLog: ${err.message}`);
  }
};

// Matching en JS (no SQL contains): normaliza ambos lados a número nacional, así
// es inmune a espacios, guiones o indicativos distintos en el dato guardado.
const matchesPhone = (stored, phoneNat) => nationalNumber(stored) === phoneNat;

// Filtra los candidatos a empresas con el bot habilitado. El flag es un
// interruptor de EXCLUSIÓN del superadmin: toda empresa está habilitada por
// defecto y solo '0' explícito la apaga (las empresas nuevas no tienen flag).
const filterEnabled = async (rows) => {
  const out = [];
  for (const r of rows) {
    const enabled = await redis.get(enabledKey(r.companyId));
    if (enabled !== '0') out.push(r);
  }
  return out;
};

async function routeIncoming(text, rawPhone) {
  const phoneNat = nationalNumber(rawPhone) || rawPhone;
  if (!phoneNat) return null;

  // Candidatos en todas las empresas (con select mínimo; el volumen de números
  // registrados es pequeño, el filtro fino se hace en JS).
  const [supplierRows, userRows] = await Promise.all([
    prisma.supplier.findMany({
      where: { activo: true, whatsapp: { not: null } },
      select: { id: true, nombre: true, companyId: true, whatsapp: true, updatedAt: true },
    }),
    prisma.user.findMany({
      where: { activo: true, whatsapp: { not: null } },
      select: { id: true, nombre: true, rol: true, companyId: true, whatsapp: true, updatedAt: true },
    }),
  ]);

  const suppliers = await filterEnabled(supplierRows.filter((s) => matchesPhone(s.whatsapp, phoneNat)));
  const users = await filterEnabled(userRows.filter((u) => matchesPhone(u.whatsapp, phoneNat)));

  // ── 1/2. Proveedor con contexto abierto (cotización o entrega pendiente) ──
  if (suppliers.length) {
    const supplierIds = suppliers.map((s) => s.id);
    const byId = new Map(suppliers.map((s) => [s.id, s]));

    const openInvite = await prisma.quotationInvite.findFirst({
      where: {
        supplierId: { in: supplierIds },
        enviado: true,
        quotation: { estado: { in: ['EN_BUSQUEDA', 'PENDIENTE_APROBACION'] } },
      },
      orderBy: { sentAt: 'desc' },
      select: { supplierId: true },
    });
    if (openInvite) {
      const s = byId.get(openInvite.supplierId);
      return handleSupplierMessage(text, s.companyId, s.id, s.nombre);
    }

    const activePO = await prisma.purchaseOrder.findFirst({
      where: { supplierId: { in: supplierIds }, estado: { in: ['EMITIDA', 'ENVIADA'] } },
      orderBy: { fechaEmision: 'desc' },
      select: { supplierId: true },
    });
    if (activePO) {
      const s = byId.get(activePO.supplierId);
      return handleSupplierMessage(text, s.companyId, s.id, s.nombre);
    }
  }

  // ── 3. Usuario con acción pendiente (aprobar requisición / adjudicar) ──
  for (const u of users) {
    const pending = await botFlows.getPending(u.companyId, u.id);
    if (pending) {
      return botFlows.handlePendingReply(
        text,
        u.companyId,
        { id: u.id, rol: u.rol, nombre: u.nombre, phone: rawPhone },
        pending
      );
    }
  }

  // ── 4. Usuario interno (empresa más reciente si está en varias) ──
  if (users.length) {
    const u = [...users].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    return buildResponse(text, u.companyId, { id: u.id, rol: u.rol });
  }

  // ── 5. Proveedor sin contexto abierto → conversación general en su empresa ──
  if (suppliers.length) {
    const s = [...suppliers].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
    return handleSupplierMessage(text, s.companyId, s.id, s.nombre);
  }

  // ── 6. Número desconocido → responder una sola vez y registrar ──
  const firstTime = await redis.set(unknownKey(phoneNat), '1', 'EX', UNKNOWN_TTL, 'NX');
  await logParse({ contexto: 'ROUTE_UNKNOWN', entrada: text.slice(0, 2000), exito: false });
  if (firstTime === 'OK') {
    logger.info(`[bot.route] Número desconocido: ${phoneNat}`);
    return (
      '👋 Hola, soy el asistente de *PROCURA AI*.\n\n' +
      'Este número no está registrado en ninguna empresa de la plataforma, así que no tengo proyectos ni información para mostrarte.\n\n' +
      'Si crees que es un error, pide al director de tu empresa que registre tu número de WhatsApp en tu perfil.'
    );
  }
  return null;
}

module.exports = { routeIncoming, logParse };
