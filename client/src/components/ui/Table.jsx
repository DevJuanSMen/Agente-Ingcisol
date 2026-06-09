import EmptyState from './EmptyState';

export default function Table({ columns, data, loading, emptyMessage = 'Sin datos' }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <EmptyState title={emptyMessage} description="No hay registros para mostrar." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200">
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide py-3 px-4 whitespace-nowrap"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.id || i}
              className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
            >
              {columns.map((col) => (
                <td key={col.key} className="py-3 px-4 text-slate-700">
                  {col.render ? col.render(row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
