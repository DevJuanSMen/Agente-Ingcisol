import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';

import AppShell from './components/layout/AppShell';
import Login from './pages/Login';
import Register from './pages/Register';
import ForgotPassword from './pages/ForgotPassword';
import Dashboard from './pages/Dashboard';

import ProjectList from './pages/Projects/ProjectList';
import ProjectForm from './pages/Projects/ProjectForm';
import ProjectDashboard from './pages/Projects/ProjectDashboard';
import BudgetUpload from './pages/Projects/BudgetUpload';

import DelegationList from './pages/Delegations/DelegationList';
import DelegationForm from './pages/Delegations/DelegationForm';

import RequisitionList from './pages/Requisitions/RequisitionList';
import RequisitionNew from './pages/Requisitions/RequisitionNew';
import QuotationList from './pages/Quotations/QuotationList';
import OrderList from './pages/Orders/OrderList';
import TrackingBoard from './pages/Tracking/TrackingBoard';
import APUTree from './pages/APU/APUTree';
import BasicPriceList from './pages/BasicPrices/BasicPriceList';
import MasterImport from './pages/Import/MasterImport';
import SupplierList from './pages/Suppliers/SupplierList';
import CompanyProfile from './pages/Company/CompanyProfile';
import UsersSettings from './pages/Settings/UsersSettings';
import PermissionsSettings from './pages/Settings/PermissionsSettings';
import SuperadminPanel from './pages/Settings/SuperadminPanel';
import OnboardingWizard from './pages/Onboarding/OnboardingWizard';
import PendingSetup from './pages/Onboarding/PendingSetup';
import ApprovalPending from './pages/Onboarding/ApprovalPending';

function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

function FullScreenLoader() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// Onboarding obligatorio: mientras la empresa no complete la configuración
// inicial, el director va al wizard y el resto del equipo ve la pantalla de
// espera. El estado autoritativo viene del backend (refreshUser al montar,
// para no confiar en el usuario persistido en localStorage).
function RequireSetup({ children }) {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  useEffect(() => { refreshUser(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return <FullScreenLoader />;
  if (user.esSuperadmin) return children;

  // Usuario persistido de una versión anterior (sin el campo): esperar el refresh.
  const company = user.company || {};
  if (!('setupCompletedAt' in company)) return <FullScreenLoader />;

  if (!company.setupCompletedAt) {
    if (user.rol === 'DIRECTOR') return <Navigate to="/onboarding" replace />;
    return <PendingSetup />;
  }
  // Onboarding completo pero el superadmin aún no aprobó (o rechazó) la
  // configuración inicial: nadie de la empresa entra al panel hasta entonces.
  if (company.approvalStatus && company.approvalStatus !== 'APPROVED') return <ApprovalPending />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route
          path="/onboarding"
          element={
            <ProtectedRoute>
              <OnboardingWizard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <RequireSetup>
                <AppShell />
              </RequireSetup>
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />

          {/* Proyectos */}
          <Route path="projects" element={<ProjectList />} />
          <Route path="projects/new" element={<ProjectForm />} />
          <Route path="projects/:id/edit" element={<ProjectForm />} />
          <Route path="projects/:id/dashboard" element={<ProjectDashboard />} />
          <Route path="projects/:id/budget" element={<BudgetUpload />} />

          {/* Delegaciones */}
          <Route path="delegations" element={<DelegationList />} />
          <Route path="delegations/new" element={<DelegationForm />} />

          {/* Módulos operativos */}
          <Route path="requisitions" element={<RequisitionList />} />
          <Route path="requisitions/new" element={<RequisitionNew />} />
          <Route path="quotations" element={<QuotationList />} />
          <Route path="orders" element={<OrderList />} />
          <Route path="tracking" element={<TrackingBoard />} />
          <Route path="import" element={<MasterImport />} />
          <Route path="apu" element={<APUTree />} />
          <Route path="basic-prices" element={<BasicPriceList />} />
          <Route path="suppliers" element={<SupplierList />} />
          <Route path="company" element={<CompanyProfile />} />
          <Route path="settings/users" element={<UsersSettings />} />
          <Route path="settings/permissions" element={<PermissionsSettings />} />
          <Route path="admin" element={<SuperadminPanel />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
