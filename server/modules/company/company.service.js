const prisma = require('../../shared/db');
const redis = require('../../shared/redis');

// ── Onboarding obligatorio (wizard secuencial del director) ──────────────────
// El estado NUNCA se confía al cliente: se recalcula contra la BD en cada
// consulta/avance. onboardingStep en Company es un espejo informativo.

const ONBOARDING_STEPS = ['company', 'users', 'project', 'budget', 'suppliers'];

const REQUIRED_COMPANY_FIELDS = [
  ['representanteLegal', 'el representante legal'],
  ['emailCorporativo', 'el email corporativo'],
  ['telefono', 'el teléfono'],
  ['direccion', 'la dirección'],
  ['ciudad', 'la ciudad'],
  ['banco', 'el banco'],
  ['tipoCuenta', 'el tipo de cuenta'],
  ['numeroCuenta', 'el número de cuenta'],
  ['logoUrl', 'el logo corporativo'],
  ['firmaUrl', 'la firma digital'],
];

const setupCacheKey = (companyId) => `company:${companyId}:setupDone`;

const computeOnboarding = async (companyId) => {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw Object.assign(new Error('Empresa no encontrada'), { statusCode: 404 });

  const [usersCount, projectsCount, apuCount, suppliersCount] = await Promise.all([
    prisma.user.count({ where: { companyId, activo: true } }),
    prisma.project.count({ where: { companyId } }),
    prisma.itemAPU.count({ where: { project: { companyId } } }),
    prisma.supplier.count({ where: { companyId, activo: true } }),
  ]);

  const missingFields = REQUIRED_COMPANY_FIELDS
    .filter(([f]) => !String(company[f] || '').trim())
    .map(([, label]) => label);

  const checks = {
    company: missingFields.length === 0,
    users: usersCount > 1, // al menos un miembro además del director
    project: projectsCount > 0,
    budget: apuCount > 0,
    suppliers: suppliersCount > 0,
  };

  const firstFailing = ONBOARDING_STEPS.findIndex((s) => !checks[s]);
  const done = firstFailing === -1;
  const step = done ? ONBOARDING_STEPS.length : firstFailing + 1;

  const MISSING_MSG = {
    company: missingFields.length
      ? `Falta completar: ${missingFields.join(', ')}.`
      : null,
    users: 'Crea al menos un usuario de tu equipo (contador, residente, almacenista...).',
    project: 'Crea tu primer proyecto.',
    budget: 'Importa el presupuesto maestro (APU) del proyecto.',
    suppliers: 'Registra o importa al menos un proveedor.',
  };

  return {
    company,
    state: {
      step,
      done,
      checks,
      missing: done ? null : MISSING_MSG[ONBOARDING_STEPS[firstFailing]],
      completedAt: company.setupCompletedAt,
    },
  };
};

const getOnboarding = async (companyId) => {
  const { company, state } = await computeOnboarding(companyId);
  // Auto-reparación: si el estado calculado ya está completo pero nunca se
  // persistió (el POST /advance original se perdió por red o un redeploy),
  // guardarlo aquí. Sin esto, el frontend rebotaba eternamente entre el wizard
  // ("estás listo") y el guard de rutas ("la BD dice que no").
  if (state.done && !company.setupCompletedAt) {
    const completedAt = new Date();
    await prisma.company.update({
      where: { id: companyId },
      data: { onboardingStep: state.step, setupCompletedAt: completedAt },
    });
    await redis.del(setupCacheKey(companyId)).catch(() => {});
    return { ...state, completedAt };
  }
  return state;
};

// Re-valida contra BD y persiste el avance. Al completarse el último paso fija
// setupCompletedAt e invalida el caché del middleware de bloqueo.
const advanceOnboarding = async (companyId) => {
  const { company, state } = await computeOnboarding(companyId);

  const data = { onboardingStep: state.step };
  if (state.done && !company.setupCompletedAt) data.setupCompletedAt = new Date();
  if (state.step !== company.onboardingStep || data.setupCompletedAt) {
    await prisma.company.update({ where: { id: companyId }, data });
  }
  if (state.done) await redis.del(setupCacheKey(companyId)).catch(() => {});
  return { ...state, completedAt: data.setupCompletedAt || company.setupCompletedAt };
};

const getCompany = async (companyId) => {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw Object.assign(new Error('Empresa no encontrada'), { statusCode: 404 });
  return company;
};

const updateCompany = async (companyId, data) => {
  const {
    razonSocial, nit, representanteLegal, emailCorporativo,
    telefono, direccion, ciudad, banco, tipoCuenta, numeroCuenta,
    ivaPorcentaje, retefuentePorcentaje, reteIcaPorMil,
  } = data;
  const numOr = (v, def) => (v === '' || v === null || v === undefined ? def : Number(v));
  return prisma.company.update({
    where: { id: companyId },
    data: {
      razonSocial, nit, representanteLegal, emailCorporativo,
      telefono, direccion, ciudad, banco, tipoCuenta, numeroCuenta,
      ivaPorcentaje: numOr(ivaPorcentaje, 19),
      retefuentePorcentaje: numOr(retefuentePorcentaje, 0),
      reteIcaPorMil: numOr(reteIcaPorMil, 0),
    },
  });
};

const updateLogo = async (companyId, base64DataUrl) => {
  if (!base64DataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('Formato de imagen inválido'), { statusCode: 400 });
  }
  return prisma.company.update({ where: { id: companyId }, data: { logoUrl: base64DataUrl } });
};

const updateFirma = async (companyId, base64DataUrl) => {
  if (!base64DataUrl.startsWith('data:image/')) {
    throw Object.assign(new Error('Formato de imagen inválido'), { statusCode: 400 });
  }
  return prisma.company.update({ where: { id: companyId }, data: { firmaUrl: base64DataUrl } });
};

module.exports = {
  getCompany,
  updateCompany,
  updateLogo,
  updateFirma,
  getOnboarding,
  advanceOnboarding,
  setupCacheKey,
};
