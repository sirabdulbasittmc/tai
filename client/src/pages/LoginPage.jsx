import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function LoginPage() {
  const { login, appName, logoUrl } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e) => {
    e.preventDefault();
    if (!forgotEmail) return;
    setForgotSending(true);
    setForgotMsg('');
    try {
      const res = await api.post('/user/forgot-password', { email: forgotEmail, baseUrl: window.location.origin });
      setForgotMsg(res.data.message);
    } catch {
      setForgotMsg('If an account exists with that email, a reset link has been sent.');
    }
    setForgotSending(false);
  };

  // Forgot Password view
  if (showForgot) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <img src="/api/health/logo" alt="TMC" className="login-logo" />
            <h1 className="login-title">Reset Password</h1>
            <p className="login-subtitle">Enter your email to receive a reset link</p>
          </div>

          <form onSubmit={handleForgot} className="login-form">
            {forgotMsg && (
              <div className="settings-msg" style={{ fontSize: 13 }}>{forgotMsg}</div>
            )}

            <div className="login-field">
              <label htmlFor="forgotEmail">Email</label>
              <input
                id="forgotEmail"
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                placeholder="name@company.com"
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <button type="submit" className="login-btn" disabled={forgotSending}>
              {forgotSending ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="login-footer">
            <button className="login-link" onClick={() => { setShowForgot(false); setForgotMsg(''); }}>
              Back to Sign In
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Login view
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/api/health/logo" alt="TMC" className="login-logo" />
          <h1 className="login-title">{appName || 'AI Intelligence'}</h1>
          <p className="login-subtitle">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label htmlFor="email">Email or Employee Code</label>
            <input
              id="email" type="text" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="name@company.com or EMP-001"
              required autoFocus autoComplete="username"
            />
          </div>

          <div className="login-field">
            <label htmlFor="password">Password</label>
            <input
              id="password" type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter your password"
              required autoComplete="current-password"
            />
          </div>

          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="login-footer">
          <button className="login-link" onClick={() => setShowForgot(true)}>
            Forgot password?
          </button>
        </div>
      </div>
    </div>
  );
}
