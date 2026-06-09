import { useEffect, useState } from 'react';
import api from '../../api/client';

const SEMAFORO_CONFIG = {
  ROJO:     { label: 'Vencidas', color: 'border-red-400 bg-red-50', dot: 'bg-danger',   textColor: 'text-red-700' },
  AMARILLO: { label: '1–4 días', color: 'border-yellow-400 bg-yellow-50', dot: 'bg-warning', textColor: 'text-yellow-700' },
  VERDE:    { label: '≥ 5 días', color: 'border-green-400 bg-green-50', dot: 'bg-success', textColor: 'text-green-700' },
  SIN_FECHA:{ label: 'Sin fecha', color: 'border-slate-300 bg-slate-50', dot: 'bg-slate-400', textColor: 'text-slate-500' },
};

const OcCard = ({ orden }) => {
  const config = SEMAFORO_CONFIG[orden.semaforo] || SEMAFORO_CONFIG.SIN_FECHA;
  const fmtCOP = (v) => v ? `$${Number(v).toLocaleString('es-CO')}` : '—';

  return (
    <div className={`rounded-xl border-l-4 p-4 ${config.color}`}>
      <div className="flex items-start justify-between mb-2">
        <span className="text-sm font-semibold text-slate-800">{orden.consecutivo}</span>
        <span className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${config.dot}`} />
      </div>
      <p className="text-xs text-slate-600 mb-1">{orden.proveedor}</p>
      <p className="text-xs text-slate-500 mb-1 truncate">{orden.primerItem}</p>
      <p className="text-xs font-medium text-slate-700">{fmtCOP(orden.montoTotal)}</p>
      {orden.diasRestantes !== null && (
        <p className={`text-xs mt-2 font-medium ${config.textColor}`}>
          {orden.diasRestantes < 0
            ? `Vencida hace ${Math.abs(orden.diasRestantes)} días`
            : orden.diasRestantes === 0
            ? 'Vence hoy'
            : `${orden.diasRestantes} días restantes`}
        </p>
      )}
    </div>
  );
};

const Column = ({ semaforo, orders }) => {
  const config = SEMAFORO_CONFIG[semaforo];
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-3 h-3 rounded-full ${config.dot}`} />
        <h3 className="text-sm font-semibold text-slate-700">{config.label}</h3>
        <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
          {orders.length}
        </span>
      </div>
      <div className="space-y-3">
        {orders.length === 0 ? (
          <div className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
            Sin OC
          </div>
        ) : (
          orders.map((o) => <OcCard key={o.id} orden={o} />)
        )}
      </div>
    </div>
  );
};

export default function TrackingBoard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tracking')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  const byColor = {
    ROJO:     data.filter((o) => o.semaforo === 'ROJO'),
    AMARILLO: data.filter((o) => o.semaforo === 'AMARILLO'),
    VERDE:    data.filter((o) => o.semaforo === 'VERDE'),
    SIN_FECHA:data.filter((o) => o.semaforo === 'SIN_FECHA'),
  };

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
        <h1 className="text-xl font-bold text-slate-800">Seguimiento de Entregas</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.length} OC activas</p>
      </div>

      {data.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <div className="text-5xl mb-3">🚦</div>
          <p className="text-sm">Sin órdenes de compra activas</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          {Object.entries(byColor).map(([semaforo, orders]) => (
            <Column key={semaforo} semaforo={semaforo} orders={orders} />
          ))}
        </div>
      )}
    </div>
  );
}
