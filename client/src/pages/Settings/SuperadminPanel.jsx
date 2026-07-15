import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const fmtD = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const ROL_LABEL = (r) => (r || '').replace(/_/g, ' ');

const ESTADO_BADGE = {
  PLANIFICADO: 'bg-slate-100 text-slate-600',
  EN_EJECUCION: 'bg-green-100 text-green-700',
  FINALIZADO: 'bg-blue-100 text-blue-700',
  SUSPENDIDO: 'bg-red-100 text-red-700',
};

const BOT_STATUS = {
  disconnected: { text: 'Desconectado', color: 'text-slate-500', dot: 'bg-slate-400' },
  connecting:   { text: 'Generando código QR…', color: 'text-blue-500', dot: 'bg-blue-400 animate-pulse' },
  qr_waiting:   { text: 'Esperando escaneo QR', color: 'text-amber-500', dot: 'bg-amber-400 animate-pulse' },
  ready:        { text: 'Conectado y listo', color: 'text-green-600', dot: 'bg-green-500' },
  error:        { text: 'Error de conexión', color: 'text-red-600', dot: 'bg-red-500' },
};
const POLLING_STATUSES = ['connecting', 'qr_waiting'];

// ── Tab: Empresas (fila expandible con miembros + toggle del bot) ─────────────
function CompaniesTab({ companies, loading, onToggleBot, acting }) {
  const [expanded, setExpanded] = useState(null);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!companies.length) {
    return <div className="text-center py-12 text-slate-400 text-sm">Sin empresas registradas</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
            <th className="px-3 py-2 w-6" />
            <th className="px-3 py-2">Empresa</th>
            <th className="px-3 py-2">NIT</th>
            <th className="px-3 py-2 text-center">Usuarios</th>
            <th className="px-3 py-2 text-center">Proyectos</th>
            <th className="px-3 py-2">Configuración</th>
            <th className="px-3 py-2">Creada</th>
            <th className="px-3 py-2 text-right">Bot</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {companies.map((c) => (
            <>
              <tr
                key={c.id}
                className="hover:bg-slate-50 cursor-pointer"
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <td className="px-3 py-2.5 text-slate-400 text-xs">{expanded === c.id ? '▼' : '▶'}</td>
                <td className="px-3 py-2.5 font-medium text-slate-700">{c.razonSocial}</td>
                <td className="px-3 py-2.5 text-slate-500">{c.nit}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{c.users?.length ?? 0}</td>
                <td className="px-3 py-2.5 text-center text-slate-600">{c.projects?.length ?? 0}</td>
                <td className="px-3 py-2.5">
                  {c.setupCompletedAt ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">✓ Completa</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                      Paso {c.onboardingStep ?? 1}/5
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-slate-500">{fmtD(c.createdAt)}</td>
                <td className="px-3 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <Button
                    size="sm"
                    variant={c.bot?.enabled ? 'danger' : 'secondary'}
                    loading={acting === c.id}
                    onClick={() => onToggleBot(c)}
                  >
                    {c.bot?.enabled ? 'Excluir del bot' : 'Habilitar bot'}
                  </Button>
                </td>
              </tr>
              {expanded === c.id && (
                <tr key={`${c.id}-detail`}>
                  <td colSpan={8} className="px-6 py-3 bg-slate-50/70">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Miembros</p>
                    {c.users?.length ? (
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {c.users.map((u) => (
                          <div key={u.id} className="flex items-center gap-2 text-xs">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${u.activo ? 'bg-green-500' : 'bg-slate-300'}`} />
                            <span className="font-medium text-slate-700">{u.nombre}</span>
                            <span className="text-slate-400">{ROL_LABEL(u.rol)}</span>
                            <span className="text-slate-400 truncate">{u.email}</span>
                            {u.whatsapp && <span className="text-slate-400">📱{u.whatsapp}</span>}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">Sin usuarios</p>
                    )}
                    {c.projects?.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-3 mb-2">Proyectos</p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {c.projects.map((p) => (
                            <div key={p.id} className="flex items-center gap-2 text-xs">
                              <span className={`px-1.5 py-0.5 rounded-full ${ESTADO_BADGE[p.estado] || 'bg-slate-100 text-slate-600'}`}>
                                {(p.estado || '').replace(/_/g, ' ')}
                              </span>
                              <span className="font-medium text-slate-700">{p.nombre}</span>
                              <span className="text-slate-400">{p.contratoNo}</span>
                              {p.activo && <span className="text-green-600 font-medium">activo</span>}
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Proyectos (todos, con su empresa) ────────────────────────────────────
function ProjectsTab({ companies, loading }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  const rows = companies.flatMap((c) =>
    (c.projects || []).map((p) => ({ ...p, empresa: c.razonSocial, empresaNit: c.nit }))
  );
  if (!rows.length) {
    return <div className="text-center py-12 text-slate-400 text-sm">Sin proyectos en la plataforma</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
            <th className="px-3 py-2">Proyecto</th>
            <th className="px-3 py-2">Contrato</th>
            <th className="px-3 py-2">Empresa</th>
            <th className="px-3 py-2">Ciudad</th>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2 text-center">Activo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50">
              <td className="px-3 py-2.5 font-medium text-slate-700">{p.nombre}</td>
              <td className="px-3 py-2.5 text-slate-500">{p.contratoNo}</td>
              <td className="px-3 py-2.5 text-slate-600">{p.empresa}</td>
              <td className="px-3 py-2.5 text-slate-500">{p.ciudad || '—'}</td>
              <td className="px-3 py-2.5">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_BADGE[p.estado] || 'bg-slate-100 text-slate-600'}`}>
                  {(p.estado || '').replace(/_/g, ' ')}
                </span>
              </td>
              <td className="px-3 py-2.5 text-center">{p.activo ? '🟢' : '⚪'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Bot WhatsApp (sesión única global, QR) ───────────────────────────────
function BotTab() {
  const [state, setState] = useState({ status: 'disconnected', qr: null });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/whatsapp/status');
      setState(data.data);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Polling mientras espera vinculación, para que el QR aparezca y se renueve solo.
  useEffect(() => {
    if (!POLLING_STATUSES.includes(state.status)) return;
    const interval = setInterval(fetchStatus, 2500);
    return () => clearInterval(interval);
  }, [state.status, fetchStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await api.post('/admin/whatsapp/connect');
      await fetchStatus();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al conectar');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('¿Desconectar el bot global de WhatsApp? Dejará de responder a TODAS las empresas hasta reconectar.')) return;
    try {
      await api.post('/admin/whatsapp/disconnect');
      setState((p) => ({ ...p, status: 'disconnected', qr: null }));
    } catch {}
  };

  const s = BOT_STATUS[state.status] || BOT_STATUS.disconnected;
  const isConnected = state.status === 'ready';
  const isWaiting = POLLING_STATUSES.includes(state.status);

  return (
    <div className="max-w-xl space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot}`} />
          <div>
            <p className="text-sm font-medium text-slate-700">Sesión global de WhatsApp</p>
            <p className={`text-xs font-medium ${s.color}`}>{s.text}</p>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={fetchStatus} loading={loading}>Actualizar</Button>
      </div>

      <p className="text-xs text-slate-500 -mt-2">
        Un ÚNICO número de WhatsApp atiende a todas las empresas: el bot identifica a quién responde por el
        número del remitente (usuario o proveedor registrado). Las empresas se pueden excluir individualmente
        desde la pestaña Empresas.
      </p>

      {!isConnected && !isWaiting && (
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
          <p className="text-sm font-semibold text-slate-800">Vincular con código QR</p>
          <p className="text-xs text-slate-500 -mt-1">
            Genera el código QR y escanéalo desde el WhatsApp del número de la plataforma
            (Ajustes → Dispositivos vinculados → Vincular dispositivo).
          </p>
          <Button onClick={handleConnect} loading={connecting} size="sm">📷 Generar QR</Button>
        </div>
      )}

      <div className="flex gap-2">
        {isWaiting && <Button onClick={handleDisconnect} variant="ghost" size="sm">Cancelar</Button>}
        {isConnected && <Button onClick={handleDisconnect} variant="danger" size="sm">Desconectar</Button>}
      </div>

      {state.status === 'connecting' && (
        <div className="text-center space-y-3 py-6">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-slate-600">Generando el código QR…</p>
          <p className="text-xs text-slate-400">Esto toma unos segundos. El QR aparecerá aquí automáticamente.</p>
        </div>
      )}

      {state.status === 'qr_waiting' && state.qr && (
        <div className="text-center space-y-3 py-2">
          <p className="text-sm font-semibold text-slate-700">Escanea con el WhatsApp de la plataforma</p>
          <p className="text-xs text-slate-500">Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo</p>
          <div className="inline-block p-3 bg-white border-2 border-slate-200 rounded-xl shadow-sm">
            <img src={state.qr} alt="QR WhatsApp" className="w-52 h-52" />
          </div>
          <p className="text-xs text-slate-400">El QR se renueva solo. Mantén esta ventana abierta mientras escaneas.</p>
        </div>
      )}

      {isConnected && (
        <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl border border-green-200">
          <span className="text-2xl">✅</span>
          <div>
            <p className="text-sm font-semibold text-green-800">WhatsApp conectado</p>
            <p className="text-xs text-green-600 mt-0.5">
              El bot responde a los usuarios y proveedores registrados de todas las empresas habilitadas.
            </p>
          </div>
        </div>
      )}

      <GroqKeySection />
      <BotDiagnostics />
    </div>
  );
}

// ── API key de Groq (IA): rotación en caliente sin acceso a Railway ───────────
function GroqKeySection() {
  const [status, setStatus] = useState(null); // { configurada, origen }
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text }

  const loadStatus = useCallback(async () => {
    try {
      const { data } = await api.get('/admin/groq-key/status');
      setStatus(data.data);
    } catch {}
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const save = async (e) => {
    e.preventDefault();
    if (!key.trim()) return;
    setSaving(true);
    setMsg(null);
    try {
      const { data } = await api.post('/admin/groq-key', { key: key.trim() });
      setMsg({ ok: true, text: data.data?.message || 'Key activada.' });
      setKey('');
      loadStatus();
    } catch (err) {
      setMsg({ ok: false, text: err.response?.data?.message || 'Error al guardar la key' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-slate-200 pt-5">
      <p className="text-sm font-semibold text-slate-800">🔑 API key de Groq (la IA del bot)</p>
      <p className="text-xs text-slate-500 mt-0.5 mb-2">
        Se valida contra Groq y se activa al instante en el bot y la API, sin reiniciar nada.
        {status && (
          <> Estado actual: <strong>{status.configurada ? `configurada (origen: ${status.origen})` : 'sin configurar'}</strong>.</>
        )}
      </p>
      <form onSubmit={save} className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="gsk_..."
          autoComplete="off"
          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <Button type="submit" size="sm" loading={saving} disabled={!key.trim()}>Validar y activar</Button>
      </form>
      {msg && (
        <p className={`text-xs mt-2 font-medium ${msg.ok ? 'text-green-600' : 'text-red-600'}`}>
          {msg.ok ? '✅ ' : '❌ '}{msg.text}
        </p>
      )}
    </div>
  );
}

// ── Diagnóstico del bot: probar un número + actividad reciente ────────────────
function BotDiagnostics() {
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [logs, setLogs] = useState(null);
  const [logsLoading, setLogsLoading] = useState(false);

  const diagnose = async (e) => {
    e.preventDefault();
    if (!phone.trim()) return;
    setChecking(true);
    setResult(null);
    try {
      const { data } = await api.get('/admin/whatsapp/diagnose', { params: { phone: phone.trim() } });
      setResult(data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al diagnosticar');
    } finally {
      setChecking(false);
    }
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    try {
      const { data } = await api.get('/admin/whatsapp/logs', { params: { limit: 30 } });
      setLogs(data.data || []);
    } catch {
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  };

  const fmtLogDate = (d) => new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-5 border-t border-slate-200 pt-5">
      {/* Probar un número */}
      <div>
        <p className="text-sm font-semibold text-slate-800">🔍 Probar un número</p>
        <p className="text-xs text-slate-500 mt-0.5 mb-2">
          Escribe un número de WhatsApp y te digo exactamente qué haría el bot con él: a quién reconoce,
          en qué empresa y si algo lo está bloqueando.
        </p>
        <form onSubmit={diagnose} className="flex gap-2">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="3001234567 o +573001234567"
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <Button type="submit" size="sm" loading={checking}>Diagnosticar</Button>
        </form>

        {result && (
          <div className={`mt-3 p-3 rounded-xl border text-sm space-y-2 ${
            result.veredicto.startsWith('OK') ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
          }`}>
            <p className={`font-semibold ${result.veredicto.startsWith('OK') ? 'text-green-800' : 'text-red-800'}`}>
              {result.veredicto}
            </p>
            <p className="text-xs text-slate-600">
              Número consultado: <code>{result.numeroConsultado}</code> → normalizado: <code>{result.numeroNormalizado}</code>
              {' '}· Aviso de "desconocido" en espera: {result.avisoDesconocidoEnEspera}
            </p>
            {result.coincidencias.length > 0 ? (
              <div className="space-y-1">
                {result.coincidencias.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-slate-700 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 font-medium">{m.tipo}</span>
                    <span className="font-medium">{m.nombre}</span>
                    {m.rol && <span className="text-slate-400">{ROL_LABEL(m.rol)}</span>}
                    <span className="text-slate-500">· {m.empresa}</span>
                    <span className="text-slate-400">guardado: {m.whatsappGuardado}</span>
                    {!m.botHabilitado && <span className="text-red-600 font-semibold">⛔ bot deshabilitado</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Sin coincidencias en usuarios ni proveedores activos.</p>
            )}
          </div>
        )}
      </div>

      {/* Actividad reciente */}
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">📜 Actividad reciente del bot</p>
          <Button size="sm" variant="ghost" onClick={loadLogs} loading={logsLoading}>
            {logs === null ? 'Cargar' : 'Actualizar'}
          </Button>
        </div>
        {logs !== null && (
          logs.length === 0 ? (
            <p className="text-xs text-slate-400 mt-2">Sin registros todavía.</p>
          ) : (
            <div className="mt-2 space-y-1.5 max-h-80 overflow-auto">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2 text-xs p-2 rounded-lg bg-slate-50 border border-slate-100">
                  <span className={`px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    l.exito ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                  }`}>
                    {l.contexto}
                  </span>
                  <div className="min-w-0">
                    <p className="text-slate-700 truncate">"{l.entrada}"</p>
                    <p className="text-slate-400">
                      {fmtLogDate(l.createdAt)}
                      {l.empresa && <> · {l.empresa}</>}
                      {l.error && <span className="text-red-500"> · {l.error}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── Panel principal ───────────────────────────────────────────────────────────
const TABS = [
  { id: 'companies', label: '🏢 Empresas' },
  { id: 'projects', label: '🏗️ Proyectos' },
  { id: 'bot', label: '💬 Bot WhatsApp' },
];

export default function SuperadminPanel() {
  const [tab, setTab] = useState('companies');
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/overview');
      setCompanies(data.data || []);
    } catch {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleBot = async (c) => {
    const disable = c.bot?.enabled;
    if (disable && !confirm(`¿Excluir a "${c.razonSocial}" del bot? Sus usuarios y proveedores dejarán de recibir respuestas.`)) return;
    setActing(c.id);
    try {
      await api.post(`/admin/companies/${c.id}/bot/${disable ? 'disable' : 'enable'}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setActing(null);
    }
  };

  const totalProjects = companies.reduce((a, c) => a + (c.projects?.length || 0), 0);
  const totalUsers = companies.reduce((a, c) => a + (c.users?.length || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">⚙️ Superadmin — Plataforma</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {companies.length} empresas · {totalUsers} usuarios · {totalProjects} proyectos
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} loading={loading}>Actualizar</Button>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.id
                ? 'bg-white text-primary border border-slate-200 border-b-white -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        {tab === 'companies' && (
          <CompaniesTab companies={companies} loading={loading} onToggleBot={toggleBot} acting={acting} />
        )}
        {tab === 'projects' && <ProjectsTab companies={companies} loading={loading} />}
        {tab === 'bot' && <BotTab />}
      </Card>

      {tab === 'companies' && (
        <p className="text-xs text-slate-400">
          "Excluir del bot" apaga las respuestas y envíos de WhatsApp para esa empresa sin afectar a las demás
          (la sesión global sigue conectada). Se puede reactivar en cualquier momento.
        </p>
      )}
    </div>
  );
}
