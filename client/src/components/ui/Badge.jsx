const STATUS_MAP = {
  // Requisiciones
  BORRADOR:        'bg-slate-100 text-slate-600',
  PENDIENTE_JUST:  'bg-orange-100 text-orange-700',
  ENVIADA:         'bg-blue-100 text-blue-700',
  APROBADA:        'bg-green-100 text-green-700',
  RECHAZADA:       'bg-red-100 text-red-700',
  EN_COTIZACION:   'bg-purple-100 text-purple-700',
  OC_EMITIDA:      'bg-indigo-100 text-indigo-700',
  CERRADA:         'bg-slate-100 text-slate-500',
  EXPIRADA:        'bg-zinc-200 text-zinc-600',

  // Órdenes de compra
  EMITIDA:         'bg-blue-100 text-blue-700',
  ENVIADA_OC:      'bg-cyan-100 text-cyan-700',
  ENTREGADA:       'bg-teal-100 text-teal-700',
  PAGADA:          'bg-green-100 text-green-700',
  COMPLETADA:      'bg-emerald-100 text-emerald-700',
  CANCELADA:       'bg-red-100 text-red-600',

  // Cotizaciones
  EN_BUSQUEDA:          'bg-yellow-100 text-yellow-700',
  PENDIENTE_APROBACION: 'bg-orange-100 text-orange-700',

  // Semáforo
  VERDE:     'bg-green-100 text-green-700',
  AMARILLO:  'bg-yellow-100 text-yellow-700',
  ROJO:      'bg-red-100 text-red-700',
  SIN_FECHA: 'bg-slate-100 text-slate-500',

  // Homologación
  HOMOLOGADO:   'bg-green-100 text-green-700',
  NO_HOMOLOGADO: 'bg-orange-100 text-orange-700',
};

const LABELS = {
  PENDIENTE_JUST: 'PENDIENTE JUST.',
  EN_COTIZACION: 'EN COTIZACIÓN',
  OC_EMITIDA: 'OC EMITIDA',
  EN_BUSQUEDA: 'EN BÚSQUEDA',
  PENDIENTE_APROBACION: 'PEND. APROBACIÓN',
  SIN_FECHA: 'SIN FECHA',
};

export default function Badge({ status, label }) {
  const text = label || LABELS[status] || status;
  const classes = STATUS_MAP[status] || 'bg-slate-100 text-slate-600';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes}`}>
      {text}
    </span>
  );
}
