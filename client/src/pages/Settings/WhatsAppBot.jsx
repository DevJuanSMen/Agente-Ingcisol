import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const STATUS_LABEL = {
  disconnected: { text: 'Desconectado', color: 'text-red-500', dot: 'bg-red-500' },
  qr_waiting: { text: 'Esperando escaneo QR', color: 'text-yellow-500', dot: 'bg-yellow-400 animate-pulse' },
  authenticated: { text: 'Autenticado', color: 'text-blue-500', dot: 'bg-blue-500' },
  ready: { text: 'Conectado y listo', color: 'text-green-500', dot: 'bg-green-500' },
  error: { text: 'Error', color: 'text-red-600', dot: 'bg-red-600' },
};

export default function WhatsAppBot() {
  const [state, setState] = useState({ enabled: false, status: 'disconnected', qr: null });
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/whatsapp/status');
      setState(data.data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Polling cada 5 segundos cuando está esperando QR
  useEffect(() => {
    if (state.status !== 'qr_waiting' && state.status !== 'authenticated') return;
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [state.status, fetchStatus]);

  const toggle = async () => {
    setToggling(true);
    try {
      const endpoint = state.enabled ? '/whatsapp/disable' : '/whatsapp/enable';
      const { data } = await api.post(endpoint);
      setState((prev) => ({ ...prev, enabled: data.data.enabled }));
    } finally {
      setToggling(false);
    }
  };

  const s = STATUS_LABEL[state.status] || STATUS_LABEL.disconnected;

  return (
    <div className="space-y-5 max-w-lg">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Bot de WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Gestiona el asistente automático de WhatsApp de PROCURA AI
        </p>
      </div>

      <Card>
        <div className="space-y-5">
          {/* Estado de conexión */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
              <div>
                <p className="text-sm font-medium text-slate-700">Estado de conexión</p>
                <p className={`text-xs ${s.color}`}>{s.text}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={fetchStatus} loading={loading}>
              Actualizar
            </Button>
          </div>

          {/* Switch encendido / apagado */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {state.enabled ? 'Bot activo' : 'Bot desactivado'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {state.enabled
                  ? 'Respondiendo mensajes de usuarios registrados'
                  : 'Solo responde a "activar modo pruebas"'}
              </p>
            </div>
            <button
              onClick={toggle}
              disabled={toggling}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                state.enabled ? 'bg-primary' : 'bg-slate-300'
              } ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                  state.enabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* QR Code */}
          {state.status === 'qr_waiting' && state.qr && (
            <div className="text-center space-y-3">
              <p className="text-sm font-medium text-slate-700">
                Escanea este código con WhatsApp
              </p>
              <p className="text-xs text-slate-500">
                Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo
              </p>
              <div className="inline-block p-3 bg-white border-2 border-slate-200 rounded-xl">
                <img src={state.qr} alt="QR WhatsApp" className="w-52 h-52" />
              </div>
              <p className="text-xs text-slate-400">El QR expira en 2 minutos. Actualizando automáticamente...</p>
            </div>
          )}

          {state.status === 'ready' && (
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
              <span className="text-2xl">✅</span>
              <div>
                <p className="text-sm font-medium text-green-800">WhatsApp conectado</p>
                <p className="text-xs text-green-600">El bot está listo para recibir mensajes</p>
              </div>
            </div>
          )}

          {state.status === 'disconnected' && (
            <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-2xl">📱</span>
              <div>
                <p className="text-sm font-medium text-slate-700">Sin conexión</p>
                <p className="text-xs text-slate-500">
                  El worker del bot está iniciando. En un momento aparecerá el QR.
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Comandos disponibles */}
      <Card title="Comandos del bot">
        <div className="space-y-2 text-sm">
          {[
            { cmd: 'proyectos', desc: 'Lista todos los proyectos' },
            { cmd: 'presupuesto', desc: 'Resumen del proyecto activo' },
            { cmd: 'apu <código>', desc: 'Detalle de un ítem APU' },
            { cmd: 'apus', desc: 'Lista los primeros 10 ítems APU' },
            { cmd: 'básicos', desc: 'Precios básicos de la empresa' },
            { cmd: 'estado', desc: 'Resumen general del sistema' },
            { cmd: 'activar modo pruebas', desc: 'Activa respuestas temporales cuando el bot está apagado' },
          ].map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-0">
              <code className="text-xs bg-slate-100 text-primary px-2 py-0.5 rounded font-mono whitespace-nowrap">
                {cmd}
              </code>
              <span className="text-xs text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
