const prisma = require('../../shared/db');
const redis = require('../../shared/redis');
const { logger } = require('../../shared/utils/logger');

// ── Catálogo de módulos y roles ────────────────────────────────────────────────
const MODULES = [
  { key: 'requisitions', label: 'Requisiciones' },
  { key: 'quotations', label: 'Cotizaciones' },
  { key: 'orders', label: 'Órdenes de compra' },
  { key: 'tracking', label: 'Seguimiento' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'budget', label: 'Presupuesto / APU' },
  { key: 'projects', label: 'Proyectos' },
  { key: 'delegations', label: 'Delegaciones' },
  { key: 'company', label: 'Empresa' },
  { key: 'users', label: 'Usuarios' },
  { key: 'whatsapp', label: 'Bot WhatsApp' },
];
const MODULE_KEYS = MODULES.map((m) => m.key);

const ROLES = ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA', 'CONTABILIDAD'];
const ACCIONES = ['ver', 'crear', 'editar', 'eliminar'];

const ALL = { ver: true, crear: true, editar: true, eliminar: true };
const VIEW = { ver: true, crear: false, editar: false, eliminar: false };
const NONE = { ver: false, crear: false, editar: false, eliminar: false };

// ── Matriz por defecto (replica el comportamiento actual del sistema) ───────────
// Refleja los ejemplos del cliente: el residente crea requisiciones y ve
// seguimiento pero no toca presupuesto; el contador solo ve OC para pagarlas.
const DEFAULT_MATRIX = {
  DIRECTOR: Object.fromEntries(MODULE_KEYS.map((m) => [m, ALL])),
  APOYO_DIRECTOR: {
    requisitions: ALL, quotations: ALL, orders: ALL, tracking: VIEW,
    suppliers: ALL, budget: ALL, projects: ALL, delegations: ALL,
    company: VIEW, users: NONE, whatsapp: VIEW,
  },
  RESIDENTE: {
    requisitions: { ver: true, crear: true, editar: true, eliminar: false },
    quotations: NONE, orders: NONE, tracking: VIEW,
    suppliers: NONE, budget: NONE, projects: VIEW, delegations: VIEW,
    company: NONE, users: NONE, whatsapp: NONE,
  },
  ALMACENISTA: {
    requisitions: { ver: true, crear: true, editar: false, eliminar: false },
    quotations: NONE, orders: NONE, tracking: VIEW,
    suppliers: NONE, budget: NONE, projects: VIEW, delegations: VIEW,
    company: NONE, users: NONE, whatsapp: NONE,
  },
  CONTABILIDAD: {
    requisitions: NONE, quotations: NONE,
    orders: { ver: true, crear: false, editar: true, eliminar: false }, tracking: VIEW,
    suppliers: NONE, budget: NONE, projects: VIEW, delegations: NONE,
    company: NONE, users: NONE, whatsapp: NONE,
  },
};

const cacheKey = (companyId) => `perms:${companyId}`;
const CACHE_TTL = 300; // 5 minutos

// Construye la matriz por defecto en filas de RolePermission
const defaultRows = (companyId) => {
  const rows = [];
  for (const rol of ROLES) {
    for (const modulo of MODULE_KEYS) {
      const p = DEFAULT_MATRIX[rol]?.[modulo] || NONE;
      rows.push({ companyId, rol, modulo, ...p });
    }
  }
  return rows;
};

// ── Lectura de la matriz (siembra defaults la primera vez) ──────────────────────
// Si la tabla aún no existe en la BD (schema no desplegado), degrada con elegancia
// devolviendo la matriz por defecto en memoria, sin romper la app.
const getMatrix = async (companyId) => {
  try {
    let rows = await prisma.rolePermission.findMany({ where: { companyId } });
    if (rows.length === 0) {
      await prisma.rolePermission.createMany({ data: defaultRows(companyId), skipDuplicates: true });
      rows = await prisma.rolePermission.findMany({ where: { companyId } });
    }
    return rows;
  } catch (err) {
    // P2021: la tabla no existe todavía. Usa defaults en memoria.
    if (err.code === 'P2021' || /does not exist|no existe/i.test(err.message || '')) {
      logger.warn('[permissions] Tabla RolePermission no existe aún; usando defaults en memoria. Ejecuta prisma db push para persistir cambios.');
      return defaultRows(companyId);
    }
    throw err;
  }
};

// Convierte filas → estructura anidada { rol: { modulo: {ver,crear,editar,eliminar} } }
const toNested = (rows) => {
  const out = {};
  for (const rol of ROLES) out[rol] = {};
  for (const r of rows) {
    if (!out[r.rol]) out[r.rol] = {};
    out[r.rol][r.modulo] = { ver: r.ver, crear: r.crear, editar: r.editar, eliminar: r.eliminar };
  }
  return out;
};

const getMatrixNested = async (companyId) => toNested(await getMatrix(companyId));

// Permisos del rol indicado (para el front: { modulo: {ver,...} })
const getRolePermissions = async (companyId, rol) => {
  if (rol === 'DIRECTOR') return Object.fromEntries(MODULE_KEYS.map((m) => [m, ALL]));
  const nested = await getMatrixNested(companyId);
  return nested[rol] || {};
};

// ── Actualización (solo director) ──────────────────────────────────────────────
const updateMatrix = async (companyId, entries) => {
  if (!Array.isArray(entries)) {
    throw Object.assign(new Error('Se requiere un arreglo de permisos'), { statusCode: 400 });
  }
  const ops = [];
  for (const e of entries) {
    if (!ROLES.includes(e.rol) || !MODULE_KEYS.includes(e.modulo)) continue;
    if (e.rol === 'DIRECTOR') continue; // el director siempre tiene todo
    const data = {
      ver: !!e.ver, crear: !!e.crear, editar: !!e.editar, eliminar: !!e.eliminar,
    };
    ops.push(
      prisma.rolePermission.upsert({
        where: { companyId_rol_modulo: { companyId, rol: e.rol, modulo: e.modulo } },
        update: data,
        create: { companyId, rol: e.rol, modulo: e.modulo, ...data },
      })
    );
  }
  try {
    await prisma.$transaction(ops);
  } catch (err) {
    if (err.code === 'P2021' || /does not exist|no existe/i.test(err.message || '')) {
      throw Object.assign(
        new Error('La tabla de permisos aún no existe en la base de datos. Aplica el schema (prisma db push) para poder guardar cambios.'),
        { statusCode: 503 }
      );
    }
    throw err;
  }
  await redis.del(cacheKey(companyId)).catch(() => {});
  logger.info(`[permissions] Matriz actualizada para company ${companyId} (${ops.length} celdas)`);
  return getMatrixNested(companyId);
};

// ── Chequeo de permiso (con caché en Redis) ─────────────────────────────────────
const can = async (companyId, rol, modulo, accion = 'ver') => {
  if (rol === 'DIRECTOR') return true;

  let nested;
  try {
    const cached = await redis.get(cacheKey(companyId));
    if (cached) nested = JSON.parse(cached);
  } catch { /* sin caché */ }

  if (!nested) {
    nested = await getMatrixNested(companyId);
    redis.set(cacheKey(companyId), JSON.stringify(nested), 'EX', CACHE_TTL).catch(() => {});
  }

  return !!nested?.[rol]?.[modulo]?.[accion];
};

module.exports = {
  MODULES, MODULE_KEYS, ROLES, ACCIONES,
  getMatrix, getMatrixNested, getRolePermissions, updateMatrix, can,
};
