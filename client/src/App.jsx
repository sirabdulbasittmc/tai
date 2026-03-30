import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import ChatPage from './pages/ChatPage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import SetupPasswordPage from './pages/SetupPasswordPage';
import SchedulerPage from './pages/SchedulerPage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <div className="app-loading">Loading...</div>;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <Routes>
      {/* Public — no auth needed, render immediately */}
      <Route path="/setup-password" element={<SetupPasswordPage />} />
      <Route path="/login" element={<LoginRoute />} />

      {/* Protected */}
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="/schedules" element={<ProtectedRoute><SchedulerPage /></ProtectedRoute>} />
      <Route path="/*" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
    </Routes>
  );
}
