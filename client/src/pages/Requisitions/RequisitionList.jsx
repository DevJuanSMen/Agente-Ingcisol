import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore, useCan } from '../../store/authStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

// ─── Línea de tiempo del proceso de compra ────────────────────────────────────

const PIPELINE = [
  { estado: 'ENVIADA', label: 'Enviada' },
  { estado: 'EN_COTIZACION', label: 'En cotización' },
  { estado: 'OC_EMITIDA', label: 'OC emitida' },
  { estado: 'CERRADA', label: 'Cerrada' },
];

// Posición de cada estado dentro del pipeline (estados previos quedan marcados)
const ESTADO_POS = {
  BORRADOR: -1, PENDIENTE_JUST: 0, ENVIADA: 0, APROBADA: 1,
  EN_COTIZACION: 1, OC_EMITIDA: 2, CERRADA: 3,
};

function StatusTimeline({ estado }) {
  if (estado === 'RECHAZADA') {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
        <span>❌</span>
        <p className="text-xs text-red-700 font-medium">Requisición rechazada</p>
      </div>
    );
  }
  if (estado === 'EXPIRADA') {
    return (
      <div className="flex items-center gap-2 p-3 bg-zinc-100 border border-zinc-300 rounded-lg">
        <span>⏰</span>
        <p className="text-xs text-zinc-700 font-medium">
          Requisición expirada — pasó la fecha límite. Extiende la fecha para reactivarla.
        </p>
      </div>
    );
  }
  const pos = ESTADO_POS[estado] ?? 0;
  return (
    <div className="flex items-center">
      {PIPELINE.map((step, i) => (
        <div key={step.estado} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
              i < pos ? 'bg-success border-success text-white'
              : i === pos ? 'bg-primary border-primary text-white'
              : 'bg-white border-slate-200 text-slate-300'
            }`}>
              {i < pos ? '✓' : i + 1}
            </span>
            <span className={`text-[10px] mt-1 whitespace-nowrap ${i <= pos ? 'text-slate-700 font-medium' : 'text-slate-300'}`}>
              {step.label}
            </span>
          </div>
          {i < PIPELINE.length - 1 && (
            <div className={`flex-1 h-0.5 mx-1.5 mb-4 ${i < pos ? 'bg-success' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Modal de detalle: estado + análisis del agente ───────────────────────────

const VEREDICTO_STYLE = {
  DENTRO_PRESUPUESTO: { icon: '✅', cls: 'text-green-700 bg-green-50 border-green-200' },
  EXCEDE_SALDO: { icon: '⚠️', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  FUERA_APU: { icon: '🚫', cls: 'text-red-700 bg-red-50 border-red-200' },
};

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;

function DetailModal({ requisitionId, onClose }) {
  const [req, setReq] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get(`/requisitions/${requisitionId}`).then((r) => setReq(r.data.data)),
      api.get(`/requisitions/${requisitionId}/analysis`).then((r) => setAnalysis(r.data.data)).catch(() => setAnalysis(null)),
    ]).finally(() => setLoading(false));
  }, [requisitionId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-800">
              {req?.consecutivo || 'Requisición'}
            </h2>
            {req && <Badge status={req.estado} />}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !req ? (
            <p className="text-sm text-slate-400 text-center py-8">Error al cargar la requisición</p>
          ) : (
            <>
              {/* Estado del proceso */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-3 uppercase tracking-wide">Estado del proceso</p>
                <StatusTimeline estado={req.estado} />
                {req.motivoRechazo && (
                  <p className="text-xs text-red-600 mt-2">Motivo: {req.motivoRechazo}</p>
                )}
              </div>

              {/* Seguimiento de cotización */}
              {req.quotation && (
                <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span>💬</span>
                    <p className="text-xs text-purple-800 font-medium">Proceso de cotización</p>
                  </div>
                  <Badge status={req.quotation.estado} />
                </div>
              )}

              {/* Análisis del agente */}
              {analysis && (
                <div>
                  <p className="text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wide">
                    🤖 Análisis del agente — Insumos vs Presupuesto APU
                  </p>
                  <div className={`p-3 rounded-lg border mb-3 ${
                    analysis.conforme ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
                  }`}>
                    <p className={`text-xs font-medium ${analysis.conforme ? 'text-green-800' : 'text-amber-800'}`}>
                      {analysis.conforme ? '✅' : '⚠️'} {analysis.resumen}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {analysis.items.map((item) => {
                      const style = VEREDICTO_STYLE[item.veredicto] || VEREDICTO_STYLE.FUERA_APU;
                      return (
                        <div key={item.id} className={`p-3 rounded-lg border ${style.cls}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold">
                                {style.icon} {item.descripcion}
                                {item.codigoAPU && <span className="font-normal opacity-70"> · APU {item.codigoAPU}</span>}
                              </p>
                              <p className="text-xs mt-1 opacity-80">{item.detalle}</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-xs font-medium">{item.cantidad} {item.unidad}</p>
                              {item.valorEstimado !== undefined && (
                                <p className="text-[10px] opacity-70">{fmtCOP(item.valorEstimado)}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Datos generales */}
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <p><span className="text-slate-400">Proyecto:</span> {req.project?.nombre}</p>
                <p><span className="text-slate-400">Solicitante:</span> {req.solicitante?.nombre}</p>
                {req.aprobador && <p><span className="text-slate-400">Aprobada por:</span> {req.aprobador.nombre}</p>}
                <p><span className="text-slate-400">Prioridad:</span> {req.prioridad}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RequisitionList() {
  const user = useAuthStore((s) => s.user);
  const canApprove = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const canCreate = useCan('requisitions', 'crear');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const load = () => {
    setLoading(true);
    api.get('/requisitions')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id) => {
    setActionLoading(id + '_approve');
    try {
      await api.put(`/requisitions/${id}/approve`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al aprobar');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id) => {
    const motivo = prompt('Motivo del rechazo:');
    if (!motivo) return;
    setActionLoading(id + '_reject');
    try {
      await api.put(`/requisitions/${id}/reject`, { motivo });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al rechazar');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExtend = async (id) => {
    const hoy = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const fecha = prompt('Nueva fecha límite (AAAA-MM-DD):', hoy);
    if (!fecha) return;
    setActionLoading(id + '_extend');
    try {
      await api.put(`/requisitions/${id}/extend`, { fechaLimite: fecha });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al extender la fecha');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta requisición? Esta acción no se puede deshacer.')) return;
    setActionLoading(id + '_delete');
    try {
      await api.delete(`/requisitions/${id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al eliminar');
    } finally {
      setActionLoading(null);
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';
  const isVencida = (d) => d && new Date(d).getTime() < Date.now();

  const columns = [
    { key: 'consecutivo', label: 'Consecutivo' },
    { key: 'project', label: 'Proyecto', render: (r) => r.project?.nombre || '—' },
    { key: 'solicitante', label: 'Solicitante', render: (r) => r.solicitante?.nombre || '—' },
    { key: 'estado', label: 'Estado', render: (r) => <Badge status={r.estado} /> },
    { key: 'prioridad', label: 'Prioridad', render: (r) => (
      <span className={`text-xs font-medium ${r.prioridad === 'ALTA' ? 'text-red-600' : r.prioridad === 'MEDIA' ? 'text-yellow-600' : 'text-slate-500'}`}>
        {r.prioridad}
      </span>
    )},
    { key: 'createdAt', label: 'Fecha', render: (r) => fmt(r.createdAt) },
    { key: 'fechaLimite', label: 'Vence', render: (r) => (
      r.fechaLimite ? (
        <span className={`text-xs ${r.estado === 'EXPIRADA' || isVencida(r.fechaLimite) ? 'text-red-600 font-medium' : 'text-slate-600'}`}>
          {fmt(r.fechaLimite)}
        </span>
      ) : <span className="text-xs text-slate-300">—</span>
    )},
    { key: 'actions', label: 'Acciones', render: (r) => (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setDetailId(r.id)}>
          Ver
        </Button>
        {canApprove && ['ENVIADA', 'PENDIENTE_JUST'].includes(r.estado) && (
          <>
            <Button
              size="sm"
              variant="success"
              loading={actionLoading === r.id + '_approve'}
              onClick={() => handleApprove(r.id)}
            >
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="danger"
              loading={actionLoading === r.id + '_reject'}
              onClick={() => handleReject(r.id)}
            >
              Rechazar
            </Button>
          </>
        )}
        {r.estado === 'EXPIRADA' && (
          <Button
            size="sm"
            variant="primary"
            loading={actionLoading === r.id + '_extend'}
            onClick={() => handleExtend(r.id)}
          >
            Extender fecha
          </Button>
        )}
        {canApprove && !['OC_EMITIDA', 'CERRADA'].includes(r.estado) && (
          <Button
            size="sm"
            variant="ghost"
            loading={actionLoading === r.id + '_delete'}
            onClick={() => handleDelete(r.id)}
          >
            🗑️
          </Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Requisiciones</h1>
          <p className="text-sm text-slate-500 mt-0.5">{data.length} registros</p>
        </div>
        {canCreate && (
          <Link to="/requisitions/new">
            <Button>+ Nueva requisición</Button>
          </Link>
        )}
      </div>

      <Card>
        <Table columns={columns} data={data} loading={loading} emptyMessage="Sin requisiciones" />
      </Card>

      {detailId && <DetailModal requisitionId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
