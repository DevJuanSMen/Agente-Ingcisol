import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

const ESTADO_COLOR = {
  EN_BUSQUEDA:          'bg-slate-100 text-slate-600',
  PENDIENTE_APROBACION: 'bg-amber-100 text-amber-700',
  APROBADA:             'bg-green-100 text-green-700',
  CANCELADA:            'bg-red-100 text-red-600',
};

// ── Invite Modal ────────────────────────────────────────────────────────────
function InviteModal({ quotationId, onClose, onSuccess }) {
  const [suppliers, setSuppliers] = useState([]);
  const [selected, setSelected]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [sending, setSending]     = useState(false);

  useEffect(() => {
    api.get('/suppliers').then((r) => {
      const list = (r.data.data || []).filter((s) => s.whatsapp || s.telefono);
      setSuppliers(list);
    }).finally(() => setLoading(false));
  }, []);

  const toggle = (id) =>
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const handleSend = async () => {
    if (!selected.length) return;
    setSending(true);
    try {
      await api.post(`/quotations/${quotationId}/invite`, { supplierIds: selected });
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al enviar invitaciones');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-800">Invitar proveedores a cotizar</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4 max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : suppliers.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">
              No hay proveedores con WhatsApp/teléfono registrado.
            </p>
          ) : (
            <div className="space-y-2">
              {suppliers.map((s) => (
                <label
                  key={s.id}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    selected.includes(s.id)
                      ? 'border-primary bg-primary/5'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(s.id)}
                    onChange={() => toggle(s.id)}
                    className="w-4 h-4 accent-primary"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">{s.nombre}</p>
                    <p className="text-xs text-slate-400">{s.whatsapp || s.telefono}</p>
                  </div>
                  {s.whatsapp && (
                    <span className="ml-auto text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full flex-shrink-0">
                      WhatsApp
                    </span>
                  )}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <span className="text-sm text-slate-500">{selected.length} seleccionado(s)</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" loading={sending} disabled={!selected.length} onClick={handleSend}>
              Enviar solicitud
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Select Winner Modal ─────────────────────────────────────────────────────
function WinnerModal({ quotationId, supplier, onClose, onSuccess }) {
  const [fecha, setFecha]   = useState('');
  const [sending, setSend]  = useState(false);

  const handleConfirm = async () => {
    setSend(true);
    try {
      await api.put(`/quotations/${quotationId}/winner`, {
        supplierId: supplier.id,
        fechaEntregaPactada: fecha || null,
      });
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al seleccionar ganador');
    } finally {
      setSend(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-800">Confirmar ganador</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
            <p className="font-semibold mb-0.5">Proveedor seleccionado</p>
            <p>{supplier.nombre}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Fecha de entrega pactada (opcional)
            </label>
            <input
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <p className="text-xs text-slate-500">
            Se generará una Orden de Compra y se notificará al proveedor por WhatsApp.
          </p>
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <Button variant="secondary" size="sm" onClick={onClose} className="flex-1">Cancelar</Button>
          <Button size="sm" loading={sending} onClick={handleConfirm} className="flex-1">
            Confirmar y generar OC
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Comparative Table ───────────────────────────────────────────────────────
function ComparativeTable({ quotation, onWinnerClick, onInviteClick, onRefresh }) {
  // Agrupar items por proveedor
  const supplierMap = {};
  for (const item of quotation.items || []) {
    if (!item.supplierId) continue;
    if (!supplierMap[item.supplierId]) {
      supplierMap[item.supplierId] = { id: item.supplierId, nombre: item.supplier?.nombre || '?', items: [] };
    }
    supplierMap[item.supplierId].items.push(item);
  }
  const suppliers = Object.values(supplierMap);

  // Lista canónica de ítems (desde la requisición)
  const reqItems = quotation.requisition?.items || [];

  // Calcular total por proveedor
  const totals = {};
  for (const sup of suppliers) {
    totals[sup.id] = sup.items.reduce((acc, it) => acc + Number(it.precioUnitario || 0) * Number(it.cantidad || 1), 0);
  }

  const isApproved  = quotation.estado === 'APROBADA';
  const winnerId    = quotation.proveedorGanadorId;

  // Invites
  const invited   = (quotation.invites || []).filter((i) => i.enviado).length;
  const responded = (quotation.invites || []).filter((i) => i.respondido).length;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span>{invited} proveedor(es) invitados</span>
        <span className="text-slate-300">|</span>
        <span>{responded} respuesta(s) recibidas</span>
        <span className="text-slate-300">|</span>
        <span>{suppliers.length} cotizaciones en tabla</span>
        {!isApproved && (
          <Button size="sm" variant="secondary" className="ml-auto" onClick={onInviteClick}>
            + Invitar proveedores
          </Button>
        )}
      </div>

      {suppliers.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">
          Esperando respuestas de proveedores por WhatsApp o ingreso manual.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-64">Ítem</th>
                {suppliers.map((sup) => (
                  <th key={sup.id} className={`px-4 py-3 text-center text-xs font-semibold min-w-36 ${
                    winnerId === sup.id ? 'bg-green-50 text-green-700' : 'text-slate-600'
                  }`}>
                    {sup.nombre}
                    {winnerId === sup.id && (
                      <span className="block text-xs text-green-500 font-normal">Ganador</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reqItems.map((ri, idx) => {
                // Buscar el precio de este ítem para cada proveedor
                const getPrecio = (supId) => {
                  const sup = supplierMap[supId];
                  if (!sup) return null;
                  // Intentar matchear por descripcion o itemApuId
                  const match = sup.items.find(
                    (it) =>
                      it.descripcion?.toLowerCase() === ri.descripcion?.toLowerCase() ||
                      (ri.itemApuId && it.itemApuId === ri.itemApuId)
                  );
                  return match || sup.items[idx] || null;
                };

                // Precio mínimo para resaltar
                const prices = suppliers.map((s) => {
                  const it = getPrecio(s.id);
                  return it ? Number(it.precioUnitario || 0) : Infinity;
                });
                const minPrice = Math.min(...prices.filter((p) => p < Infinity));

                return (
                  <tr key={ri.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-700">{ri.descripcion}</p>
                      <p className="text-xs text-slate-400">
                        {Number(ri.cantidad).toLocaleString('es-CO')} {ri.unidad}
                      </p>
                    </td>
                    {suppliers.map((sup) => {
                      const it = getPrecio(sup.id);
                      const price = it ? Number(it.precioUnitario || 0) : null;
                      const isMin = price !== null && price === minPrice && price > 0;
                      return (
                        <td
                          key={sup.id}
                          className={`px-4 py-3 text-center ${
                            winnerId === sup.id ? 'bg-green-50/50' : ''
                          }`}
                        >
                          {it ? (
                            <div>
                              <span className={`text-sm font-semibold ${isMin ? 'text-green-700' : 'text-slate-700'}`}>
                                {fmtCOP(price)}
                              </span>
                              {isMin && suppliers.length > 1 && (
                                <span className="block text-xs text-green-500">más económico</span>
                              )}
                              {it.tiempoEntrega && (
                                <span className="block text-xs text-slate-400">{it.tiempoEntrega}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Fila de totales */}
              <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                <td className="px-4 py-3 text-sm text-slate-700">Total estimado</td>
                {suppliers.map((sup) => {
                  const isWinner = winnerId === sup.id;
                  const isLowest = totals[sup.id] === Math.min(...Object.values(totals));
                  return (
                    <td key={sup.id} className={`px-4 py-3 text-center ${isWinner ? 'bg-green-50' : ''}`}>
                      <span className={`text-sm font-bold ${isLowest && suppliers.length > 1 ? 'text-green-700' : 'text-slate-700'}`}>
                        {fmtCOP(totals[sup.id])}
                      </span>
                    </td>
                  );
                })}
              </tr>

              {/* Fila de acción: elegir ganador */}
              {!isApproved && (
                <tr>
                  <td className="px-4 py-3 text-xs text-slate-400">Seleccionar ganador</td>
                  {suppliers.map((sup) => (
                    <td key={sup.id} className="px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant={winnerId === sup.id ? 'primary' : 'secondary'}
                        onClick={() => onWinnerClick(sup)}
                      >
                        Elegir
                      </Button>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Quotation Card ──────────────────────────────────────────────────────────
function QuotationCard({ q, onRefresh }) {
  const [expanded, setExpanded]     = useState(false);
  const [inviteModal, setInvite]    = useState(false);
  const [winnerModal, setWinner]    = useState(null); // { id, nombre }

  const estado = ESTADO_COLOR[q.estado] || 'bg-slate-100 text-slate-600';

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
        onClick={() => setExpanded((p) => !p)}
      >
        <span className="text-slate-300">{expanded ? '▼' : '▶'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-700">
              {q.requisition?.consecutivo || 'Sin consecutivo'}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estado}`}>
              {q.estado?.replace(/_/g, ' ')}
            </span>
            {q.proveedorGanador && (
              <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                Ganador: {q.proveedorGanador.nombre}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {q.requisition?.project?.nombre || '—'} · {fmtDate(q.createdAt)}
            {q.purchaseOrder && ` · OC: ${q.purchaseOrder.consecutivo}`}
          </p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-slate-400">
            {q.items?.length || 0} cotiz. · {(q.invites || []).filter((i) => i.respondido).length}/{(q.invites || []).length} resp.
          </p>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-100 px-5 py-4">
          {/* Requisition items summary */}
          {q.requisition?.items?.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Ítems de la requisición</p>
              <div className="space-y-1">
                {q.requisition.items.map((it) => (
                  <div key={it.id} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                    <span>{it.descripcion}</span>
                    <span className="text-slate-400 ml-auto flex-shrink-0">
                      {Number(it.cantidad).toLocaleString('es-CO')} {it.unidad}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <ComparativeTable
            quotation={q}
            onWinnerClick={(sup) => setWinner(sup)}
            onInviteClick={() => setInvite(true)}
            onRefresh={onRefresh}
          />

          {/* OC info */}
          {q.purchaseOrder && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 space-y-1">
              <p className="font-semibold">Orden de Compra emitida: {q.purchaseOrder.consecutivo}</p>
              {q.purchaseOrder.fechaEntregaPactada && (
                <p>Entrega pactada: {fmtDate(q.purchaseOrder.fechaEntregaPactada)}</p>
              )}
              <p>Valor total: <strong>{fmtCOP(q.purchaseOrder.montoTotal)}</strong></p>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {inviteModal && (
        <InviteModal
          quotationId={q.id}
          onClose={() => setInvite(false)}
          onSuccess={onRefresh}
        />
      )}
      {winnerModal && (
        <WinnerModal
          quotationId={q.id}
          supplier={winnerModal}
          onClose={() => setWinner(null)}
          onSuccess={onRefresh}
        />
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function QuotationList() {
  const [data, setData]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('TODOS');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/quotations')
      .then((r) => setData(r.data.data || []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const estados = ['TODOS', 'EN_BUSQUEDA', 'PENDIENTE_APROBACION', 'APROBADA', 'CANCELADA'];
  const filtered = filter === 'TODOS' ? data : data.filter((q) => q.estado === filter);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Cotizaciones</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {data.length} cotización(es) — tabla comparativa de proveedores
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 flex-wrap">
        {estados.map((e) => {
          const count = e === 'TODOS' ? data.length : data.filter((q) => q.estado === e).length;
          return (
            <button
              key={e}
              onClick={() => setFilter(e)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                filter === e ? 'bg-primary text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {e === 'TODOS' ? 'Todas' : e.replace(/_/g, ' ')} ({count})
            </button>
          );
        })}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={load} loading={loading}>
          Actualizar
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm text-slate-500">No hay cotizaciones en este estado.</p>
            <p className="text-xs text-slate-400 mt-1">
              Las cotizaciones se crean automáticamente al aprobar una requisición.
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((q) => (
            <QuotationCard key={q.id} q={q} onRefresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}
