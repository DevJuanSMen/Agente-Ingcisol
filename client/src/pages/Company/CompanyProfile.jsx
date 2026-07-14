import CompanyForm from '../../components/company/CompanyForm';

// Página /company: envuelve el formulario compartido (también usado por el
// paso 1 del onboarding) con el encabezado de la vista.
export default function CompanyProfile() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Perfil de Empresa</h1>
        <p className="text-sm text-slate-500 mt-0.5">Datos generales, logo y firma digital</p>
      </div>
      <CompanyForm offsetSidebar />
    </div>
  );
}
