import { useState } from 'react';
import Button from './Button';

const TIPO_LABELS = {
  APU: { label: 'APU', color: 'bg-blue-100 text-blue-700' },
  BASICOS: { label: 'Precios Básicos', color: 'bg-green-100 text-green-700' },
  PRESUPUESTO: { label: 'Presupuesto', color: 'bg-purple-100 text-purple-700' },
  OTRO: { label: 'Otro (omitir)', color: 'bg-slate-100 text-slate-500' },
};

const TIPOS = ['APU', 'BASICOS', 'PRESUPUESTO', 'OTRO'];
const CAMPOS = ['codigo', 'descripcion', 'unidad', 'cantidad', 'precioUnitario'];
const CAMPOS_LABELS = {
  codigo: 'Código',
  descripcion: 'Descripción',
  unidad: 'Unidad',
  cantidad: 'Cantidad',
  precioUnitario: 'Precio unitario',
};

function SheetPreview({ sheet, onChange }) {
  const tipo = TIPO_LABELS[sheet.tipo] || TIPO_LABELS.OTRO;
  const previewHeaders = sheet.preview[0] ? Object.keys(sheet.preview[0]) : [];

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Header de la hoja */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-800">{sheet.nombre}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${tipo.color}`}>{tipo.label}</span>
        </div>
        <select
          value={sheet.tipo}
          onChange={(e) => onChange({ ...sheet, tipo: e.target.value })}
          className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABELS[t].label}</option>)}
        </select>
      </div>

      {sheet.tipo !== 'OTRO' && (
        <>
          {/* Razon de la IA */}
          {sheet.razon && (
            <div className="px-4 py-2 bg-blue-50 border-b border-slate-200">
              <p className="text-xs text-blue-600">🤖 {sheet.razon}</p>
            </div>
          )}

          {/* Mapeo de columnas */}
          <div className="px-4 py-3 border-b border-slate-200">
            <p className="text-xs font-medium text-slate-600 mb-2">Mapeo de columnas</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CAMPOS.map((campo) => (
                campo === 'cantidad' && sheet.tipo === 'BASICOS' ? null : (
                  <div key={campo}>
                    <label className="block text-xs text-slate-500 mb-0.5">{CAMPOS_LABELS[campo]}</label>
                    <select
                      value={sheet.columnas[campo] || ''}
                      onChange={(e) => onChange({
                        ...sheet,
                        columnas: { ...sheet.columnas, [campo]: e.target.value || null },
                      })}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">(sin asignar)</option>
                      {sheet.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                )
              ))}
            </div>
          </div>

          {/* Preview tabla */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50">
                  {previewHeaders.slice(0, 6).map((h) => (
                    <th key={h} className="px-3 py-2 text-left text-slate-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.preview.map((row, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    {previewHeaders.slice(0, 6).map((h) => (
                      <td key={h} className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[180px] truncate">
                        {String(row[h] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.preview.length === 5 && (
              <p className="text-xs text-slate-400 px-3 py-2">Mostrando primeras 5 filas…</p>
            )}
          </div>
        </>
      )}

      {sheet.tipo === 'OTRO' && (
        <div className="px-4 py-3 text-xs text-slate-400">Esta hoja será omitida en la importación.</div>
      )}
    </div>
  );
}

export default function ImportWizard({ data, onConfirm, onCancel, loading }) {
  const [sheets, setSheets] = useState(data.sheets);

  const updateSheet = (idx, updated) => {
    setSheets((prev) => prev.map((s, i) => (i === idx ? updated : s)));
  };

  const activeSheets = sheets.filter((s) => s.tipo !== 'OTRO');
  const summary = {
    APU: activeSheets.filter((s) => s.tipo === 'APU').length,
    BASICOS: activeSheets.filter((s) => s.tipo === 'BASICOS').length,
    PRESUPUESTO: activeSheets.filter((s) => s.tipo === 'PRESUPUESTO').length,
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Previsualización de importación</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Revisa lo que detectó la IA. Puedes ajustar el tipo y el mapeo de columnas antes de confirmar.
            </p>
          </div>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 text-xl font-light ml-4">✕</button>
        </div>

        {/* Resumen */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex gap-4 flex-shrink-0">
          {summary.APU > 0 && <span className="text-xs font-medium text-blue-700">📐 {summary.APU} hoja(s) APU</span>}
          {summary.BASICOS > 0 && <span className="text-xs font-medium text-green-700">💰 {summary.BASICOS} hoja(s) Básicos</span>}
          {summary.PRESUPUESTO > 0 && <span className="text-xs font-medium text-purple-700">📊 {summary.PRESUPUESTO} hoja(s) Presupuesto</span>}
          {activeSheets.length === 0 && <span className="text-xs text-slate-400">Todas las hojas marcadas como "Otro" — nada se importará.</span>}
        </div>

        {/* Contenido scrolleable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {sheets.map((sheet, idx) => (
            <SheetPreview
              key={sheet.nombre}
              sheet={sheet}
              onChange={(updated) => updateSheet(idx, updated)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-end gap-3 flex-shrink-0">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancelar</Button>
          <Button
            onClick={() => onConfirm({ sessionKey: data.sessionKey, confirmedSheets: sheets })}
            loading={loading}
            disabled={activeSheets.length === 0}
          >
            ✅ Confirmar e importar ({activeSheets.length} hoja{activeSheets.length !== 1 ? 's' : ''})
          </Button>
        </div>
      </div>
    </div>
  );
}
