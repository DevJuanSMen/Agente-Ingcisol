import { useEffect, useState } from 'react';
import api from '../../api/client';
import Table from '../../components/ui/Table';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';

export default function QuotationList() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/quotations')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  const columns = [
    { key: 'requisicion', label: 'Requisición', render: (r) => r.requisition?.consecutivo || '—' },
    { key: 'estado', label: 'Estado', render: (r) => <Badge status={r.estado} /> },
    { key: 'ganador', label: 'Proveedor Ganador', render: (r) => r.proveedorGanador?.nombre || '—' },
    { key: 'items', label: 'Ítems', render: (r) => r.items?.length || 0 },
    { key: 'createdAt', label: 'Fecha', render: (r) => new Date(r.createdAt).toLocaleDateString('es-CO') },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Cotizaciones</h1>
        <p className="text-sm text-slate-500 mt-0.5">{data.length} registros</p>
      </div>

      <Card>
        <Table columns={columns} data={data} loading={loading} emptyMessage="Sin cotizaciones" />
      </Card>
    </div>
  );
}
