import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useProjectStore } from '../store/projectStore';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import AIBubble from '../components/AIBubble';

const fmtM = (v) => {
  const n = Number(v || 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString('es-CO')}`;
};

const KpiCard = ({ label, value, sub, color = 'text-slate-800', icon }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
    <div className="flex items-start justify-between mb-2">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      {icon && <span className="text-xl">{icon}</span>}
    </div>
    <p className={`text-2xl font-bold ${color}`}>{value}</p>
    {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
  </div>
);

export default function Dashboard() {
  const { activeProject, projects } = useProjectStore();
  const navigate = useNavigate();

  const [tracking, setTracking] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [delegStats, setDelegStats] = useState(null);
  const [projectDash, setProjectDash] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = activeProject ? `?projectId=${activeProject.id}` : '';

    Promise.all([
      api.get('/tracking').then((r) => setTracking(r.data.data || [])).catch(() => setTracking([])),
      api.get(`/requisitions?estado=ENVIADA,PENDIENTE_JUST${activeProject ? `&projectId=${activeProject.id}` : ''}`)
        .then((r) => setRequisitions(r.data.data || [])).catch(() => setRequisitions([])),
      api.get(`/delegations/stats${qs}`).then((r) => setDelegStats(r.data.data)).catch(() => setDelegStats(null)),
      activeProject
        ? api.get(`/projects/${activeProject.id}/dashboard`).then((r) => setProjectDash(r.data.data)).catch(() => setProjectDash(null))
        : Promise.resolve(),
    ]).finally(() => setLoading(false));
  }, [activeProject?.id]);

  const ocActivas = tracking.length;
  const ocRojas = tracking.filter((o) => o.semaforo === 'ROJO').length;
  const ocAmarillas = tracking.filter((o) => o.semaforo === 'AMARILLO').length;
  const pendientesAprobacion = requisitions.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Sin proyecto activo
  if (!activeProject) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Selecciona un proyecto para ver el resumen operativo</p>
        </div>
        {projects.length === 0 ? (
          <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl">
            <div className="text-5xl mb-4">🏗️</div>
            <p className="text-base font-semibold text-slate-700 mb-2">Sin proyectos creados</p>
            <p className="text-sm text-slate-400 mb-4">Crea tu primer proyecto para comenzar</p>
            <Button onClick={() => navigate('/projects/new')}>Crear proyecto</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate('/projects')}
                className="bg-white rounded-xl border-2 border-slate-200 hover:border-primary p-5 text-left transition-all group"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{p.icono || '🏗️'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.nombre}</p>
                    <p className="text-xs text-slate-400">{p.contratoNo}</p>
                  </div>
                </div>
                <p className="text-xs text-primary group-hover:underline">Activar y ver dashboard →</p>
              </button>
            ))}
          </div>
        )}
        <AIBubble />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header con proyecto */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xl">{activeProject.icono || '🏗️'}</span>
            <h1 className="text-xl font-bold text-slate-800">{activeProject.nombre}</h1>
          </div>
          <p className="text-sm text-slate-500">
            {activeProject.contratoNo}
            {activeProject.entidad && ` · ${activeProject.entidad}`}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => navigate(`/projects/${activeProject.id}/dashboard`)}
        >
          Ver dashboard completo →
        </Button>
      </div>

      {/* KPIs operativos */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="OC Activas"
          value={ocActivas}
          sub="En seguimiento"
          color="text-primary"
          icon="📦"
        />
        <KpiCard
          label="Alertas Rojas"
          value={ocRojas}
          sub="Vencidas o críticas"
          color={ocRojas > 0 ? 'text-danger' : 'text-slate-800'}
          icon="🔴"
        />
        <KpiCard
          label="Req. Pendientes"
          value={pendientesAprobacion}
          sub="Esperando aprobación"
          color={pendientesAprobacion > 0 ? 'text-amber-500' : 'text-slate-800'}
          icon="📋"
        />
        <KpiCard
          label="Delegaciones"
          value={delegStats?.activas ?? 0}
          sub={delegStats?.vencidas > 0 ? `${delegStats.vencidas} vencidas` : 'Sin vencimientos'}
          color={delegStats?.vencidas > 0 ? 'text-danger' : 'text-slate-800'}
          icon="🤝"
        />
      </div>

      {/* Avance del proyecto si hay datos */}
      {projectDash && projectDash.presupuesto.itemsAPU > 0 && (
        <Card title="Avance de ejecución APU">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Presupuesto ejecutado</span>
              <span className={`font-semibold ${
                projectDash.presupuesto.pctEjecutado > 90 ? 'text-danger' :
                projectDash.presupuesto.pctEjecutado > 70 ? 'text-warning' : 'text-success'
              }`}>
                {projectDash.presupuesto.pctEjecutado}%
                {(projectDash.presupuesto.pctComprometido || 0) > 0 && (
                  <span className="text-amber-500 font-medium"> +{projectDash.presupuesto.pctComprometido}% comprometido</span>
                )}
              </span>
            </div>
            {/* Barra apilada: ejecutado (pagado) + comprometido (OC emitida sin pagar) */}
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
              <div
                className={`h-full transition-all duration-500 ${
                  projectDash.presupuesto.pctEjecutado > 90 ? 'bg-danger' :
                  projectDash.presupuesto.pctEjecutado > 70 ? 'bg-warning' : 'bg-success'
                }`}
                style={{ width: `${Math.min(100, projectDash.presupuesto.pctEjecutado)}%` }}
              />
              <div
                className="h-full bg-amber-300 transition-all duration-500"
                style={{ width: `${Math.min(100 - Math.min(100, projectDash.presupuesto.pctEjecutado), projectDash.presupuesto.pctComprometido || 0)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400 flex-wrap gap-x-3">
              <span>Ejecutado: {fmtM(projectDash.presupuesto.ejecutado)}</span>
              {(projectDash.presupuesto.comprometido || 0) > 0 && (
                <span className="text-amber-500">Comprometido: {fmtM(projectDash.presupuesto.comprometido)}</span>
              )}
              <span>Saldo: {fmtM(projectDash.presupuesto.saldo)}</span>
              <span>Total: {fmtM(projectDash.presupuesto.total)}</span>
            </div>
          </div>
        </Card>
      )}

      {/* OC con alertas */}
      {ocRojas + ocAmarillas > 0 && (
        <Card title="OC que requieren atención">
          <div className="divide-y divide-slate-100">
            {tracking
              .filter((o) => o.semaforo === 'ROJO' || o.semaforo === 'AMARILLO')
              .slice(0, 5)
              .map((orden) => (
                <div key={orden.id} className="flex items-center justify-between py-3">
                  <div>
                    <span className="text-sm font-medium text-slate-700">{orden.consecutivo}</span>
                    <span className="text-xs text-slate-400 ml-2">{orden.proveedor}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {orden.diasRestantes !== null
                        ? orden.diasRestantes < 0
                          ? `Vencida hace ${Math.abs(orden.diasRestantes)} días`
                          : `${orden.diasRestantes} días restantes`
                        : 'Sin fecha'}
                    </span>
                    <span className={`w-3 h-3 rounded-full ${orden.semaforo === 'ROJO' ? 'bg-danger' : 'bg-warning'}`} />
                  </div>
                </div>
              ))}
          </div>
        </Card>
      )}

      {/* Requisiciones pendientes */}
      {pendientesAprobacion > 0 && (
        <Card title="Requisiciones pendientes de aprobación">
          <div className="divide-y divide-slate-100">
            {requisitions.slice(0, 5).map((req) => (
              <button
                key={req.id}
                onClick={() => navigate('/requisitions')}
                className="w-full flex items-center justify-between py-3 text-left hover:bg-slate-50 transition-colors rounded-lg px-2 -mx-2"
              >
                <div>
                  <span className="text-sm font-medium text-slate-700">{req.consecutivo}</span>
                  <span className="text-xs text-slate-400 ml-2">{req.project?.nombre}</span>
                  {req.estado === 'PENDIENTE_JUST' && (
                    <span className="text-xs text-orange-600 ml-2">Pendiente justificación</span>
                  )}
                </div>
                <span className="text-xs text-slate-500">{req.solicitante?.nombre}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Órdenes de compra activas: qué se pidió y a cuánto */}
      {ocActivas > 0 && (
        <Card title="Órdenes de compra activas">
          <div className="divide-y divide-slate-100">
            {tracking.slice(0, 6).map((orden) => {
              const dot = orden.semaforo === 'ROJO' ? 'bg-danger'
                : orden.semaforo === 'AMARILLO' ? 'bg-warning'
                : orden.semaforo === 'VERDE' ? 'bg-success' : 'bg-slate-300';
              return (
                <button
                  key={orden.id}
                  onClick={() => navigate('/orders')}
                  className="w-full flex items-center justify-between py-3 text-left hover:bg-slate-50 transition-colors rounded-lg px-2 -mx-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
                      <span className="text-sm font-medium text-slate-700">{orden.consecutivo}</span>
                      <span className="text-xs text-slate-400">· {orden.proveedor}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 pl-4.5 truncate">{orden.primerItem}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-3">
                    <p className="text-sm font-semibold text-slate-700">{fmtM(orden.montoTotal)}</p>
                    <p className="text-xs text-slate-400">
                      {orden.diasRestantes !== null
                        ? orden.diasRestantes < 0
                          ? `Vencida hace ${Math.abs(orden.diasRestantes)}d`
                          : `${orden.diasRestantes}d restantes`
                        : orden.estado}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {ocActivas === 0 && pendientesAprobacion === 0 && (delegStats?.activas ?? 0) === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="text-5xl mb-3">✅</div>
          <p className="text-sm">Todo al día — sin alertas ni pendientes</p>
        </div>
      )}

      <AIBubble />
    </div>
  );
}
