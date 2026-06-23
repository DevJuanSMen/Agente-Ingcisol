import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuthStore, useCan } from '../../store/authStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';
const fmtCOP = (v) =>
  v ? `$${Number(v).toLocaleString('es-CO')}` : '—';

// Modal para editar transporte e impuestos (DIAN) de una OC.
function TaxModal({ order, onClose, onSaved }) {
  const [form, setForm] = useState({
    transporte: order.transporte != null ? String(order.transporte) : '0',
    ivaPorcentaje: order.ivaPorcentaje != null ? String(order.ivaPorcentaje) : '',
    retefuentePorcentaje: order.retefuentePorcentaje != null ? String(order.retefuentePorcentaje) : '',
    reteIcaPorMil: order.reteIcaPorMil != null ? String(order.reteIcaPorMil) : '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/orders/${order.id}/taxes`, form);
      onSaved();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar impuestos');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, hint) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      <input
        type="number" step="0.01" min="0"
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Impuestos · {order.consecutivo}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          {field('transporte', 'Transporte / Flete (COP)', 'Valor del transporte de los productos comprados.')}
          {field('ivaPorcentaje', 'IVA (%)', 'Vacío = usa el valor de la empresa.')}
          {field('retefuentePorcentaje', 'Retefuente (%)', 'Vacío = usa el valor de la empresa.')}
          {field('reteIcaPorMil', 'ReteICA (×1000)', 'Vacío = usa el valor de la empresa.')}
        </div>
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200">
          <Button onClick={save} loading={saving}>Guardar</Button>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

export default function OrderList() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [taxOrder, setTaxOrder] = useState(null);
  const canEditTaxes = useCan('orders', 'editar');

  const load = () => {
    setLoading(true);
    api.get('/orders')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleConfirmDelivery = async (id) => {
    if (!window.confirm('¿Confirmar recepción de materiales?')) return;
    setActionLoading(id);
    try {
      await api.put(`/orders/${id}/confirm-delivery`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegisterPayment = async (id) => {
    if (!window.confirm('¿Registrar el pago de esta OC?')) return;
    setActionLoading(id);
    try {
      await api.put(`/orders/${id}/register-payment`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDownloadPdf = async (id, consecutivo) => {
    setActionLoading(id);
    try {
      const res = await api.get(`/orders/${id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${consecutivo || 'orden-compra'}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.message || 'No se pudo generar el PDF');
    } finally {
      setActionLoading(null);
    }
  };

  const getSemaforo = (fechaEntrega) => {
    if (!fechaEntrega) return null;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const ent = new Date(fechaEntrega); ent.setHours(0,0,0,0);
    const dias = Math.ceil((ent - hoy) / 86400000);
    if (dias < 0) return 'ROJO';
    if (dias <= 4) return 'AMARILLO';
    return 'VERDE';
  };

  const columns = [
    { key: 'consecutivo', label: 'OC' },
    { key: 'proveedor', label: 'Proveedor', render: (r) => r.proveedor?.nombre || '—' },
    { key: 'monto', label: 'Monto', render: (r) => fmtCOP(r.montoTotal) },
    { key: 'estado', label: 'Estado', render: (r) => <Badge status={r.estado} /> },
    { key: 'entrega', label: 'Entrega pactada', render: (r) => (
      <span className="flex items-center gap-2">
        {fmt(r.fechaEntregaPactada)}
        {['EMITIDA', 'ENVIADA'].includes(r.estado) && r.fechaEntregaPactada && (
          <span className={`w-2.5 h-2.5 rounded-full ${
            getSemaforo(r.fechaEntregaPactada) === 'ROJO' ? 'bg-danger' :
            getSemaforo(r.fechaEntregaPactada) === 'AMARILLO' ? 'bg-warning' : 'bg-success'
          }`} />
        )}
      </span>
    )},
    { key: 'actions', label: 'Acciones', render: (r) => (
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" loading={actionLoading === r.id} onClick={() => handleDownloadPdf(r.id, r.consecutivo)}>
          PDF
        </Button>
        {canEditTaxes && (
          <Button size="sm" variant="ghost" onClick={() => setTaxOrder(r)}>
            Impuestos
          </Button>
        )}
        {['EMITIDA', 'ENVIADA'].includes(r.estado) &&
          ['DIRECTOR', 'APOYO_DIRECTOR', 'RESIDENTE', 'ALMACENISTA'].includes(user?.rol) && (
          <Button size="sm" variant="secondary" loading={actionLoading === r.id} onClick={() => handleConfirmDelivery(r.id)}>
            Confirmar entrega
          </Button>
        )}
        {r.estado === 'ENTREGADA' &&
          ['DIRECTOR', 'CONTABILIDAD'].includes(user?.rol) && (
          <Button size="sm" variant="success" loading={actionLoading === r.id} onClick={() => handleRegisterPayment(r.id)}>
            Registrar pago
          </Button>
        )}
      </div>
    )},
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Órdenes de Compra</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.length} registros</p>
      </div>
      <Card>
        <Table columns={columns} data={data} loading={loading} emptyMessage="Sin órdenes de compra" />
      </Card>

      {taxOrder && (
        <TaxModal
          order={taxOrder}
          onClose={() => setTaxOrder(null)}
          onSaved={() => { setTaxOrder(null); load(); }}
        />
      )}
    </div>
  );
}
