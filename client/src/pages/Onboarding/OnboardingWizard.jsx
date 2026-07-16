import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Button from '../../components/ui/Button';
import CompanyForm from '../../components/company/CompanyForm';
import UsersSettings from '../Settings/UsersSettings';
import ProjectForm from '../Projects/ProjectForm';
import MasterImport from '../Import/MasterImport';
import SupplierList from '../Suppliers/SupplierList';
import PendingSetup from './PendingSetup';

const STEPS = [
  { key: 'company', title: 'Tu empresa', desc: 'Completa los datos, el logo y la firma digital. Se usan en las órdenes de compra.' },
  { key: 'users', title: 'Tu equipo', desc: 'Crea los usuarios que trabajarán contigo: contador, residentes, almacenista...' },
  { key: 'project', title: 'Tu primer proyecto', desc: 'Registra el proyecto activo: nombre, contrato, entidad y región.' },
  { key: 'budget', title: 'Presupuesto (APU)', desc: 'Importa el Excel maestro con el presupuesto del proyecto.' },
  { key: 'suppliers', title: 'Proveedores', desc: 'Carga tu directorio de proveedores (Excel con IA) o créalos a mano.' },
];

// Wizard de configuración inicial OBLIGATORIO: el director no puede usar la app
// hasta completar los 5 pasos en orden. El estado (paso actual y checks) lo
// calcula SIEMPRE el backend contra la base de datos; el frontend solo lo pinta.
export default function OnboardingWizard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const logout = useAuthStore((s) => s.logout);
  const { loadProjects, setActiveProject } = useProjectStore();

  const [state, setState] = useState(null); // { step, done, checks, missing }
  const [advancing, setAdvancing] = useState(false);
  const [advanceMsg, setAdvanceMsg] = useState(null);
  const [finishing, setFinishing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/company/onboarding');
      setState(data.data);
      return data.data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    loadProjects();
  }, [refresh, loadProjects]);

  // Cierre del wizard. El guard de rutas (RequireSetup) decide con
  // user.company.setupCompletedAt: navegar con el usuario viejo en memoria
  // rebota de vuelta al wizard, así que se reintenta el refresh hasta que el
  // dato fresco llegue (cubre redeploys/red intermitente) y LUEGO se navega.
  const finish = useCallback(async () => {
    for (let i = 0; i < 5; i++) {
      // GET /onboarding solo CALCULA el estado; únicamente POST /advance
      // persiste setupCompletedAt en la BD. Si el clic original de "Finalizar"
      // se perdió (p.ej. un redeploy), sin esto el guard rebota eternamente.
      // Es idempotente, así que se asegura en cada intento.
      await api.post('/company/onboarding/advance').catch(() => {});
      await refreshUser();
      if (useAuthStore.getState().user?.company?.setupCompletedAt) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    await loadProjects().catch(() => {});
    navigate('/', { replace: true });
  }, [refreshUser, loadProjects, navigate]);

  // La empresa ya completó los 5 pasos pero el superadmin rechazó la
  // configuración: no cerramos el wizard solo porque done=true, hay que dejar
  // que el director revise/corrija y reenvíe a mano (ver handleResubmit).
  const rejected = user?.company?.approvalStatus === 'REJECTED';

  // Cuando el backend confirme done (por Finalizar o al recargar la página),
  // cerrar una sola vez. No aplica si está rechazada: ahí se cierra con el
  // botón explícito de reenvío.
  useEffect(() => {
    if (state?.done && !finishing && !rejected) {
      setFinishing(true);
      finish();
    }
  }, [state?.done, finishing, finish, rejected]);

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceMsg(null);
    try {
      const { data } = await api.post('/company/onboarding/advance');
      const next = data.data;
      if (!next.done && next.step === state?.step) {
        // El paso actual sigue incompleto: el backend dice exactamente qué falta.
        setAdvanceMsg(next.missing || 'Aún falta completar este paso.');
      }
      setState(next); // si next.done, el efecto de arriba dispara finish()
    } catch (err) {
      setAdvanceMsg(err.response?.data?.message || 'Error al validar el paso.');
    } finally {
      setAdvancing(false);
    }
  };

  // Reenvía la configuración corregida a revisión: persiste el avance (el
  // backend detecta REJECTED + done y vuelve a PENDING) y navega solo cuando
  // el estado fresco confirma el cambio.
  const handleResubmit = async () => {
    setAdvancing(true);
    setAdvanceMsg(null);
    try {
      await api.post('/company/onboarding/advance');
      await finish();
    } catch (err) {
      setAdvanceMsg(err.response?.data?.message || 'Error al reenviar la configuración.');
    } finally {
      setAdvancing(false);
    }
  };

  // Contenido de cada paso, reutilizado tanto en el wizard normal como en la
  // pantalla de corrección tras un rechazo.
  const renderStep = (key) => {
    switch (key) {
      case 'company': return <CompanyForm onChanged={refresh} />;
      case 'users': return <UsersSettings embedded onChanged={refresh} />;
      case 'project': return state?.checks?.project ? (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
          ✅ Proyecto creado. Pulsa <b>Continuar</b> para seguir con el presupuesto.
        </div>
      ) : <ProjectForm embedded onCreated={handleProjectCreated} />;
      case 'budget': return <MasterImport embedded onChanged={refresh} />;
      case 'suppliers': return <SupplierList embedded onChanged={refresh} />;
      default: return null;
    }
  };

  // Al crear el proyecto en el paso 3 lo dejamos como activo (los pasos de
  // presupuesto y proveedores trabajan sobre el proyecto activo).
  const handleProjectCreated = async (project) => {
    try {
      if (project?.id) await setActiveProject(project);
    } catch {
      // si falla la activación, el paso 4 pedirá activar a mano
    }
    await refresh();
  };

  if (!user) return <Navigate to="/login" replace />;
  if (user.rol !== 'DIRECTOR') return <PendingSetup />;

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (rejected) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
          <div className="max-w-3xl mx-auto px-5 py-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold tracking-tight">
                  PROCURA <span className="text-primary">AI</span>
                  <span className="ml-2 font-normal text-slate-400">Corrige tu configuración</span>
                </p>
                <h1 className="text-lg font-bold text-slate-800 mt-0.5">Revisa y reenvía para aprobación</h1>
              </div>
              <Button onClick={handleResubmit} loading={advancing}>Reenviar para revisión ✓</Button>
            </div>
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              ⚠️ Rechazada: {user.company?.rejectionReason || 'contacta al equipo de PROCURA AI para más detalles.'}
            </div>
            {advanceMsg && (
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                ⚠️ {advanceMsg}
              </div>
            )}
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-5 py-6 space-y-8">
          {STEPS.map((s) => (
            <section key={s.key}>
              <h2 className="text-sm font-semibold text-slate-700 mb-2">{s.title}</h2>
              {renderStep(s.key)}
            </section>
          ))}

          <div className="pt-2 pb-10 text-center">
            <button
              onClick={logout}
              className="text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              Cerrar sesión y continuar después →
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (state.done) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-3">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-600 font-medium">🎉 Configuración completa — entrando al panel…</p>
      </div>
    );
  }

  const stepIdx = state.step - 1;
  const current = STEPS[stepIdx] || STEPS[0];
  const isLast = state.step === STEPS.length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Encabezado fijo con stepper y botón Continuar siempre visible */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold tracking-tight">
                PROCURA <span className="text-primary">AI</span>
                <span className="ml-2 font-normal text-slate-400">Configuración inicial</span>
              </p>
              <h1 className="text-lg font-bold text-slate-800 mt-0.5">
                Paso {state.step} de {STEPS.length}: {current.title}
              </h1>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button onClick={handleAdvance} loading={advancing}>
                {isLast ? 'Finalizar ✓' : 'Continuar →'}
              </Button>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const done = state.checks?.[s.key];
              const active = i === stepIdx;
              return (
                <div key={s.key} className="flex-1 flex items-center gap-1.5">
                  <span
                    className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0 border-2 ${
                      done
                        ? 'bg-green-500 border-green-500 text-white'
                        : active
                          ? 'border-primary text-primary bg-primary/5'
                          : 'border-slate-300 text-slate-400'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`hidden sm:block text-xs truncate ${active ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}>
                    {s.title}
                  </span>
                  {i < STEPS.length - 1 && <span className="flex-1 h-px bg-slate-200" />}
                </div>
              );
            })}
          </div>

          {advanceMsg && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              ⚠️ {advanceMsg}
            </div>
          )}
        </div>
      </header>

      {/* Contenido del paso */}
      <main className="max-w-3xl mx-auto px-5 py-6 space-y-4">
        <p className="text-sm text-slate-500">{current.desc}</p>

        {renderStep(current.key)}

        <div className="pt-4 pb-10 text-center">
          <button
            onClick={logout}
            className="text-xs text-slate-400 hover:text-red-500 transition-colors"
          >
            Cerrar sesión y continuar después →
          </button>
        </div>
      </main>
    </div>
  );
}
