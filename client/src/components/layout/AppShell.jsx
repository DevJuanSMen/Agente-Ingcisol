import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useProjectStore } from '../../store/projectStore';

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const loadProjects = useProjectStore((s) => s.loadProjects);

  useEffect(() => {
    loadProjects();
  }, []);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-60 flex flex-col min-h-screen">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
