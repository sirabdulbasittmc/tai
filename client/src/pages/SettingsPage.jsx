import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState({ city: '', contactNumber: '', aboutMe: '', instructions: '', gender: '', preferredTitle: '' });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/profile').then(res => {
      const p = res.data.profile || {};
      setProfile({ city: p.city || '', contactNumber: p.contactNumber || '', aboutMe: p.aboutMe || '', instructions: p.instructions || '', gender: p.gender || '', preferredTitle: p.preferredTitle || '' });
    }).catch(() => {});
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setMsg('');
    try {
      await api.put('/profile', profile);
      setMsg('Profile saved');
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  const changePassword = async () => {
    if (!passwords.currentPassword || !passwords.newPassword) return;
    setSaving(true);
    setMsg('');
    try {
      await api.post('/user/change-password', passwords);
      setMsg('Password changed');
      setPasswords({ currentPassword: '', newPassword: '' });
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to change password');
    }
    setSaving(false);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const [intStatus, setIntStatus] = useState(null);

  useEffect(() => {
    api.get('/integration/status').then(r => setIntStatus(r.data)).catch(() => {});
  }, []);

  // Tone is auto-learned by AI from conversations — no manual setting needed

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back to Chat
          </button>
          <h1>Settings</h1>
        </div>

        {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('incorrect') ? 'error' : ''}`}>{msg}</div>}

        {/* User Info */}
        <section className="settings-section">
          <h2>Account</h2>
          <div className="settings-info">
            <div><span className="info-label">Name</span><span>{user?.name}</span></div>
            <div><span className="info-label">Email</span><span>{user?.email}</span></div>
            <div><span className="info-label">Employee Code</span><span>{user?.empcode}</span></div>
            <div><span className="info-label">Department</span><span>{user?.department || '—'}</span></div>
            <div><span className="info-label">User Type</span><span className="badge-type">{user?.userType} — {user?.label}</span></div>
            <div><span className="info-label">Client</span><span>{user?.clientNumber}</span></div>
          </div>
        </section>

        {/* Job Description (read-only) */}
        {user?.jobDescription && (
          <section className="settings-section">
            <h2>Job Description</h2>
            <p className="settings-readonly">{user.jobDescription}</p>
          </section>
        )}

        {/* AI Personalization */}
        <section className="settings-section">
          <h2>AI Personalization</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="settings-field">
              <label>City</label>
              <input value={profile.city} onChange={e => setProfile(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Karachi" />
            </div>
            <div className="settings-field">
              <label>Contact Number (Mobile/WhatsApp)</label>
              <input value={profile.contactNumber} onChange={e => setProfile(p => ({ ...p, contactNumber: e.target.value }))} placeholder="e.g. +92 300 1234567" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="settings-field">
              <label>Gender</label>
              <select value={profile.gender} onChange={e => setProfile(p => ({ ...p, gender: e.target.value }))} style={{ width: '100%', padding: '8px', background: '#2a2a2a', border: '1px solid #444', color: '#eee', borderRadius: 8, fontSize: 13 }}>
                <option value="">— Select —</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="settings-field">
              <label>How should AI address you?</label>
              <input value={profile.preferredTitle} onChange={e => setProfile(p => ({ ...p, preferredTitle: e.target.value }))} placeholder="e.g. Sir, Boss, Ma'am, Madam, Basit Sahab" />
              <p style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Your agents will use this to address you</p>
            </div>
          </div>
          <div className="settings-field">
            <label>About Me</label>
            <textarea rows={3} value={profile.aboutMe} onChange={e => setProfile(p => ({ ...p, aboutMe: e.target.value }))} placeholder="Tell the AI about yourself — background, working style, what you focus on..." />
          </div>
          <div className="settings-field">
            <label>Custom Instructions</label>
            <textarea rows={3} value={profile.instructions} onChange={e => setProfile(p => ({ ...p, instructions: e.target.value }))} placeholder="e.g. Always flag project risks. Show amounts in PKR. Focus on delivery metrics." />
          </div>
          <button className="settings-btn" onClick={saveProfile} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>
          <p style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Tip: You can also update these by telling the AI naturally — e.g. "I live in Karachi" or "remember my number is 0300-1234567"</p>
        </section>

        {/* Email & Calendar Integration */}
        <IntegrationSection userId={user?.id} />

        {/* WhatsApp */}
        <WhatsAppSection />

        {/* Change Password */}
        <section className="settings-section">
          <h2>Change Password</h2>
          <div className="settings-field">
            <label>Current Password</label>
            <input type="password" value={passwords.currentPassword} onChange={e => setPasswords(p => ({ ...p, currentPassword: e.target.value }))} autoComplete="current-password" />
          </div>
          <div className="settings-field">
            <label>New Password</label>
            <input type="password" value={passwords.newPassword} onChange={e => setPasswords(p => ({ ...p, newPassword: e.target.value }))} autoComplete="new-password" />
          </div>
          <button className="settings-btn" onClick={changePassword} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</button>
        </section>

        {/* Logout */}
        <section className="settings-section">
          <button className="settings-btn danger" onClick={handleLogout}>Sign Out</button>
        </section>
      </div>
    </div>
  );
}

function IntegrationSection({ userId }) {
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { loadStatus(); }, []);

  const loadStatus = async () => {
    try { const res = await api.get('/integration/status'); setStatus(res.data); } catch {}
  };

  const connect = async () => {
    try {
      const res = await api.get(`/integration/connect/${userId}`);
      window.open(res.data.url, '_blank', 'width=600,height=700');
      const poll = setInterval(async () => {
        try {
          const s = await api.get('/integration/status');
          if (s.data.connected) { clearInterval(poll); setStatus(s.data); setMsg('Connected successfully!'); }
        } catch {}
      }, 3000);
      setTimeout(() => clearInterval(poll), 120000);
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const test = async () => {
    setTesting(true); setMsg('');
    try {
      const res = await api.post(`/integration/test/${userId}`);
      if (res.data.success) {
        setMsg(`Connection OK — Email: ${res.data.email}, Calendars: ${res.data.calendarCount}`);
        loadStatus();
      } else {
        setMsg(`Error: ${res.data.error}`);
      }
    } catch { setMsg('Test failed'); }
    setTesting(false);
  };

  const disconnect = async () => {
    try {
      await api.delete(`/integration/disconnect/${userId}`);
      setStatus({ connected: false });
      setMsg('Disconnected');
    } catch { setMsg('Failed to disconnect'); }
  };

  if (!userId) return null;

  return (
    <section className="settings-section">
      <h2>Email & Calendar</h2>
      {msg && <div className={`settings-msg ${msg.includes('Error') || msg.includes('Failed') ? 'error' : ''}`} style={{ marginBottom: 10 }}>{msg}</div>}

      {status === null ? (
        <p style={{ color: '#888', fontSize: 13 }}>Loading...</p>
      ) : !status.connected ? (
        <div>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 10 }}>Connect your Google account to let the AI read your emails and manage your calendar.</p>
          <button className="settings-btn" onClick={connect}>Connect Google (Gmail + Calendar)</button>
        </div>
      ) : (
        <div>
          <div className="settings-info" style={{ marginBottom: 12 }}>
            <div>
              <span className="info-label">Provider</span>
              <span>{status.provider === 'google' ? 'Google' : 'Microsoft'}</span>
            </div>
            <div>
              <span className="info-label">Email</span>
              <span>{status.email}</span>
            </div>
            <div>
              <span className="info-label">Scopes</span>
              <span>{status.scopes}</span>
            </div>
            <div>
              <span className="info-label">Status</span>
              <span style={{ color: status.status === 'active' ? '#4ade80' : '#ef4444' }}>{status.status}</span>
            </div>
          </div>

          {status.error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: '#ef4444' }}>
              {status.error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="settings-btn" onClick={test} disabled={testing} style={{ background: 'transparent', border: '1px solid #4ade80', color: '#4ade80' }}>
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button className="settings-btn" onClick={connect} style={{ background: 'transparent', border: '1px solid #f59e0b', color: '#f59e0b' }}>
              Reconnect
            </button>
            <button className="settings-btn" onClick={disconnect} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444' }}>
              Disconnect
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Once connected, you can ask the AI: "check my emails", "what's on my calendar today", "send email to..."</p>

          {/* Permission Toggles */}
          <PermissionToggles userId={userId} currentPermissions={status.permissions || 'email_read,calendar_read'} />
        </div>
      )}
    </section>
  );
}

function WhatsAppSection() {
  const [waStatus, setWaStatus] = useState(null);      // user's own registration
  const [companyWa, setCompanyWa] = useState(null);     // company bot number
  const [waPhone, setWaPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    // Load user's WhatsApp registration
    api.get('/agents/whatsapp/status').then(res => {
      setWaStatus(res.data);
      if (res.data.phoneNumber) setWaPhone(res.data.phoneNumber);
    }).catch(() => setWaStatus({ connected: false }));

    // Load company's bot WhatsApp number (from tenant config)
    api.get('/admin/whatsapp/status').then(res => {
      if (res.data?.connected_number) setCompanyWa(res.data);
    }).catch(() => {});
  }, []);

  const registerNumber = async () => {
    const clean = waPhone.replace(/[\s-]/g, '');
    if (!clean || !/^\+?\d{10,15}$/.test(clean)) {
      setMsg('Enter a valid phone number (e.g. +923001234567)');
      return;
    }
    setSaving(true); setMsg('');
    try {
      await api.post('/agents/whatsapp/connect', { phoneNumber: clean });
      setMsg('Your WhatsApp number is registered! You can now message the company AI number below.');
      setWaStatus({ connected: true, phoneNumber: clean });
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to register'); }
    setSaving(false);
  };

  const unregisterNumber = async () => {
    setSaving(true); setMsg('');
    try {
      await api.delete('/agents/whatsapp/connect');
      setWaStatus({ connected: false });
      setWaPhone('');
      setMsg('Your WhatsApp number has been removed');
    } catch { setMsg('Failed to remove'); }
    setSaving(false);
  };

  // Don't show section if company hasn't configured WhatsApp at all
  if (!companyWa && !waStatus?.connected) {
    return (
      <section className="settings-section">
        <h2>WhatsApp</h2>
        <p style={{ color: '#555', fontSize: 13 }}>WhatsApp is not configured for your organization yet. Contact your admin to enable it.</p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2>WhatsApp</h2>
      {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('valid') ? 'error' : ''}`} style={{ marginBottom: 10 }}>{msg}</div>}

      {/* Company bot number — this is what user messages TO */}
      {companyWa?.connected_number && (
        <div style={{ background: '#1a2a1a', border: '1px solid #2a4a2a', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#4ade80', fontWeight: 600, marginBottom: 4 }}>Company AI WhatsApp Number</div>
          <div style={{ fontSize: 18, color: '#fff', fontWeight: 600, letterSpacing: 0.5 }}>{companyWa.connected_number}</div>
          <p style={{ fontSize: 11, color: '#6ab86a', marginTop: 4 }}>
            Save this number and send any message to chat with {companyWa.provider === 'meta' ? 'your company AI' : 'the AI assistant'}
          </p>
        </div>
      )}

      {/* User's own number registration */}
      {waStatus?.connected ? (
        <div>
          <div className="settings-info" style={{ marginBottom: 12 }}>
            <div>
              <span className="info-label">Your Registered Number</span>
              <span style={{ color: '#eee' }}>{waStatus.phoneNumber}</span>
            </div>
            <div>
              <span className="info-label">Status</span>
              <span style={{ color: '#4ade80' }}>Active</span>
            </div>
          </div>
          <p style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>
            When you send a message from this number to the company AI number above, the system identifies you and responds with your personalized data.
            Your WhatsApp conversations also appear in the web portal.
          </p>
          <button className="settings-btn" onClick={unregisterNumber} disabled={saving}
            style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444' }}>
            Remove My Number
          </button>
        </div>
      ) : (
        <div>
          <p style={{ color: '#888', fontSize: 13, marginBottom: 10 }}>
            Register your WhatsApp number so the AI can identify you when you message the company number.
            Without registration, the AI won't know who you are.
          </p>
          <div className="settings-field">
            <label>Your WhatsApp Number</label>
            <input
              value={waPhone}
              onChange={e => setWaPhone(e.target.value)}
              placeholder="+923001234567"
              style={{ maxWidth: 300 }}
            />
            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Use the number your WhatsApp is registered on</p>
          </div>
          <button className="settings-btn" onClick={registerNumber} disabled={saving}>
            {saving ? 'Registering...' : 'Register My Number'}
          </button>
        </div>
      )}
    </section>
  );
}

const PERMISSION_OPTIONS = [
  { key: 'email_read', label: 'Read Emails', desc: 'AI can read and summarize your inbox', safe: true },
  { key: 'email_write', label: 'Send/Reply Emails', desc: 'AI can send emails and reply on your behalf', safe: false },
  { key: 'calendar_read', label: 'Read Calendar', desc: 'AI can view your schedule and events', safe: true },
  { key: 'calendar_write', label: 'Create/Edit Events', desc: 'AI can create meetings and modify events', safe: false },
  { key: 'calendar_delete', label: 'Delete Events', desc: 'AI can cancel meetings', safe: false },
];

function PermissionToggles({ userId, currentPermissions }) {
  const [perms, setPerms] = useState(new Set(currentPermissions.split(',').filter(Boolean)));
  const [saving, setSaving] = useState(false);

  const toggle = async (key) => {
    const next = new Set(perms);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPerms(next);

    setSaving(true);
    try {
      await api.put(`/integration/permissions/${userId}`, { permissions: [...next].join(',') });
    } catch {}
    setSaving(false);
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid #333', paddingTop: 12 }}>
      <h3 style={{ fontSize: 13, color: '#aaa', marginBottom: 8 }}>AI Permissions {saving && <span style={{ fontSize: 11, color: '#cc6b4a' }}>saving...</span>}</h3>
      {PERMISSION_OPTIONS.map(opt => (
        <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={perms.has(opt.key)}
            onChange={() => toggle(opt.key)}
            style={{ accentColor: opt.safe ? '#4ade80' : '#f59e0b', width: 16, height: 16 }}
          />
          <div>
            <div style={{ fontSize: 13, color: '#eee' }}>
              {opt.label}
              {!opt.safe && <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 6, padding: '1px 6px', background: 'rgba(245,158,11,0.15)', borderRadius: 4 }}>write access</span>}
            </div>
            <div style={{ fontSize: 11, color: '#666' }}>{opt.desc}</div>
          </div>
        </label>
      ))}
    </div>
  );
}
