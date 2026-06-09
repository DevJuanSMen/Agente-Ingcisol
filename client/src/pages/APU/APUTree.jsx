import { useEffect, useState, useRef } from 'react';
import api from '../../api/client';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import ImportWizard from '../../components/ui/ImportWizard';

const fmtCOP = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const pct = (saldo, total) => {
  if (!total || Number(total) === 0) return 0;
  return Math.round((1 - Number(saldo) / Number(total)) * 100);
};

const ItemRow = ({ item }) => {
  const ejecutado = pct(item.saldoValor, item.cantidad * item.precioUnitario);
  return (
    <div className="py-2.5 px-3 hover:bg-slate-50 rounded-lg">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-slate-400 font-mono flex-shrink-0">{item.codigo}</span>
          <span className="text-sm text-slate-700 truncate">{item.descripcion}</span>
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <span className="text-xs text-slate-500">{item.unidad}</span>
          <span className="text-xs text-slate-600 ml-2">{fmtCOP(item.precioUnitario)}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${ejecutado > 90 ? 'bg-danger' : ejecutado > 60 ? 'bg-warning' : 'bg-success'}`}
            style={{ width: `${ejecutado}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 w-10 text-right">{ejecutado}%</span>
        <span className="text-xs text-slate-500 w-28 text-right">Saldo: {fmtCOP(item.saldoValor)}</span>
      </div>
    </div>
  );
};

const ChapterRow = ({ capitulo }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
      >
        <span className="text-slate-400">{open ? '▼' : '▶'}</span>
        <span className="text-sm font-semibold text-slate-700">Capítulo {capitulo.capitulo}</span>
        <span className="text-xs text-slate-400 ml-auto">{capitulo.items.length} ítems</span>
      </button>
      {open && (
        <div className="mt-1 ml-2 border-l-2 border-slate-200 pl-3">
          {capitulo.items.map((item) => <ItemRow key={item.id} item={item} />)}
        </div>
      )}
    </div>
  );
};

export default function APUTree() {
  const [treeData, setTreeData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [wizardData, setWizardData] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    api.get('/apu')
      .then((r) => setTreeData(r.data.data))
      .catch(() => setTreeData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setAnalyzing(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const r = await api.post('/apu/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setWizardData(r.data.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Error al analizar el archivo. Verifica que sea un Excel válido.');
    } finally {
      setAnalyzing(false);
      e.target.value = '';
    }
  };

  const handleConfirm = async ({ sessionKey, confirmedSheets }) => {
    setConfirming(true);
    try {
      const r = await api.post('/apu/confirm', { sessionKey, confirmedSheets });
      setWizardData(null);
      setImportResult(r.data.data.resultados);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Error al importar. Intenta de nuevo.');
    } finally {
      setConfirming(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">APU</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {treeData?.project?.nombre || 'Sin proyecto activo'}
          </p>
        </div>
        <div>
          <input
            type="file"
            accept=".xlsx,.xls"
            ref={fileRef}
            onChange={handleFileChange}
            className="hidden"
          />
          <Button
            variant="secondary"
            loading={analyzing}
            onClick={() => fileRef.current.click()}
          >
            🤖 Importar con IA
          </Button>
        </div>
      </div>

      {/* Resultado de importación */}
      {importResult && (
        <Card>
          <div className="space-y-2">
            <p className="text-sm font-semibold text-slate-700 mb-3">✅ Importación completada</p>
            {importResult.map((r) => (
              <div key={r.nombre} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-600">{r.nombre}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    r.tipo === 'APU' ? 'bg-blue-100 text-blue-700' :
                    r.tipo === 'BASICOS' ? 'bg-green-100 text-green-700' :
                    r.tipo === 'PRESUPUESTO' ? 'bg-purple-100 text-purple-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>{r.tipo}</span>
                  {r.omitida && <span className="text-xs text-slate-400">omitida</span>}
                  {r.error && <span className="text-xs text-red-500">{r.error}</span>}
                </div>
                {!r.omitida && !r.error && (
                  <span className="text-xs text-slate-500">{r.count} registros</span>
                )}
              </div>
            ))}
            <button onClick={() => setImportResult(null)} className="text-xs text-slate-400 hover:text-slate-600 mt-2">
              Cerrar
            </button>
          </div>
        </Card>
      )}

      {!treeData || treeData.tree?.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="text-5xl mb-4">📐</div>
            <p className="text-sm font-medium text-slate-600 mb-2">Sin ítems APU cargados</p>
            <p className="text-xs text-slate-400 mb-4">
              Sube un Excel y la IA mapeará automáticamente tus APUs, precios básicos y presupuesto.
            </p>
            <Button variant="secondary" onClick={() => fileRef.current.click()} loading={analyzing}>
              🤖 Importar con IA
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          {treeData.tree.map((cap) => <ChapterRow key={cap.capitulo} capitulo={cap} />)}
        </Card>
      )}

      {wizardData && (
        <ImportWizard
          data={wizardData}
          onConfirm={handleConfirm}
          onCancel={() => setWizardData(null)}
          loading={confirming}
        />
      )}
    </div>
  );
}
