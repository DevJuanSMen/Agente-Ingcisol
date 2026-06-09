import { useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';
const fmtCOP = (v) =>
  v ? `$${Number(v).toLocaleString('es-CO')}` : '—';

export default function OrderList() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

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
    </div>
  );
}
