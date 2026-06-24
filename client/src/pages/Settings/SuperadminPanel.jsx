import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';

const BOT_BADGE = {
  ready:        { label: '🟢 Conectado', cls: 'bg-green-100 text-green-700' },
  authenticated:{ label: '🔵 Autenticado', cls: 'bg-blue-100 text-blue-700' },
  qr_waiting:   { label: '🟡 QR activo', cls: 'bg-amber-100 text-amber-700' },
  error:        { label: '🔴 Error', cls: 'bg-red-100 text-red-700' },
  disconnected: { label: '⚪ Desconectado', cls: 'bg-slate-100 text-slate-500' },
};

const fmtD = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function SuperadminPanel() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/admin/companies');
      setCompanies(data.data || []);
    } catch {
      setCompanies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Un bot está "activo" si está habilitado O tiene sesión/QR corriendo. En ese
  // caso la acción es DETENERLO (aunque nunca se haya "activado"), para poder
  // matar empresas fantasma que giran QR sin estar habilitadas.
  const isActive = (c) =>
    c.bot.enabled || c.bot.qrActivo || ['ready', 'authenticated', 'qr_waiting'].includes(c.bot.status);

  const toggleBot = async (c) => {
    const stop = isActive(c);
    if (stop && !confirm(`¿Inhabilitar/detener el bot de "${c.razonSocial}"? Se cerrará su sesión de WhatsApp y su QR.`)) return;
    setActing(c.id);
    try {
      await api.post(`/admin/companies/${c.id}/bot/${stop ? 'disable' : 'enable'}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setActing(null);
    }
  };

  const totalConectados = companies.filter((c) => c.bot.status === 'ready').length;
  const totalQr = companies.filter((c) => c.bot.qrActivo || c.bot.status === 'qr_waiting').length;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">⚙️ Superadmin — Plataforma</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {companies.length} empresas · {totalConectados} con bot conectado · {totalQr} con QR activo
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={load} loading={loading}>Actualizar</Button>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-12 text-slate-400 text-sm">Sin empresas registradas</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wide border-b border-slate-200">
                  <th className="px-3 py-2">Empresa</th>
                  <th className="px-3 py-2">NIT</th>
                  <th className="px-3 py-2 text-center">Usuarios</th>
                  <th className="px-3 py-2 text-center">Proyectos</th>
                  <th className="px-3 py-2">Bot WhatsApp</th>
                  <th className="px-3 py-2">Creada</th>
                  <th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {companies.map((c) => {
                  const badge = BOT_BADGE[c.bot.status] || BOT_BADGE.disconnected;
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-700">{c.razonSocial}</td>
                      <td className="px-3 py-2.5 text-slate-500">{c.nit}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{c._count?.users ?? 0}</td>
                      <td className="px-3 py-2.5 text-center text-slate-600">{c._count?.projects ?? 0}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                          {c.bot.enabled && <span className="text-xs text-slate-400">habilitado</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500">{fmtD(c.createdAt)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Button
                          size="sm"
                          variant={isActive(c) ? 'danger' : 'secondary'}
                          loading={acting === c.id}
                          onClick={() => toggleBot(c)}
                        >
                          {isActive(c) ? 'Inhabilitar / detener' : 'Habilitar bot'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-slate-400">
        "Inhabilitar bot" apaga el bot de la empresa y cierra su sesión de WhatsApp (útil para empresas fantasma
        que están generando QR sin usarse). La empresa puede volver a vincularse desde su propio panel.
      </p>
    </div>
  );
}
