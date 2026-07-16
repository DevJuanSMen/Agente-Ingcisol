import { useEffect, useState, useCallback } from 'react';
import api from '../../api/client';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';

const fmtCOP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO') : '—';

// Variación % de un precio cotizado contra la referencia del APU.
// Negativa = por debajo del presupuesto (a favor); positiva = sobrecosto.
const varPct = (precio, ref) => {
  const r = Number(ref);
  if (!r || r <= 0) return null;
  return ((Number(precio) - r) / r) * 100;
};
const fmtVar = (v) =>
  `${v > 0 ? '+' : ''}${v.toLocaleString('es-CO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;

// Etiqueta de variación: verde si está a favor (≤ APU), rojo si excede.
const VarBadge = ({ pct, className = '' }) => {
  if (pct == null) return null;
  return (
    <span
      className={`block text-xs font-medium ${pct > 0 ? 'text-red-500' : 'text-green-600'} ${className}`}
      title={pct > 0 ? 'Sobre el precio APU' : 'Por debajo del precio APU'}
    >
      {fmtVar(pct)} vs APU
    </span>
  );
};

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

// ── Manual Quote Modal ──────────────────────────────────────────────────────
// Carga a mano el precio que dio un proveedor (llamada telefónica, correo, o
// cuando el bot de WhatsApp no está disponible) — mismo endpoint que usaría
// el flujo automático, sin depender de que el proveedor responda por WhatsApp.
function ManualQuoteModal({ quotation, onClose, onSuccess }) {
  const [suppliers, setSuppliers]   = useState([]);
  const [supplierId, setSupplierId] = useState('');
  const [precios, setPrecios]       = useState({});   // reqItemId -> precioUnitario
  const [entregas, setEntregas]     = useState({});    // reqItemId -> tiempoEntrega
  const [loading, setLoading]       = useState(true);
  const [sending, setSending]       = useState(false);

  const items = quotation.requisition?.items || [];

  useEffect(() => {
    api.get('/suppliers').then((r) => setSuppliers(r.data.data || [])).finally(() => setLoading(false));
  }, []);

  const handleSubmit = async () => {
    if (!supplierId) return;
    const entries = items.filter((it) => parseFloat(precios[it.id]) > 0);
    if (!entries.length) return;
    setSending(true);
    try {
      for (const it of entries) {
        await api.post(`/quotations/${quotation.id}/items`, {
          supplierId,
          itemApuId: it.itemApuId || null,
          descripcion: it.descripcion,
          cantidad: it.cantidad,
          precioUnitario: precios[it.id],
          tiempoEntrega: entregas[it.id] || 0,
        });
      }
      onSuccess();
      onClose();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al guardar la cotización manual');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-800">Cargar cotización manual</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl">&times;</button>
        </div>
        <div className="px-6 py-4 max-h-[65vh] overflow-auto space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Proveedor</label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Selecciona un proveedor…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500 uppercase">Precios cotizados</p>
                {items.map((it) => (
                  <div key={it.id} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 truncate">{it.descripcion}</p>
                      <p className="text-xs text-slate-400">{Number(it.cantidad).toLocaleString('es-CO')} {it.unidad}</p>
                    </div>
                    <input
                      type="number"
                      min="0"
                      placeholder="Precio unit."
                      value={precios[it.id] || ''}
                      onChange={(e) => setPrecios((p) => ({ ...p, [it.id]: e.target.value }))}
                      className="w-28 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Días"
                      value={entregas[it.id] || ''}
                      onChange={(e) => setEntregas((p) => ({ ...p, [it.id]: e.target.value }))}
                      className="w-16 px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <span className="text-sm text-slate-500">Precio unit. · días de entrega</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancelar</Button>
            <Button
              size="sm"
              loading={sending}
              disabled={!supplierId || !items.some((it) => parseFloat(precios[it.id]) > 0)}
              onClick={handleSubmit}
            >
              Guardar cotización
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
function ComparativeTable({ quotation, onWinnerClick, onInviteClick, onManualClick, onAutoAward, autoLoading }) {
  const comp = quotation.comparison || { rows: [], suppliers: [], favoritoSupplierId: null };
  const rows = comp.rows || [];

  // Proveedores que aparecen en el comparativo
  const suppliers = comp.suppliers || [];
  const supName = (id) => suppliers.find((s) => s.id === id)?.nombre || '?';

  const isApproved = quotation.estado === 'APROBADA';
  const winnerId   = quotation.proveedorGanadorId;
  const favId      = comp.favoritoSupplierId;

  const invited   = (quotation.invites || []).filter((i) => i.enviado).length;
  const responded = (quotation.invites || []).filter((i) => i.respondido).length;

  // precio cotizado de un proveedor para una fila
  const quoteFor = (row, supId) => row.quotes.find((q) => q.supplierId === supId) || null;

  return (
    <div className="space-y-4">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
        <span>{invited} invitados</span>
        <span className="text-slate-300">|</span>
        <span>{responded} respuestas</span>
        <span className="text-slate-300">|</span>
        <span>{suppliers.length} cotizaciones</span>
        {!isApproved && (
          <div className="ml-auto flex gap-2">
            {suppliers.length > 1 && (
              <Button size="sm" variant="primary" loading={autoLoading} onClick={onAutoAward}>
                Adjudicar por mejor precio
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={onInviteClick}>
              + Invitar proveedores
            </Button>
            <Button size="sm" variant="secondary" onClick={onManualClick}>
              + Cargar cotización manual
            </Button>
          </div>
        )}
      </div>

      {/* Recomendación de favorito */}
      {!isApproved && favId && suppliers.length > 0 && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <span className="text-lg flex-shrink-0">⭐</span>
          <div className="text-sm text-amber-800">
            <p className="font-semibold">Posible favorito: {supName(favId)}</p>
            <p className="text-xs mt-0.5 text-amber-700">
              Mejor total con la cobertura más amplia de ítems: <strong>{fmtCOP(comp.favoritoTotal)}</strong>
              {comp.refTotal > 0 && (
                <> · Referencia APU: {fmtCOP(comp.refTotal)}
                  {comp.ahorroVsApu != null && (
                    <span className={comp.ahorroVsApu >= 0 ? 'text-green-700' : 'text-red-600'}>
                      {' '}({comp.ahorroVsApu >= 0 ? 'ahorro' : 'sobrecosto'} {fmtCOP(Math.abs(comp.ahorroVsApu))}
                      {varPct(comp.favoritoTotal, comp.refTotal) != null && `, ${fmtVar(varPct(comp.favoritoTotal, comp.refTotal))}`})
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          {!isApproved && (
            <Button size="sm" className="ml-auto flex-shrink-0" onClick={() => onWinnerClick({ id: favId, nombre: supName(favId) })}>
              Elegir favorito
            </Button>
          )}
        </div>
      )}

      {suppliers.length === 0 ? (
        <div className="text-center py-8 text-sm text-slate-400">
          Esperando respuestas de proveedores por WhatsApp o ingreso manual.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600 w-56">Ítem</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 min-w-28 bg-slate-100">
                  Ref. APU
                </th>
                {suppliers.map((sup) => (
                  <th key={sup.id} className={`px-4 py-3 text-center text-xs font-semibold min-w-36 ${
                    winnerId === sup.id ? 'bg-green-50 text-green-700' : sup.id === favId ? 'bg-amber-50 text-amber-700' : 'text-slate-600'
                  }`}>
                    {sup.nombre}
                    {winnerId === sup.id && <span className="block text-xs text-green-500 font-normal">Ganador</span>}
                    {winnerId !== sup.id && sup.id === favId && <span className="block text-xs text-amber-500 font-normal">⭐ Favorito</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.reqItemId} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="text-sm text-slate-700">{row.descripcion}</p>
                    <p className="text-xs text-slate-400">
                      {Number(row.cantidad).toLocaleString('es-CO')} {row.unidad}
                      {row.codigoAPU && <span className="ml-1 font-mono text-slate-400">· {row.codigoAPU}</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center bg-slate-50/60">
                    {row.refPrice != null ? (
                      <span className="text-xs text-slate-500">{fmtCOP(row.refPrice)}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  {suppliers.map((sup) => {
                    const q = quoteFor(row, sup.id);
                    const isMin = q && row.mejorSupplierId === sup.id && row.quotes.length > 1;
                    return (
                      <td key={sup.id} className={`px-4 py-3 text-center ${winnerId === sup.id ? 'bg-green-50/50' : sup.id === favId ? 'bg-amber-50/40' : ''}`}>
                        {q ? (
                          <div>
                            <span className={`text-sm font-semibold ${q.excedeApu ? 'text-red-600' : isMin ? 'text-green-700' : 'text-slate-700'}`}>
                              {fmtCOP(q.precioUnitario)}
                            </span>
                            <VarBadge pct={varPct(q.precioUnitario, row.refPrice)} />
                            {isMin && !q.excedeApu && <span className="block text-xs text-green-500">más económico</span>}
                            {q.tiempoEntrega > 0 && <span className="block text-xs text-slate-400">{q.tiempoEntrega} días</span>}
                          </div>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Totales */}
              <tr className="bg-slate-50 font-semibold border-t-2 border-slate-200">
                <td className="px-4 py-3 text-sm text-slate-700">Total estimado</td>
                <td className="px-4 py-3 text-center text-xs text-slate-500 bg-slate-100">{fmtCOP(comp.refTotal)}</td>
                {suppliers.map((sup) => {
                  const lowest = Math.min(...suppliers.map((s) => s.total));
                  const isLowest = sup.total === lowest && suppliers.length > 1;
                  // Referencia APU solo de los ítems que este proveedor cotizó,
                  // para que el % sea justo aunque la cobertura sea parcial.
                  const refCubierto = rows.reduce((a, r) => {
                    return quoteFor(r, sup.id) && r.refTotal != null ? a + r.refTotal : a;
                  }, 0);
                  return (
                    <td key={sup.id} className={`px-4 py-3 text-center ${winnerId === sup.id ? 'bg-green-50' : sup.id === favId ? 'bg-amber-50' : ''}`}>
                      <span className={`text-sm font-bold ${isLowest ? 'text-green-700' : 'text-slate-700'}`}>{fmtCOP(sup.total)}</span>
                      <VarBadge pct={varPct(sup.total, refCubierto)} className="font-normal" />
                      <span className="block text-xs text-slate-400 font-normal">{sup.count}/{comp.totalItems} ítems</span>
                    </td>
                  );
                })}
              </tr>

              {/* Elegir ganador */}
              {!isApproved && (
                <tr>
                  <td className="px-4 py-3 text-xs text-slate-400" colSpan={2}>Seleccionar ganador</td>
                  {suppliers.map((sup) => (
                    <td key={sup.id} className="px-4 py-3 text-center">
                      <Button
                        size="sm"
                        variant={sup.id === favId ? 'primary' : 'secondary'}
                        onClick={() => onWinnerClick({ id: sup.id, nombre: sup.nombre })}
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
  const [manualModal, setManual]    = useState(false);
  const [winnerModal, setWinner]    = useState(null); // { id, nombre }
  const [autoLoading, setAutoLoading] = useState(false);

  const estado = ESTADO_COLOR[q.estado] || 'bg-slate-100 text-slate-600';

  const handleAutoAward = async () => {
    if (!window.confirm('Se repartirá cada ítem al proveedor de menor precio y se generará una OC por proveedor. ¿Continuar?')) return;
    setAutoLoading(true);
    try {
      await api.post(`/quotations/${q.id}/winners`, { auto: true });
      onRefresh();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al adjudicar');
    } finally {
      setAutoLoading(false);
    }
  };

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
            onManualClick={() => setManual(true)}
            onAutoAward={handleAutoAward}
            autoLoading={autoLoading}
            onRefresh={onRefresh}
          />

          {/* OC info (puede haber varias por adjudicación dividida) */}
          {(q.purchaseOrders?.length > 0) && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 space-y-2">
              <p className="font-semibold">
                {q.purchaseOrders.length > 1
                  ? `${q.purchaseOrders.length} Órdenes de Compra emitidas`
                  : 'Orden de Compra emitida'}
              </p>
              {q.purchaseOrders.map((oc) => (
                <div key={oc.id} className="flex items-center justify-between gap-2 border-t border-green-100 pt-1 first:border-0 first:pt-0">
                  <span className="font-medium">{oc.consecutivo}</span>
                  <span>{fmtCOP(oc.montoTotal)}</span>
                  {oc.fechaEntregaPactada && <span className="text-green-600">Entrega {fmtDate(oc.fechaEntregaPactada)}</span>}
                </div>
              ))}
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
      {manualModal && (
        <ManualQuoteModal
          quotation={q}
          onClose={() => setManual(false)}
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
