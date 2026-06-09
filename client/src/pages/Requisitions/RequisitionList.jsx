import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';

export default function RequisitionList() {
  const user = useAuthStore((s) => s.user);
  const canApprove = ['DIRECTOR', 'APOYO_DIRECTOR'].includes(user?.rol);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

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

  const fmt = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

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
    { key: 'actions', label: 'Acciones', render: (r) => (
      <div className="flex items-center gap-2">
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
        <Link to="/requisitions/new">
          <Button>+ Nueva requisición</Button>
        </Link>
      </div>

      <Card>
        <Table columns={columns} data={data} loading={loading} emptyMessage="Sin requisiciones" />
      </Card>
    </div>
  );
}
