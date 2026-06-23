import { useEffect, useMemo, useState } from 'react';
import api from '../../api/client';

const fmtCOP = (v) => (v ? `$${Number(v).toLocaleString('es-CO')}` : '—');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('es-CO') : '—');

// Pasos del flujo de una requisición (semáforo de seguimiento)
const STEPS = ['Solicitud', 'Aprobación', 'Cotización', 'Orden de compra', 'Entrega'];

// Estado de la requisición → índice del paso alcanzado
const ESTADO_STEP = {
  BORRADOR: 0,
  PENDIENTE_JUST: 0,
  ENVIADA: 1,
  APROBADA: 2,
  EN_COTIZACION: 2,
  OC_EMITIDA: 3,
  CERRADA: 4,
};

const ESTADO_LABEL = {
  BORRADOR: 'Borrador',
  PENDIENTE_JUST: 'Pendiente justificación',
  ENVIADA: 'Enviada para aprobación',
  APROBADA: 'Aprobada',
  EN_COTIZACION: 'En cotización',
  OC_EMITIDA: 'OC emitida',
  CERRADA: 'Cerrada',
};

const PRIORIDAD_STYLE = {
  ALTA: 'bg-red-50 text-red-600 border-red-200',
  MEDIA: 'bg-amber-50 text-amber-600 border-amber-200',
  BAJA: 'bg-slate-50 text-slate-500 border-slate-200',
};

const COT_STYLE = {
  EN_BUSQUEDA: 'bg-blue-50 text-blue-600',
  PENDIENTE_APROBACION: 'bg-amber-50 text-amber-600',
  APROBADA: 'bg-green-50 text-green-600',
  RECHAZADA: 'bg-red-50 text-red-600',
};

const OC_ESTADO_STYLE = {
  EMITIDA: 'bg-blue-50 text-blue-600',
  ENVIADA: 'bg-indigo-50 text-indigo-600',
  ENTREGADA: 'bg-teal-50 text-teal-600',
  PAGADA: 'bg-green-50 text-green-600',
  COMPLETADA: 'bg-green-50 text-green-600',
  CANCELADA: 'bg-slate-100 text-slate-400 line-through',
};

const SEMAFORO_DOT = { ROJO: 'bg-danger', AMARILLO: 'bg-warning', VERDE: 'bg-success' };

// Stepper horizontal compacto
function Stepper({ estado, entregada }) {
  let current = ESTADO_STEP[estado] ?? 0;
  if (entregada) current = 4;

  return (
    <div className="flex items-center">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors
                  ${done ? 'bg-primary text-white' : active ? 'bg-primary/15 text-primary ring-2 ring-primary' : 'bg-slate-100 text-slate-400'}`}
              >
                {done ? '✓' : i + 1}
              </div>
              <span className={`mt-1 text-[10px] whitespace-nowrap ${active ? 'text-primary font-semibold' : 'text-slate-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 ${i < current ? 'bg-primary' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function RequisitionCard({ req }) {
  const entregada = req.ordenes.some((o) => ['ENTREGADA', 'PAGADA', 'COMPLETADA'].includes(o.estado));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-800">{req.consecutivo}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${PRIORIDAD_STYLE[req.prioridad] || PRIORIDAD_STYLE.BAJA}`}>
              {req.prioridad}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {req.proyecto} · {req.solicitante} · {req.totalItems} ítem{req.totalItems === 1 ? '' : 's'}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <span className="text-xs font-semibold text-primary">{ESTADO_LABEL[req.estado] || req.estado}</span>
          {req.cotizacionEstado && (
            <span className={`block mt-1 text-[10px] px-2 py-0.5 rounded-full ${COT_STYLE[req.cotizacionEstado] || 'bg-slate-100 text-slate-500'}`}>
              Cotización: {req.cotizacionEstado.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
        </div>
      </div>

      <div className="px-1 py-2">
        <Stepper estado={req.estado} entregada={entregada} />
      </div>

      {req.ordenes.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Órdenes de compra</p>
          {req.ordenes.map((o) => (
            <div key={o.id} className="flex items-center gap-2 text-xs">
              {o.semaforo && <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${SEMAFORO_DOT[o.semaforo] || 'bg-slate-300'}`} />}
              <span className="font-medium text-slate-700">{o.consecutivo}</span>
              <span className={`px-1.5 py-0.5 rounded ${OC_ESTADO_STYLE[o.estado] || 'bg-slate-100 text-slate-500'}`}>{o.estado}</span>
              <span className="text-slate-500 truncate flex-1">{o.proveedor}</span>
              <span className="text-slate-700 font-medium whitespace-nowrap">{fmtCOP(o.montoTotal)}</span>
              {['EMITIDA', 'ENVIADA'].includes(o.estado) && o.diasRestantes !== null && (
                <span className="text-slate-400 whitespace-nowrap">
                  {o.diasRestantes < 0 ? `vencida ${Math.abs(o.diasRestantes)}d` : o.diasRestantes === 0 ? 'hoy' : `${o.diasRestantes}d`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrackingBoard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('TODAS');

  useEffect(() => {
    api.get('/tracking')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  const filtros = useMemo(() => ([
    { key: 'TODAS', label: 'Todas', count: data.length },
    { key: 'EN_COTIZACION', label: 'En cotización', count: data.filter((r) => r.estado === 'EN_COTIZACION').length },
    { key: 'OC_EMITIDA', label: 'OC emitida', count: data.filter((r) => r.estado === 'OC_EMITIDA').length },
    { key: 'PENDIENTES', label: 'Por aprobar', count: data.filter((r) => ['ENVIADA', 'BORRADOR', 'PENDIENTE_JUST'].includes(r.estado)).length },
  ]), [data]);

  const visibles = data.filter((r) => {
    if (filtro === 'TODAS') return true;
    if (filtro === 'PENDIENTES') return ['ENVIADA', 'BORRADOR', 'PENDIENTE_JUST'].includes(r.estado);
    return r.estado === filtro;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Seguimiento</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.length} requisiciones activas y sus órdenes de compra</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {filtros.map((f) => (
          <button
            key={f.key}
            onClick={() => setFiltro(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filtro === f.key ? 'bg-primary text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label} <span className="opacity-70">({f.count})</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="text-5xl mb-3">🚦</div>
          <p className="text-sm">Sin requisiciones activas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibles.map((req) => <RequisitionCard key={req.id} req={req} />)}
        </div>
      )}
    </div>
  );
}
