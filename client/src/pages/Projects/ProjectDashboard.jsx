import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const fmtM = (v) => {
  const n = Number(v || 0);
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}MM`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return fmtCOP(n);
};
const fmtD = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const ESTADO_LABEL = {
  PLANIFICADO: { label: 'Planificado', cls: 'bg-slate-100 text-slate-600' },
  EN_EJECUCION: { label: 'En ejecución', cls: 'bg-green-100 text-green-700' },
  FINALIZADO: { label: 'Finalizado', cls: 'bg-blue-100 text-blue-700' },
  SUSPENDIDO: { label: 'Suspendido', cls: 'bg-red-100 text-red-600' },
};

function KpiCard({ label, value, sub, color = 'text-slate-800', icon }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function ProgressBar({ value, color = 'bg-primary', label }) {
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-xs text-slate-500"><span>{label}</span><span>{value}%</span></div>}
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}

export default function ProjectDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const canEdit = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/projects/${id}/dashboard`)
      .then(({ data: res }) => setData(res.data))
      .catch(() => setError('No se pudo cargar el dashboard del proyecto'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-500 mb-4">{error || 'Proyecto no encontrado'}</p>
        <Button variant="secondary" onClick={() => navigate('/projects')}>Volver a proyectos</Button>
      </div>
    );
  }

  const { proyecto, presupuesto, ordenes, delegaciones, requisiciones, presupuestosHojas, pctTiempo } = data;
  const estadoInfo = ESTADO_LABEL[proyecto.estado] || ESTADO_LABEL.PLANIFICADO;

  const pctPresupuesto = presupuesto.pctEjecutado;
  const presupuestoColor = pctPresupuesto > 90 ? 'bg-danger' : pctPresupuesto > 70 ? 'bg-warning' : 'bg-success';

  return (
    <div className="space-y-6">
      {/* Header del proyecto */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{proyecto.icono || '🏗️'}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-slate-800">{proyecto.nombre}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${estadoInfo.cls}`}>
                {estadoInfo.label}
              </span>
              {proyecto.activo && (
                <span className="text-xs bg-primary/10 text-primary font-medium px-2 py-0.5 rounded-full">
                  Activo
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400 mt-0.5">
              {proyecto.contratoNo} {proyecto.entidad && `· ${proyecto.entidad}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => navigate(`/projects/${id}/budget`)}>
            📊 Presupuesto
          </Button>
          {canEdit && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/projects/${id}/edit`)}>
              ✏️ Editar
            </Button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Valor contrato"
          value={fmtM(proyecto.valor)}
          sub={proyecto.valor ? fmtCOP(proyecto.valor) : 'Sin valor registrado'}
          icon="💰"
        />
        <KpiCard
          label="Ejecutado APU"
          value={`${pctPresupuesto}%`}
          sub={`${fmtM(presupuesto.ejecutado)} de ${fmtM(presupuesto.total)}`}
          color={pctPresupuesto > 90 ? 'text-danger' : pctPresupuesto > 70 ? 'text-warning' : 'text-success'}
          icon="📐"
        />
        <KpiCard
          label="OC Activas"
          value={ordenes.activas}
          sub={ordenes.vencidas > 0 ? `${ordenes.vencidas} vencidas` : 'Sin vencimientos'}
          color={ordenes.vencidas > 0 ? 'text-danger' : 'text-slate-800'}
          icon="📦"
        />
        <KpiCard
          label="Requisiciones"
          value={requisiciones}
          sub="Total del proyecto"
          icon="📋"
        />
      </div>

      {/* Barras de avance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Avance de ejecución">
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600 font-medium">Presupuesto APU ejecutado</span>
                <span className={`font-semibold ${pctPresupuesto > 90 ? 'text-danger' : pctPresupuesto > 70 ? 'text-warning' : 'text-success'}`}>
                  {pctPresupuesto}%
                </span>
              </div>
              <ProgressBar value={pctPresupuesto} color={presupuestoColor} />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>Ejecutado: {fmtM(presupuesto.ejecutado)}</span>
                <span>Saldo: {fmtM(presupuesto.saldo)}</span>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-slate-600 font-medium">Avance temporal del contrato</span>
                <span className="font-semibold text-slate-700">{pctTiempo}%</span>
              </div>
              <ProgressBar value={pctTiempo} color="bg-primary" />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>Inicio: {fmtD(proyecto.inicio)}</span>
                <span>Fin: {fmtD(proyecto.fin)}</span>
              </div>
            </div>

            {presupuesto.itemsAPU > 0 && pctPresupuesto > pctTiempo + 10 && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                ⚠️ La ejecución de presupuesto ({pctPresupuesto}%) supera el avance temporal ({pctTiempo}%) en más del 10%
              </div>
            )}
          </div>
        </Card>

        <Card title="Delegaciones activas">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-slate-800">{delegaciones.activas}</p>
                <p className="text-xs text-slate-500 mt-0.5">Activas</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${delegaciones.vencidas > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                <p className={`text-2xl font-bold ${delegaciones.vencidas > 0 ? 'text-danger' : 'text-slate-800'}`}>
                  {delegaciones.vencidas}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Vencidas</p>
              </div>
            </div>
            {delegaciones.activas > 0 && (
              <Link to={`/delegations?projectId=${id}`}>
                <Button size="sm" variant="secondary" className="w-full justify-center">
                  Ver delegaciones →
                </Button>
              </Link>
            )}
            {delegaciones.activas === 0 && (
              <div className="text-center py-4 text-slate-400 text-xs">
                Sin delegaciones activas
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Hojas de presupuesto */}
      {presupuestosHojas?.length > 0 && (
        <Card title={`Hojas de presupuesto (${presupuestosHojas.length})`}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {presupuestosHojas.map((hoja) => (
              <div
                key={hoja.id}
                className="flex items-center gap-2 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
                onClick={() => navigate(`/projects/${id}/budget`)}
              >
                <span className="text-lg">📋</span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{hoja.nombre}</p>
                  <p className="text-xs text-slate-400">Hoja {hoja.orden + 1}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sin APU cargado */}
      {presupuesto.itemsAPU === 0 && (
        <div className="text-center py-8 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-sm text-amber-700 font-medium">⚠️ Sin ítems APU cargados</p>
          <p className="text-xs text-amber-600 mt-1 mb-3">Importa el presupuesto para ver el avance de ejecución</p>
          <Button size="sm" onClick={() => navigate('/apu')}>Ir a APU</Button>
        </div>
      )}
    </div>
  );
}
