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

  const finish = useCallback(async () => {
    await refreshUser();
    await loadProjects();
    navigate('/', { replace: true });
  }, [refreshUser, loadProjects, navigate]);

  const handleAdvance = async () => {
    setAdvancing(true);
    setAdvanceMsg(null);
    try {
      const { data } = await api.post('/company/onboarding/advance');
      const next = data.data;
      if (next.done) {
        await finish();
        return;
      }
      if (next.step === state?.step) {
        // El paso actual sigue incompleto: el backend dice exactamente qué falta.
        setAdvanceMsg(next.missing || 'Aún falta completar este paso.');
      }
      setState(next);
    } catch (err) {
      setAdvanceMsg(err.response?.data?.message || 'Error al validar el paso.');
    } finally {
      setAdvancing(false);
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

  if (state.done) return <Navigate to="/" replace />;

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

        {current.key === 'company' && <CompanyForm onChanged={refresh} />}
        {current.key === 'users' && <UsersSettings embedded onChanged={refresh} />}
        {current.key === 'project' && (
          state.checks?.project ? (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-700">
              ✅ Proyecto creado. Pulsa <b>Continuar</b> para seguir con el presupuesto.
            </div>
          ) : (
            <ProjectForm embedded onCreated={handleProjectCreated} />
          )
        )}
        {current.key === 'budget' && <MasterImport embedded onChanged={refresh} />}
        {current.key === 'suppliers' && <SupplierList embedded onChanged={refresh} />}

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
