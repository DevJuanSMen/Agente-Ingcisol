import Button from './Button';

// Barra de guardado fija al fondo de la pantalla: el botón Guardar queda siempre
// visible aunque el formulario sea largo (datos + logo + firma). Muestra un
// indicador de cambios sin guardar y el "✓ Guardado" efímero.
//
// `formId` permite disparar el submit nativo de un <form> que está más arriba
// (sin duplicar el handler). `offsetSidebar` la alinea con el contenido cuando
// hay sidebar (layout principal); en vistas de ancho completo (wizard) va sin él.
export default function StickySaveBar({ dirty, saving, saved, formId, onSave, offsetSidebar = false, children }) {
  return (
    <div
      className={`fixed bottom-0 right-0 left-0 ${offsetSidebar ? 'lg:left-60' : ''} z-20
        bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]`}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-3 max-w-3xl">
        <div className="text-sm min-h-[1.25rem]">
          {saved ? (
            <span className="text-green-600 font-medium">✓ Guardado</span>
          ) : dirty ? (
            <span className="flex items-center gap-2 text-amber-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Cambios sin guardar
            </span>
          ) : (
            <span className="text-slate-400">Sin cambios pendientes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {children}
          <Button type={formId ? 'submit' : 'button'} form={formId} onClick={onSave} loading={saving} disabled={!dirty && !saving}>
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
