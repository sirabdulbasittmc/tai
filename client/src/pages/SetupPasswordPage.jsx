import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

export default function SetupPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token');
  const [info, setInfo] = useState(null);
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Validate token + fetch password rules
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    Promise.all([
      api.get(`/user/invite/${token}`).then(r => r.data).catch(() => ({ valid: false, error: 'Invalid invitation link' })),
      api.get(`/user/password-rules/${token}`).then(r => r.data).catch(() => ({ minLength: 8, requireUppercase: true, requireNumber: true, requireSpecial: true })),
    ]).then(([tokenInfo, pwRules]) => {
      setInfo(tokenInfo);
      setRules(pwRules);
      setLoading(false);
    });
  }, [token]);

  // Auto-redirect after password set
  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => navigate('/login'), 2000);
    return () => clearTimeout(timer);
  }, [success, navigate]);

  // Live password validation
  const getChecks = () => {
    if (!rules) return [];
    return [
      { label: `At least ${rules.minLength} characters`, pass: password.length >= rules.minLength },
      ...(rules.requireUppercase ? [{ label: 'One uppercase letter (A-Z)', pass: /[A-Z]/.test(password) }] : []),
      ...(rules.requireNumber ? [{ label: 'One number (0-9)', pass: /[0-9]/.test(password) }] : []),
      ...(rules.requireSpecial ? [{ label: 'One special character (!@#$...)', pass: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password) }] : []),
    ];
  };

  const checks = getChecks();
  const allPassed = checks.length > 0 && checks.every(c => c.pass);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!allPassed) { setError('Password does not meet the requirements'); return; }
    setSubmitting(true);
    try {
      await api.post('/user/setup-password', { token, password });
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to set password');
    }
    setSubmitting(false);
  };

  // Loading
  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <img src="/api/health/logo" alt="TMC" className="login-logo" />
            <h1 className="login-title">Set Up Your Account</h1>
          </div>
          <p style={{ textAlign: 'center', color: '#888' }}>Verifying invitation...</p>
        </div>
      </div>
    );
  }

  // Invalid token
  if (!token || !info?.valid) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <img src="/api/health/logo" alt="TMC" className="login-logo" />
            <h1 className="login-title">Invalid Link</h1>
          </div>
          <div className="login-error" style={{ marginBottom: 16 }}>
            {info?.error || 'This invitation link is invalid or has expired.'}
          </div>
          <p style={{ fontSize: 13, color: '#888', textAlign: 'center' }}>
            Please contact your administrator to get a new invitation.
          </p>
        </div>
      </div>
    );
  }

  // Success
  if (success) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-header">
            <img src="/api/health/logo" alt="TMC" className="login-logo" />
            <h1 className="login-title">Password Set!</h1>
            <p className="login-subtitle">Your account is ready</p>
          </div>
          <div style={{ textAlign: 'center', margin: '20px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>&#10003;</div>
            <p style={{ color: '#4ade80', fontWeight: 600, marginBottom: 8 }}>Your password has been set successfully.</p>
            <p style={{ color: '#888', fontSize: 13 }}>Redirecting to login...</p>
          </div>
        </div>
      </div>
    );
  }

  // Password form
  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/api/health/logo" alt="TMC" className="login-logo" />
          <h1 className="login-title">Set Up Your Password</h1>
          <p className="login-subtitle">Welcome, {info.name}</p>
        </div>

        <div style={{ background: '#252525', borderRadius: 8, padding: 12, marginBottom: 20, fontSize: 13 }}>
          <div style={{ color: '#888' }}>Email: <span style={{ color: '#e8e8e0' }}>{info.email}</span></div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="login-error">{error}</div>}

          <div className="login-field">
            <label htmlFor="password">New Password</label>
            <input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required autoComplete="new-password" autoFocus />
          </div>

          {/* Password complexity checklist — always visible */}
          {checks.length > 0 && (
            <div className="pw-checks">
              <div className="pw-checks-title">Password must contain:</div>
              {checks.map((c, i) => (
                <div key={i} className={`pw-check ${password.length === 0 ? '' : c.pass ? 'pass' : 'fail'}`}>
                  <span className="pw-check-icon">{password.length === 0 ? '○' : c.pass ? '✓' : '✗'}</span>
                  {c.label}
                </div>
              ))}
            </div>
          )}

          <div className="login-field">
            <label htmlFor="confirm">Confirm Password</label>
            <input id="confirm" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter your password" required autoComplete="new-password" />
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
            )}
          </div>

          <button type="submit" className="login-btn" disabled={submitting || !allPassed || password !== confirmPassword}>
            {submitting ? 'Setting up...' : 'Set Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
