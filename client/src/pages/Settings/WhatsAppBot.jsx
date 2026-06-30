import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const STATUS_LABEL = {
  disconnected: { text: 'Desconectado', color: 'text-slate-500', dot: 'bg-slate-400' },
  qr_waiting:   { text: 'Esperando escaneo QR', color: 'text-amber-500', dot: 'bg-amber-400 animate-pulse' },
  pairing_waiting: { text: 'Esperando código de vinculación', color: 'text-amber-500', dot: 'bg-amber-400 animate-pulse' },
  authenticated: { text: 'Autenticado', color: 'text-blue-500', dot: 'bg-blue-500' },
  ready:         { text: 'Conectado y listo', color: 'text-green-600', dot: 'bg-green-500' },
  error:         { text: 'Error de conexión', color: 'text-red-600', dot: 'bg-red-500' },
};

const COMMANDS = [
  { cmd: 'proyectos', desc: 'Lista todos los proyectos de la empresa' },
  { cmd: 'presupuesto', desc: 'Resumen del presupuesto APU del proyecto activo' },
  { cmd: 'apu <código>', desc: 'Detalle de un ítem APU (precio, saldo, unidad)' },
  { cmd: 'apus', desc: 'Primeros 15 ítems APU del proyecto activo' },
  { cmd: 'proveedores', desc: 'Lista de proveedores registrados' },
  { cmd: 'proveedor <nombre>', desc: 'Buscar proveedor por nombre' },
  { cmd: 'básicos', desc: 'Precios básicos de la empresa' },
  { cmd: 'requisiciones', desc: 'Requisiciones pendientes de aprobación/cotización' },
  { cmd: 'ordenes', desc: 'Órdenes de compra activas' },
  { cmd: 'cotizaciones', desc: 'Cotizaciones en curso' },
  { cmd: 'estado', desc: 'Resumen general: proyectos, req, cotiz, OC' },
  { cmd: 'ayuda', desc: 'Muestra este menú de comandos' },
];

export default function WhatsAppBot() {
  const [state, setState] = useState({ enabled: false, status: 'disconnected', qr: null, pairingCode: null });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [phone, setPhone] = useState('');

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

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Polling mientras espera vinculación (QR, código o autenticación). Cada 3s
  // para que el QR/código mostrados estén siempre frescos.
  useEffect(() => {
    if (!['qr_waiting', 'pairing_waiting', 'authenticated'].includes(state.status)) return;
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [state.status, fetchStatus]);

  // mode: 'pairing' (código de 8 dígitos) | 'qr' (escanear)
  const handleConnect = async (mode) => {
    if (mode === 'pairing') {
      const digits = (phone || '').replace(/\D/g, '');
      if (digits.length < 10) {
        alert('Escribe el número de WhatsApp de la empresa con indicativo de país. Ej: 573001234567');
        return;
      }
    }
    setConnecting(true);
    try {
      const body = mode === 'pairing'
        ? { mode: 'pairing', phone: (phone || '').replace(/\D/g, '') }
        : { mode: 'qr' };
      await api.post('/whatsapp/connect', body);
      setTimeout(fetchStatus, 3000);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al conectar');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar el bot de WhatsApp? Tendrás que escanear el QR nuevamente.')) return;
    try {
      await api.post('/whatsapp/disconnect');
      setState((p) => ({ ...p, status: 'disconnected', qr: null }));
    } catch {}
  };

  const toggleEnabled = async () => {
    setToggling(true);
    try {
      const endpoint = state.enabled ? '/whatsapp/disable' : '/whatsapp/enable';
      const { data } = await api.post(endpoint);
      setState((p) => ({ ...p, enabled: data.data.enabled }));
    } finally {
      setToggling(false);
    }
  };

  const s = STATUS_LABEL[state.status] || STATUS_LABEL.disconnected;
  const isConnected = state.status === 'ready';
  const isWaiting = ['qr_waiting', 'pairing_waiting', 'authenticated'].includes(state.status);

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Bot de WhatsApp</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Conecta el WhatsApp de tu empresa para recibir requisiciones, cotizaciones y alertas automáticas.
        </p>
      </div>

      {/* Estado + acciones */}
      <Card>
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
              <div>
                <p className="text-sm font-medium text-slate-700">Estado de conexión</p>
                <p className={`text-xs font-medium ${s.color}`}>{s.text}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={fetchStatus} loading={loading}>
              Actualizar
            </Button>
          </div>

          {/* Conexión: código de emparejamiento (recomendado) o QR */}
          {!isConnected && !isWaiting && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <p className="text-sm font-semibold text-slate-800">Opción recomendada: vincular con código</p>
                <p className="text-xs text-slate-500 -mt-1">
                  Más fácil que el QR: WhatsApp te pide un código de 8 dígitos y lo escribes en tu teléfono.
                </p>
                <label className="block text-xs font-medium text-slate-600">
                  Número de WhatsApp de la empresa (con indicativo de país)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Ej: 573001234567"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <Button onClick={() => handleConnect('pairing')} loading={connecting} size="sm">
                  🔑 Vincular con código
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">¿Prefieres escanear?</span>
                <Button onClick={() => handleConnect('qr')} loading={connecting} variant="ghost" size="sm">
                  📷 Generar QR
                </Button>
              </div>
            </div>
          )}

          {/* Acciones mientras espera / conectado */}
          <div className="flex gap-2">
            {isWaiting && (
              <Button onClick={handleDisconnect} variant="ghost" size="sm">
                Cancelar
              </Button>
            )}
            {isConnected && (
              <Button onClick={handleDisconnect} variant="danger" size="sm">
                Desconectar
              </Button>
            )}
          </div>

          {/* Código de emparejamiento */}
          {state.status === 'pairing_waiting' && state.pairingCode && (
            <div className="text-center space-y-3 py-2">
              <p className="text-sm font-semibold text-slate-700">Escribe este código en WhatsApp</p>
              <div className="inline-block px-6 py-4 bg-white border-2 border-primary/30 rounded-xl shadow-sm">
                <span className="text-3xl font-mono font-bold tracking-[0.3em] text-primary">
                  {state.pairingCode}
                </span>
              </div>
              <div className="text-xs text-slate-500 leading-relaxed max-w-sm mx-auto text-left bg-slate-50 rounded-lg p-3 border border-slate-200">
                <p className="font-semibold text-slate-700 mb-1">En el teléfono de la empresa:</p>
                1. Abre <strong>WhatsApp</strong><br />
                2. <strong>Ajustes → Dispositivos vinculados</strong><br />
                3. <strong>Vincular dispositivo</strong> → <strong>Vincular con número de teléfono</strong><br />
                4. Escribe el código de arriba
              </div>
              <p className="text-xs text-slate-400">El código es válido unos minutos. Si vence, pulsa "Cancelar" y genera uno nuevo.</p>
            </div>
          )}

          {/* QR Code */}
          {state.status === 'qr_waiting' && state.qr && (
            <div className="text-center space-y-3 py-2">
              <p className="text-sm font-semibold text-slate-700">Escanea con WhatsApp de tu empresa</p>
              <p className="text-xs text-slate-500">
                Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo
              </p>
              <div className="inline-block p-3 bg-white border-2 border-slate-200 rounded-xl shadow-sm">
                <img src={state.qr} alt="QR WhatsApp" className="w-52 h-52" />
              </div>
              <p className="text-xs text-slate-400">El QR se renueva solo. Mantén esta ventana abierta mientras escaneas.</p>
            </div>
          )}

          {state.status === 'ready' && (
            <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
              <span className="text-2xl">✅</span>
              <div>
                <p className="text-sm font-semibold text-green-800">WhatsApp conectado</p>
                <p className="text-xs text-green-600 mt-0.5">
                  El bot responde a los usuarios y proveedores registrados en tu empresa.
                </p>
              </div>
            </div>
          )}

          {/* Switch activar/desactivar respuestas */}
          {isConnected && (
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {state.enabled ? 'Respuestas activas' : 'Respuestas desactivadas'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {state.enabled
                    ? 'El bot responde a mensajes entrantes de usuarios y proveedores.'
                    : 'El bot está conectado pero no responde mensajes.'}
                </p>
              </div>
              <button
                onClick={toggleEnabled}
                disabled={toggling}
                className={`relative w-12 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  state.enabled ? 'bg-primary' : 'bg-slate-300'
                } ${toggling ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    state.enabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* Flujo de cotización por WhatsApp */}
      <Card title="Flujo de cotización automático">
        <div className="space-y-3 text-sm text-slate-600">
          <div className="flex gap-3 items-start">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
            <p>El director <strong>aprueba una requisición</strong> en el panel. El sistema envía automáticamente una solicitud de precios a todos los proveedores con WhatsApp registrado.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
            <p>Los proveedores <strong>responden por WhatsApp</strong> con sus precios. El bot los interpreta automáticamente y llena la tabla comparativa en Cotizaciones.</p>
          </div>
          <div className="flex gap-3 items-start">
            <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
            <p>El director <strong>selecciona el proveedor ganador</strong> en el panel. Se genera la Orden de Compra y se notifica al proveedor por WhatsApp.</p>
          </div>
        </div>
      </Card>

      {/* Comandos disponibles */}
      <Card title="Comandos disponibles para usuarios internos">
        <div className="space-y-1">
          {COMMANDS.map(({ cmd, desc }) => (
            <div key={cmd} className="flex items-start gap-3 py-1.5 border-b border-slate-100 last:border-0">
              <code className="text-xs bg-slate-100 text-primary px-2 py-0.5 rounded font-mono whitespace-nowrap flex-shrink-0">
                {cmd}
              </code>
              <span className="text-xs text-slate-500">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          También puedes escribir en lenguaje natural y la IA responderá con datos de tu empresa.
        </p>
      </Card>
    </div>
  );
}
