import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';

const TIPO_ICON = {
  REQUISICION_CREADA: '📋',
  REQUISICION_APROBADA: '✅',
  REQUISICION_RECHAZADA: '❌',
  COTIZACION_INICIADA: '💬',
  COTIZACION_APROBADA: '💬',
  OC_EMITIDA: '📦',
  OC_ENTREGADA: '🚚',
  OC_PAGADA: '💰',
};

// A qué pantalla lleva cada tipo de notificación
const TIPO_ROUTE = {
  REQUISICION_CREADA: '/requisitions',
  REQUISICION_APROBADA: '/requisitions',
  REQUISICION_RECHAZADA: '/requisitions',
  COTIZACION_INICIADA: '/quotations',
  COTIZACION_APROBADA: '/quotations',
  OC_EMITIDA: '/orders',
  OC_ENTREGADA: '/orders',
  OC_PAGADA: '/orders',
};

const timeAgo = (d) => {
  const mins = Math.floor((Date.now() - new Date(d)) / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs} h`;
  return new Date(d).toLocaleDateString('es-CO');
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef();
  const navigate = useNavigate();

  const loadCount = () => {
    api.get('/notifications/unread-count')
      .then((r) => setUnread(r.data.data.count || 0))
      .catch(() => {});
  };

  const loadList = () => {
    api.get('/notifications')
      .then((r) => setItems(r.data.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadCount();
    const interval = setInterval(loadCount, 30000);
    return () => clearInterval(interval);
  }, []);

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) loadList();
  };

  const handleClick = async (n) => {
    if (!n.leida) {
      api.put(`/notifications/${n.id}/read`).catch(() => {});
      setUnread((c) => Math.max(0, c - 1));
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, leida: true } : i)));
    }
    setOpen(false);
    navigate(TIPO_ROUTE[n.tipo] || '/');
  };

  const handleReadAll = async () => {
    await api.put('/notifications/read-all').catch(() => {});
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, leida: true })));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Notificaciones"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="text-sm font-semibold text-slate-800">Notificaciones</p>
            {unread > 0 && (
              <button onClick={handleReadAll} className="text-xs text-primary hover:underline">
                Marcar todas leídas
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center text-slate-400">
                <div className="text-2xl mb-2">🔕</div>
                <p className="text-xs">Sin notificaciones</p>
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                    !n.leida ? 'bg-blue-50/50' : ''
                  }`}
                >
                  <span className="text-lg flex-shrink-0">{TIPO_ICON[n.tipo] || '🔔'}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs ${!n.leida ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
                      {n.titulo}
                    </p>
                    {n.mensaje && <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{n.mensaje}</p>}
                    <p className="text-[10px] text-slate-300 mt-1">{timeAgo(n.createdAt)}</p>
                  </div>
                  {!n.leida && <span className="w-2 h-2 bg-primary rounded-full flex-shrink-0 mt-1" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
