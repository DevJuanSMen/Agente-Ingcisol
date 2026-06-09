export default function EmptyState({ icon = '📭', title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      {title && <h3 className="text-base font-semibold text-slate-600 mb-1">{title}</h3>}
      {description && <p className="text-sm text-slate-400 mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  );
}
