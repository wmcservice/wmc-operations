import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { initStore } from './data/store';
import { supabase } from './lib/supabaseClient';
import Sidebar from './components/Sidebar';
import Topbar from './components/Topbar';
import Dashboard from './pages/Dashboard';
import Jobs from './pages/Jobs';
import Scheduler from './pages/Scheduler';
import StaffPage from './pages/Staff';
import Performance from './pages/Performance';
import Settings from './pages/Settings';
import Login from './pages/Login';
import './styles/global.css';

// Initialize localStorage with seed data if empty
initStore();

export default function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const toggleSidebar = () => setSidebarCollapsed(c => !c);
  const toggleMobileSidebar = () => setMobileSidebarOpen(o => !o);

  if (loading) {
    return <div className="loading-screen" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>กำลังโหลด...</div>;
  }

  if (!session) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          user={session.user}
        />
        <div className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
          <Topbar onMenuToggle={toggleMobileSidebar} user={session.user} />
          <Routes>
            <Route path="/" element={<Dashboard user={session.user} />} />
            <Route path="/jobs" element={<Jobs user={session.user} />} />
            <Route path="/scheduler" element={<Scheduler user={session.user} />} />
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/performance" element={<Performance />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
}
