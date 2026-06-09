import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const ESTADO_INFO = {
  ACTIVA:     { label: 'Activa',     cls: 'bg-green-100 text-green-700' },
  COMPLETADA: { label: 'Completada', cls: 'bg-blue-100 text-blue-700' },
  REVOCADA:   { label: 'Revocada',   cls: 'bg-slate-100 text-slate-500' },
};

const fmtD = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function EstadoBadge({ estado }) {
  const info = ESTADO_INFO[estado] || ESTADO_INFO.ACTIVA;
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${info.cls}`}>{info.label}</span>
  );
}

function VencimientoBadge({ fechaLimite, estado }) {
  if (!fechaLimite || estado !== 'ACTIVA') return null;
  const dias = Math.ceil((new Date(fechaLimite) - Date.now()) / 86400000);
  if (dias < 0) return <span className="text-xs text-danger font-medium">Vencida ({Math.abs(dias)}d)</span>;
  if (dias <= 2) return <span className="text-xs text-warning font-medium">Vence en {dias}d</span>;
  return <span className="text-xs text-slate-400">{fmtD(fechaLimite)}</span>;
}

export default function DelegationList() {
  const user = useAuthStore((s) => s.user);
  const { activeProject, projects } = useProjectStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [delegations, setDelegations] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({
    projectId: searchParams.get('projectId') || activeProject?.id || '',
    estado: '',
    vista: 'todas', // 'todas' | 'dadas' | 'recibidas'
  });
  const [actionLoading, setActionLoading] = useState(null);
  const [notasModal, setNotasModal] = useState(null); // { id, targetEstado }
  const [notas, setNotas] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter.projectId) params.set('projectId', filter.projectId);
      if (filter.estado) params.set('estado', filter.estado);
      if (filter.vista === 'dadas') params.set('deleganteId', user.id);
      if (filter.vista === 'recibidas') params.set('delegadoId', user.id);

      const [delRes, statsRes] = await Promise.all([
        api.get(`/delegations?${params}`),
        api.get(`/delegations/stats?${filter.projectId ? `projectId=${filter.projectId}` : ''}`),
      ]);
      setDelegations(delRes.data.data || []);
      setStats(statsRes.data.data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter]);

  const handleEstado = async (id, estado) => {
    if (['COMPLETADA', 'REVOCADA'].includes(estado)) {
      setNotasModal({ id, targetEstado: estado });
      setNotas('');
      return;
    }
    await cambiarEstado(id, estado, '');
  };

  const cambiarEstado = async (id, estado, notas) => {
    setActionLoading(id);
    try {
      await api.put(`/delegations/${id}/estado`, { estado, notas });
      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al actualizar');
    } finally {
      setActionLoading(null);
      setNotasModal(null);
    }
  };

  const canChangeEstado = (d) => d.deleganteId === user?.id || d.delegadoId === user?.id;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Delegaciones</h1>
          <p className="text-sm text-slate-500 mt-0.5">Trazabilidad de tareas delegadas</p>
        </div>
        <Link to="/delegations/new">
          <Button>+ Nueva delegación</Button>
        </Link>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total', val: stats.total, cls: 'text-slate-800' },
            { label: 'Activas', val: stats.activas, cls: 'text-green-700' },
            { label: 'Completadas', val: stats.completadas, cls: 'text-blue-700' },
            { label: 'Vencidas', val: stats.vencidas, cls: stats.vencidas > 0 ? 'text-danger' : 'text-slate-800' },
          ].map(({ label, val, cls }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">{label}</p>
              <p className={`text-2xl font-bold ${cls}`}>{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <select
          value={filter.projectId}
          onChange={(e) => setFilter((p) => ({ ...p, projectId: e.target.value }))}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos los proyectos</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.icono || '🏗️'} {p.nombre}</option>
          ))}
        </select>
        <select
          value={filter.estado}
          onChange={(e) => setFilter((p) => ({ ...p, estado: e.target.value }))}
          className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos los estados</option>
          <option value="ACTIVA">Activas</option>
          <option value="COMPLETADA">Completadas</option>
          <option value="REVOCADA">Revocadas</option>
        </select>
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
          {[['todas', 'Todas'], ['dadas', 'Dadas'], ['recibidas', 'Recibidas']].map(([v, l]) => (
            <button
              key={v}
              onClick={() => setFilter((p) => ({ ...p, vista: v }))}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
                filter.vista === v
                  ? 'bg-white text-slate-800 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : delegations.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🤝</div>
            <p className="text-sm font-medium text-slate-600 mb-1">Sin delegaciones</p>
            <p className="text-xs text-slate-400">Crea una delegación para asignar tareas a tu equipo</p>
          </div>
        ) : (
          <div className="space-y-2">
            {delegations.map((d) => {
              const isVencida = d.estado === 'ACTIVA' && d.fechaLimite && new Date(d.fechaLimite) < new Date();
              return (
                <div
                  key={d.id}
                  className={`p-4 rounded-xl border transition-colors ${
                    isVencida ? 'border-red-200 bg-red-50' : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <EstadoBadge estado={d.estado} />
                        <span className="text-xs text-slate-400">
                          {d.project?.icono || '🏗️'} {d.project?.nombre}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mb-0.5">{d.tarea}</p>
                      {d.descripcion && (
                        <p className="text-xs text-slate-500 mb-2">{d.descripcion}</p>
                      )}
                      <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
                        <span>
                          <span className="font-medium text-slate-600">{d.delegante?.nombre}</span>
                          {' → '}
                          <span className="font-medium text-slate-600">{d.delegado?.nombre}</span>
                        </span>
                        <span className="text-slate-300">·</span>
                        <VencimientoBadge fechaLimite={d.fechaLimite} estado={d.estado} />
                        <span className="text-slate-300">·</span>
                        <span>{new Date(d.createdAt).toLocaleDateString('es-CO')}</span>
                      </div>
                      {d.notas && (
                        <p className="text-xs text-slate-500 italic mt-1 border-l-2 border-slate-200 pl-2">
                          {d.notas}
                        </p>
                      )}
                      {d.fechaComplecion && (
                        <p className="text-xs text-slate-400 mt-1">
                          ✅ Completada: {fmtD(d.fechaComplecion)}
                        </p>
                      )}
                    </div>
                    {canChangeEstado(d) && d.estado === 'ACTIVA' && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="success"
                          loading={actionLoading === d.id}
                          onClick={() => handleEstado(d.id, 'COMPLETADA')}
                        >
                          ✓ Completar
                        </Button>
                        {d.deleganteId === user?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={actionLoading === d.id}
                            onClick={() => handleEstado(d.id, 'REVOCADA')}
                          >
                            Revocar
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal de notas */}
      {notasModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-1">
              {notasModal.targetEstado === 'COMPLETADA' ? '✅ Completar delegación' : '⛔ Revocar delegación'}
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Agrega notas opcionales sobre el cierre de esta delegación.
            </p>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              placeholder="Notas de cierre (opcional)…"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none mb-4"
            />
            <div className="flex gap-3">
              <Button
                loading={actionLoading !== null}
                onClick={() => cambiarEstado(notasModal.id, notasModal.targetEstado, notas)}
                variant={notasModal.targetEstado === 'COMPLETADA' ? 'success' : 'danger'}
              >
                Confirmar
              </Button>
              <Button variant="secondary" onClick={() => setNotasModal(null)}>Cancelar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
