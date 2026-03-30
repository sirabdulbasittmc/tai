import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ConfigEditor from '../components/ConfigEditor';

// ─── Config Sections ───────────────────────────────────────────

const SYSTEM_SECTIONS = [
  { title: 'Application', icon: '⚙️', keys: ['app_name', 'session_hours', 'request_timeout_ms'] },
  { title: 'Password & Security', icon: '🔐', keys: ['password_min_length', 'password_require_uppercase', 'password_require_number', 'password_require_special', 'max_login_attempts', 'lockout_minutes'] },
  { title: 'AI & RAG Pipeline', icon: '🧠', keys: ['rag_enabled', 'pii_enabled', 'rag_top_k', 'rag_min_score', 'intent_timeout_ms'] },
  { title: 'AI Context & Tokens', icon: '📊', keys: ['context_limit_fast', 'context_limit_full', 'max_output_tokens_text', 'max_output_tokens_widget', 'max_output_tokens_quick', 'thinking_budget_text', 'thinking_budget_widget'] },
  { title: 'Response Control', icon: '📏', keys: ['response_length', 'max_response_words'] },
  { title: 'Caching', icon: '⚡', keys: ['dedup_cache_ttl_ms', 'weather_cache_ttl_ms'] },
  { title: 'Google Cloud Platform', icon: '☁️', keys: ['data_source', 'ai_provider', 'gcp_project_id', 'gcp_location', 'bq_dataset'] },
  { title: 'AI API Keys', icon: '🔑', keys: ['gemini_api_key', 'anthropic_api_key', 'openai_api_key', 'groq_api_key', 'openrouter_api_key'] },
];

const CLIENT_SECTIONS = [
  { title: 'Email / SMTP', icon: '✉️', keys: ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'] },
  { title: 'Google Drive', icon: '📁', keys: ['google_client_id', 'google_client_secret', 'google_redirect_uri', 'google_drive_folder_id', 'google_index_file_name'] },
];

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('clients');
  const [msg, setMsg] = useState('');

  if (!user?.isAdmin) {
    return <div className="settings-page"><div className="settings-container"><h1>Access Denied</h1></div></div>;
  }

  const tabs = [
    { key: 'clients', label: 'Client Management' },
    ...(user?.isSuperAdmin ? [{ key: 'licenses', label: 'Licenses' }] : []),
    { key: 'tiers', label: 'User Tiers' },
    { key: 'config', label: 'Application Configuration' },
  ];

  return (
    <div className="settings-page">
      <div className="settings-container" style={{ maxWidth: 800 }}>
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Chat
          </button>
          <h1>Admin Panel</h1>
        </div>

        <div className="config-tabs">
          {tabs.map(t => (
            <button key={t.key} className={`config-tab ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('failed') ? 'error' : ''}`}>{msg}</div>}

        {activeTab === 'clients' && <ClientManagementTab user={user} msg={msg} setMsg={setMsg} />}
        {activeTab === 'licenses' && user?.isSuperAdmin && <LicensesTab msg={msg} setMsg={setMsg} />}
        {activeTab === 'tiers' && <TierManagementTab msg={msg} setMsg={setMsg} />}
        {activeTab === 'config' && <ConfigTab user={user} />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 1: Client Management (Tenants + Users + Client Config)
// ═══════════════════════════════════════════════════════════════

function ClientManagementTab({ user, msg, setMsg }) {
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [prices, setPrices] = useState([]);
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [subTab, setSubTab] = useState(user?.isSuperAdmin ? 'tenants' : 'users');

  // ─── New Client form (info + license + config all-in-one) ────
  const [nc, setNc] = useState({
    name: '', domain: '',
    adminSeats: 1, standardSeats: 10, basicSeats: 50, discount: 0, term: 'M',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  });

  const [availableTiers, setAvailableTiers] = useState([]);

  // ─── New User form ───────────────────────────────────────────
  const [newUser, setNewUser] = useState({ empcode: '', name: '', email: '', password: '', userType: 'ST', department: '', clientNumber: '' });

  // ─── Edit User + Integration ────────────────────────────────
  const [editUser, setEditUser] = useState(null);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      if (user?.isSuperAdmin) {
        const [tRes, pRes] = await Promise.all([api.get('/tenants'), api.get('/licenses/prices')]);
        setTenants(tRes.data.tenants || []);
        setPrices(pRes.data.prices || []);
      }
      const [uRes, tRes2] = await Promise.all([api.get('/admin/users'), api.get('/tiers')]);
      setUsers(uRes.data.users || []);
      setAvailableTiers(tRes2.data.tiers || []);
    } catch {}
  };

  const priceMap = {};
  prices.forEach(p => { priceMap[p.roleType] = Number(p.pricePerSeat); });

  // ─── Create Client (info + license in one step) ──────────────
  const createTenant = async () => {
    if (!nc.name) { setMsg('Company name is required'); return; }
    try {
      // Step 1: Create tenant
      const res = await api.post('/tenants', { name: nc.name, domain: nc.domain });
      const cn = res.data.tenant.clientNumber;

      // Step 2: Assign license
      await api.put(`/tenants/${cn}/license`, {
        adminSeats: nc.adminSeats, standardSeats: nc.standardSeats, basicSeats: nc.basicSeats,
        discount: nc.discount, term: nc.term, startDate: nc.startDate, endDate: nc.endDate,
      });

      setMsg(`Client ${cn} created with license`);
      setNc({ name: '', domain: '', adminSeats: 1, standardSeats: 10, basicSeats: 50, discount: 0, term: 'M',
        startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10) });
      setShowCreateTenant(false);
      loadAll();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to create client'); }
  };

  // ─── Create User ─────────────────────────────────────────────
  const createUser = async () => {
    if (!newUser.empcode || !newUser.name || !newUser.email || !newUser.password) { setMsg('All fields required'); return; }
    const targetClient = user?.isSuperAdmin ? newUser.clientNumber : user?.clientNumber;
    if (!targetClient) { setMsg('Please select a client'); return; }
    try {
      const res = await api.post('/user/users', { ...newUser, clientNumber: targetClient });
      const shouldInvite = document.getElementById('sendInvite')?.checked;
      if (shouldInvite && res.data.user?.id) {
        await api.post(`/user/users/${res.data.user.id}/invite`, { baseUrl: window.location.origin }).catch(() => {});
        setMsg('User created and invitation sent');
      } else {
        setMsg('User created');
      }
      setNewUser({ empcode: '', name: '', email: '', password: '', userType: 'ST', department: '', clientNumber: '' });
      setShowCreateUser(false);
      loadAll();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const resetPassword = async (empcode) => {
    try {
      const res = await api.post(`/user/users/${empcode}/reset-password`);
      setMsg(`Password reset for ${empcode}: ${res.data.tempPassword}`);
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const sendInvite = async (userId) => {
    try {
      await api.post(`/user/users/${userId}/invite`, { baseUrl: window.location.origin });
      setMsg('Invitation email sent');
      return true;
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to send invitation');
      return false;
    }
  };

  const toggleTenantActive = async (cn, active) => {
    await api.patch(`/tenants/${cn}`, { isActive: !active }).catch(() => {});
    loadAll();
  };

  const calcGross = () => (nc.adminSeats * (priceMap['AD'] || 0)) + (nc.standardSeats * (priceMap['ST'] || 0)) + (nc.basicSeats * (priceMap['BS'] || 0));

  return (
    <>
      {/* Sub-tabs */}
      <div className="config-tabs sub-tabs">
        {user?.isSuperAdmin && <button className={`config-tab ${subTab === 'tenants' ? 'active' : ''}`} onClick={() => setSubTab('tenants')}>Clients</button>}
        <button className={`config-tab ${subTab === 'users' ? 'active' : ''}`} onClick={() => setSubTab('users')}>Users</button>
        <button className={`config-tab ${subTab === 'clientconfig' ? 'active' : ''}`} onClick={() => setSubTab('clientconfig')}>Client Config</button>
      </div>

      {/* ═══ Clients (SuperAdmin) ═══ */}
      {subTab === 'tenants' && user?.isSuperAdmin && (
        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Clients ({tenants.length})</h2>
            <button className="settings-btn" onClick={() => setShowCreateTenant(!showCreateTenant)}>
              {showCreateTenant ? 'Cancel' : '+ New Client'}
            </button>
          </div>

          {/* Create Client — Full Form (Info + License) */}
          {showCreateTenant && (
            <div className="admin-create-form">
              <h3 style={{ fontSize: 14, color: '#e8e8e0', marginBottom: 12 }}>Client Information</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Company Name *</label><input value={nc.name} onChange={e => setNc(c => ({ ...c, name: e.target.value }))} placeholder="Pakistan State Oil" /></div>
                <div className="settings-field"><label>Domain</label><input value={nc.domain} onChange={e => setNc(c => ({ ...c, domain: e.target.value }))} placeholder="pso.com.pk" /></div>
              </div>
              <p style={{ fontSize: 11, color: '#888', margin: '4px 0 16px' }}>Client number auto-generated from name</p>

              <h3 style={{ fontSize: 14, color: '#e8e8e0', marginBottom: 12, paddingTop: 12, borderTop: '1px solid #333' }}>License Allocation</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>AD Seats (${priceMap['AD'] || '?'}/seat)</label><input type="number" min="0" value={nc.adminSeats} onChange={e => setNc(c => ({ ...c, adminSeats: parseInt(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>ST Seats (${priceMap['ST'] || '?'}/seat)</label><input type="number" min="0" value={nc.standardSeats} onChange={e => setNc(c => ({ ...c, standardSeats: parseInt(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>BS Seats (${priceMap['BS'] || '?'}/seat)</label><input type="number" min="0" value={nc.basicSeats} onChange={e => setNc(c => ({ ...c, basicSeats: parseInt(e.target.value) || 0 }))} /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Discount %</label><input type="number" min="0" max="100" value={nc.discount} onChange={e => setNc(c => ({ ...c, discount: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="settings-field"><label>Term</label>
                  <select value={nc.term} onChange={e => setNc(c => ({ ...c, term: e.target.value }))}>
                    <option value="M">Monthly</option><option value="Q">Quarterly</option><option value="Y">Yearly</option>
                  </select>
                </div>
                <div className="settings-field"><label>Start</label><input type="date" value={nc.startDate} onChange={e => setNc(c => ({ ...c, startDate: e.target.value }))} /></div>
                <div className="settings-field"><label>End</label><input type="date" value={nc.endDate} onChange={e => setNc(c => ({ ...c, endDate: e.target.value }))} /></div>
              </div>

              {/* Price summary */}
              {(() => {
                const gross = calcGross();
                const disc = gross * (nc.discount / 100);
                return (
                  <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 12, margin: '10px 0', fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Gross: ${gross.toLocaleString()}{nc.discount > 0 ? ` − ${nc.discount}%` : ''}</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Net: ${(gross - disc).toLocaleString()}/period</span>
                  </div>
                );
              })()}

              <button className="settings-btn" onClick={createTenant} style={{ width: '100%' }}>Create Client with License</button>
            </div>
          )}

          {/* Client table */}
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Client #</th><th>Name</th><th>Domain</th><th>Users</th><th>License</th><th>Expiry</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tenants.map(t => (
                <TenantRow key={t.clientNumber} tenant={t} onToggle={toggleTenantActive} onSaved={loadAll} setMsg={setMsg} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ═══ Users ═══ */}
      {subTab === 'users' && (
        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Users ({users.length})</h2>
            <button className="settings-btn" onClick={() => setShowCreateUser(!showCreateUser)}>
              {showCreateUser ? 'Cancel' : '+ New User'}
            </button>
          </div>
          {showCreateUser && (
            <div className="admin-create-form">
              {/* Client selector: SA can pick, AD sees own client locked */}
              <div className="settings-field">
                <label>Client</label>
                {user?.isSuperAdmin ? (
                  <select value={newUser.clientNumber} onChange={e => setNewUser(u => ({ ...u, clientNumber: e.target.value }))}>
                    <option value="">Select client...</option>
                    {tenants.map(t => <option key={t.clientNumber} value={t.clientNumber}>{t.clientNumber} — {t.name}</option>)}
                  </select>
                ) : (
                  <input value={user?.clientNumber} disabled style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Employee Code *</label><input value={newUser.empcode} onChange={e => setNewUser(u => ({ ...u, empcode: e.target.value }))} placeholder="EMP-001" /></div>
                <div className="settings-field"><label>Full Name *</label><input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Ahmed Khan" /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>Email *</label><input value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} placeholder="ahmed@company.com" /></div>
                <div className="settings-field"><label>Password *</label><input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} placeholder="Min 6 chars" /></div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="settings-field"><label>User Type</label>
                  <select value={newUser.userType} onChange={e => setNewUser(u => ({ ...u, userType: e.target.value }))}>
                    {user?.isSuperAdmin && <option value="SA">SA — SuperAdmin</option>}
                    {user?.isSuperAdmin && <option value="AD">AD — Admin</option>}
                    {availableTiers.filter(t => t.is_active).map(t => (
                      <option key={t.tier_code} value={t.tier_code}>{t.tier_code} — {t.tier_name} (${Number(t.price_per_seat).toFixed(0)}/seat)</option>
                    ))}
                  </select>
                </div>
                <div className="settings-field"><label>Department</label><input value={newUser.department} onChange={e => setNewUser(u => ({ ...u, department: e.target.value }))} placeholder="Optional" /></div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#bbb', marginTop: 8 }}>
                <input type="checkbox" id="sendInvite" defaultChecked style={{ accentColor: 'var(--accent)' }} />
                Send invitation email (user sets their own password)
              </label>
              <button className="settings-btn" onClick={async () => { await createUser(); }} style={{ width: '100%', marginTop: 8 }}>Create User</button>
            </div>
          )}
          <table className="admin-table" style={{ marginTop: 12 }}>
            <thead><tr><th>Empcode</th><th>Name</th><th>Email</th><th>Type</th><th>Dept</th><th>Actions</th></tr></thead>
            <tbody>
              {users.map(u => (
                <React.Fragment key={u.id}>
                  <tr>
                    <td>{u.empcode}</td>
                    <td>{u.name}</td>
                    <td>{u.email}</td>
                    <td><span className={`badge-type type-${u.userType}`}>{u.userType}</span></td>
                    <td>{u.department || '—'}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button className="admin-action" onClick={() => setEditUser(editUser?.id === u.id ? null : u)}>
                        {editUser?.id === u.id ? 'Close' : 'Edit'}
                      </button>
                      <InviteButton userId={u.id} onInvite={sendInvite} />
                      <button className="admin-action" onClick={() => resetPassword(u.empcode)}>Reset</button>
                    </td>
                  </tr>
                  {editUser?.id === u.id && (
                    <tr><td colSpan={6} style={{ padding: 0 }}>
                      <EditUserPanel user={u} availableTiers={availableTiers} isSuperAdmin={user?.isSuperAdmin} onUpdate={() => { loadAll(); setMsg('User updated'); }} onMsg={setMsg} />
                    </td></tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* ═══ Client Config (SMTP, GDrive) ═══ */}
      {subTab === 'clientconfig' && (
        <ClientConfigSection user={user} tenants={tenants} />
      )}
    </>
  );
}

function InviteButton({ userId, onInvite }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handle = async () => {
    setSending(true);
    const ok = await onInvite(userId);
    setSending(false);
    if (ok) { setSent(true); setTimeout(() => setSent(false), 3000); }
  };

  return (
    <button
      className="admin-action"
      onClick={handle}
      disabled={sending}
      title="Send invitation email"
      style={sent ? { borderColor: '#4ade80', color: '#4ade80' } : sending ? { opacity: 0.5 } : {}}
    >
      {sending ? 'Sending...' : sent ? 'Sent ✓' : 'Invite'}
    </button>
  );
}

function ClientConfigSection({ user, tenants }) {
  const [selectedClient, setSelectedClient] = useState(user?.clientNumber || '');
  const targetClient = user?.isSuperAdmin ? selectedClient : undefined;

  return (
    <>
      {/* Client selector */}
      <section className="settings-section" style={{ paddingBottom: 12 }}>
        <div className="settings-field">
          <label>Client</label>
          {user?.isSuperAdmin ? (
            <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
              {tenants.map(t => <option key={t.clientNumber} value={t.clientNumber}>{t.clientNumber} — {t.name}</option>)}
            </select>
          ) : (
            <input value={user?.clientNumber} disabled style={{ opacity: 0.6 }} />
          )}
        </div>
      </section>

      <ConfigEditor key={selectedClient} sections={CLIENT_SECTIONS} apiPath="/config" clientNumber={targetClient} />
    </>
  );
}

function LogoUploader() {
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const currentLogoUrl = `/api/health/logo?t=${Date.now()}`;

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMsg('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { setMsg('Max 2MB'); return; }

    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result);
    reader.readAsDataURL(file);
    setMsg('');
  };

  const upload = async () => {
    if (!preview) return;
    setSaving(true);
    setMsg('');
    try {
      await api.post('/config/logo', { logo: preview });
      setMsg('Logo uploaded');
      setPreview(null);
    } catch (err) {
      setMsg(err.response?.data?.error || 'Upload failed');
    }
    setSaving(false);
  };

  return (
    <section className="settings-section">
      <h2>🖼 Client Logo</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <img
          src={preview || currentLogoUrl}
          alt="Logo"
          style={{ width: 64, height: 64, borderRadius: 12, border: '1px solid #333', objectFit: 'contain', background: '#1a1a1a' }}
          onError={(e) => { e.target.src = '/tmc-logo.png'; }}
        />
        <div style={{ flex: 1 }}>
          <input type="file" accept="image/*" onChange={handleFile} style={{ fontSize: 12, color: '#888' }} />
          <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>PNG or SVG, max 2MB. Shown on login, chat, and emails.</p>
        </div>
        {preview && (
          <button className="settings-btn" onClick={upload} disabled={saving}>
            {saving ? 'Uploading...' : 'Save Logo'}
          </button>
        )}
      </div>
      {msg && <div className={`settings-msg ${msg.includes('failed') ? 'error' : ''}`} style={{ marginTop: 8 }}>{msg}</div>}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// Edit User Panel (inline, with integration setup)
// ═══════════════════════════════════════════════════════════════

function EditUserPanel({ user: u, availableTiers = [], isSuperAdmin, onUpdate, onMsg }) {
  const [form, setForm] = useState({
    name: u.name, department: u.department || '', userType: u.userType,
    city: u.city || '', contactNumber: u.contactNumber || '', jobDescription: u.jobDescription || '',
  });
  const [saving, setSaving] = useState(false);
  const [intStatus, setIntStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => { loadIntStatus(); }, []);

  const loadIntStatus = async () => {
    try { const res = await api.get(`/integration/status/${u.id}`); setIntStatus(res.data); } catch {}
  };

  const saveUser = async () => {
    setSaving(true);
    try {
      await api.patch(`/admin/users/${u.id}`, form);
      onMsg('User updated');
      onUpdate();
    } catch (err) { onMsg(err.response?.data?.error || 'Failed to update user'); }
    setSaving(false);
  };

  const connectGoogle = async () => {
    try {
      const res = await api.get(`/integration/connect/${u.id}`);
      window.open(res.data.url, '_blank', 'width=600,height=700');
      // Poll for completion
      const poll = setInterval(async () => {
        const s = await api.get(`/integration/status/${u.id}`);
        if (s.data.connected) { clearInterval(poll); setIntStatus(s.data); onMsg(`Google connected: ${s.data.email}`); }
      }, 3000);
      setTimeout(() => clearInterval(poll), 120000); // stop polling after 2 min
    } catch (err) { onMsg(err.response?.data?.error || 'Failed to start connection'); }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await api.post(`/integration/test/${u.id}`);
      if (res.data.success) {
        onMsg(`Integration OK — Email: ${res.data.email}, Calendars: ${res.data.calendarCount}`);
        setIntStatus({ ...intStatus, status: 'active', error: null, email: res.data.email });
      } else {
        onMsg(`Integration Error: ${res.data.error}`);
        setIntStatus({ ...intStatus, status: 'error', error: res.data.error });
      }
    } catch (err) { onMsg('Test failed'); }
    setTesting(false);
  };

  const disconnectGoogle = async () => {
    try {
      await api.delete(`/integration/disconnect/${u.id}`);
      setIntStatus({ connected: false });
      onMsg('Integration disconnected');
    } catch (err) { onMsg('Disconnect failed'); }
  };

  const inputStyle = { width: '100%', padding: '6px 10px', fontSize: 13, background: '#2a2a2a', border: '1px solid #444', borderRadius: 6, color: '#eee' };

  return (
    <div style={{ background: '#1a1a1a', padding: 16, borderTop: '2px solid #cc6b4a' }}>
      {/* ── User Details ── */}
      <h4 style={{ color: '#cc6b4a', margin: '0 0 12px 0', fontSize: 14 }}>Edit User: {u.name}</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label style={{ fontSize: 11, color: '#888' }}>Name</label><input style={inputStyle} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Department</label><input style={inputStyle} value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>User Type</label>
          <select style={inputStyle} value={form.userType} onChange={e => setForm(f => ({ ...f, userType: e.target.value }))}>
            {isSuperAdmin && <option value="SA">SA — SuperAdmin</option>}
            {isSuperAdmin && <option value="AD">AD — Admin</option>}
            {availableTiers.filter(t => t.is_active).map(t => (
              <option key={t.tier_code} value={t.tier_code}>{t.tier_code} — {t.tier_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div><label style={{ fontSize: 11, color: '#888' }}>City</label><input style={inputStyle} value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Contact Number</label><input style={inputStyle} value={form.contactNumber} onChange={e => setForm(f => ({ ...f, contactNumber: e.target.value }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Job Description</label><input style={inputStyle} value={form.jobDescription} onChange={e => setForm(f => ({ ...f, jobDescription: e.target.value }))} /></div>
      </div>
      <button className="settings-btn" onClick={saveUser} disabled={saving} style={{ marginBottom: 16 }}>
        {saving ? 'Saving...' : 'Save User Details'}
      </button>

      {/* ── Email & Calendar Integration ── */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 12 }}>
        <h4 style={{ color: '#cc6b4a', margin: '0 0 10px 0', fontSize: 14 }}>Email & Calendar Integration</h4>

        {intStatus === null ? (
          <p style={{ color: '#888', fontSize: 12 }}>Loading...</p>
        ) : !intStatus.connected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: '#888', fontSize: 13 }}>Not connected</span>
            <button className="settings-btn" onClick={connectGoogle} style={{ padding: '6px 16px', fontSize: 12 }}>
              Connect Google (Gmail + Calendar)
            </button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: intStatus.status === 'active' ? '#4ade80' : intStatus.status === 'expired' ? '#f59e0b' : '#ef4444',
              }} />
              <span style={{ fontSize: 13, color: '#eee' }}>
                {intStatus.provider === 'google' ? 'Google' : 'Microsoft'} — {intStatus.email}
              </span>
              <span style={{ fontSize: 11, color: '#888' }}>({intStatus.scopes})</span>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: intStatus.status === 'active' ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)',
                color: intStatus.status === 'active' ? '#4ade80' : '#ef4444',
              }}>
                {intStatus.status}
              </span>
            </div>

            {intStatus.error && (
              <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: '#ef4444' }}>
                Error: {intStatus.error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="admin-action" onClick={testConnection} disabled={testing} style={{ borderColor: '#4ade80', color: '#4ade80' }}>
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button className="admin-action" onClick={connectGoogle} style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
                Reconnect
              </button>
              <button className="admin-action" onClick={disconnectGoogle} style={{ borderColor: '#ef4444', color: '#ef4444' }}>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 2: Licenses (Assign to Client + Price Management)
// ═══════════════════════════════════════════════════════════════

function TenantRow({ tenant: t, onToggle, onSaved, setMsg }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [domain, setDomain] = useState(t.domain || '');

  const save = async () => {
    try {
      await api.patch(`/tenants/${t.clientNumber}`, { name, domain: domain || null });
      setMsg(`Client ${t.clientNumber} updated`);
      setEditing(false);
      onSaved();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to update'); }
  };

  if (editing) {
    return (
      <tr>
        <td><strong>{t.clientNumber}</strong></td>
        <td><input value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '4px 8px', fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--accent)', borderRadius: 6, color: '#fff' }} /></td>
        <td><input value={domain} onChange={e => setDomain(e.target.value)} style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 6, color: '#bbb' }} placeholder="domain.com" /></td>
        <td>{t.userCount}</td>
        <td>{t.license ? <span style={{ fontSize: 11 }}>{t.license.adminSeats}AD/{t.license.standardSeats}ST/{t.license.basicSeats}BS</span> : <span style={{ color: '#888', fontSize: 11 }}>None</span>}</td>
        <td>{t.expiry ? <span style={{ color: new Date(t.expiry) > new Date() ? '#4ade80' : '#ef4444', fontSize: 12 }}>{new Date(t.expiry).toLocaleDateString()}</span> : '—'}</td>
        <td><span className={`badge-type ${t.isActive ? 'type-ST' : 'type-SA'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
        <td style={{ display: 'flex', gap: 4 }}>
          <button className="admin-action" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={save}>Save</button>
          <button className="admin-action" onClick={() => setEditing(false)}>Cancel</button>
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td><strong>{t.clientNumber}</strong></td>
      <td>{t.name}</td>
      <td style={{ fontSize: 12, color: '#888' }}>{t.domain || '—'}</td>
      <td>{t.userCount}</td>
      <td>{t.license ? <span style={{ fontSize: 11 }}>{t.license.adminSeats}AD/{t.license.standardSeats}ST/{t.license.basicSeats}BS</span> : <span style={{ color: '#888', fontSize: 11 }}>None</span>}</td>
      <td>{t.expiry ? <span style={{ color: new Date(t.expiry) > new Date() ? '#4ade80' : '#ef4444', fontSize: 12 }}>{new Date(t.expiry).toLocaleDateString()}</span> : '—'}</td>
      <td><span className={`badge-type ${t.isActive ? 'type-ST' : 'type-SA'}`} style={{ cursor: 'pointer' }} onClick={() => onToggle(t.clientNumber, t.isActive)}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
      <td><button className="admin-action" onClick={() => setEditing(true)}>Edit</button></td>
    </tr>
  );
}

function LicensesTab({ msg, setMsg }) {
  const [tenants, setTenants] = useState([]);
  const [prices, setPrices] = useState([]);
  const [editLicense, setEditLicense] = useState(null);
  const [licenseForm, setLicenseForm] = useState({ adminSeats: 0, standardSeats: 0, basicSeats: 0, discount: 0, term: 'M', startDate: '', endDate: '' });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([api.get('/tenants'), api.get('/licenses/prices')]);
      setTenants(tRes.data.tenants || []);
      setPrices(pRes.data.prices || []);
    } catch {}
  };

  const priceMap = {};
  prices.forEach(p => { priceMap[p.roleType] = Number(p.pricePerSeat); });

  const openEditor = (t) => {
    const lic = t.license;
    setEditLicense(t.clientNumber);
    setLicenseForm({
      adminSeats: lic?.adminSeats || 0, standardSeats: lic?.standardSeats || 0, basicSeats: lic?.basicSeats || 0,
      discount: lic ? Number(lic.discount || 0) : 0, term: lic?.term || 'M',
      startDate: lic?.startDate ? lic.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      endDate: lic?.endDate ? lic.endDate.slice(0, 10) : new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    });
  };

  const saveLicense = async () => {
    try {
      await api.put(`/tenants/${editLicense}/license`, licenseForm);
      setMsg(`License updated for ${editLicense}`);
      setEditLicense(null);
      loadData();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const savePrice = async (roleType, pricePerSeat, description) => {
    try {
      await api.put(`/tenants/prices/${roleType}`, { pricePerSeat, description });
      setMsg(`Price updated for ${roleType}`);
      loadData();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed'); }
  };

  const calcTotal = () => {
    const gross = (licenseForm.adminSeats * (priceMap['AD'] || 0)) + (licenseForm.standardSeats * (priceMap['ST'] || 0)) + (licenseForm.basicSeats * (priceMap['BS'] || 0));
    const disc = gross * (licenseForm.discount / 100);
    return { gross, disc, net: gross - disc };
  };

  return (
    <>
      {/* Assign Licenses to Client */}
      <section className="settings-section">
        <h2>Client Licenses</h2>
        <table className="admin-table">
          <thead><tr><th>Client</th><th>AD Seats</th><th>ST Seats</th><th>BS Seats</th><th>Net/Period</th><th>Expiry</th><th></th></tr></thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.clientNumber}>
                <td><strong>{t.clientNumber}</strong><br/><span style={{ fontSize: 11, color: '#888' }}>{t.name}</span></td>
                <td>{t.license?.adminSeats ?? '—'}</td>
                <td>{t.license?.standardSeats ?? '—'}</td>
                <td>{t.license?.basicSeats ?? '—'}</td>
                <td>{t.license ? `$${Number(t.license.netAmount).toLocaleString()}` : '—'}</td>
                <td>{t.expiry ? <span style={{ color: new Date(t.expiry) > new Date() ? '#4ade80' : '#ef4444', fontSize: 12 }}>{new Date(t.expiry).toLocaleDateString()}</span> : '—'}</td>
                <td><button className="admin-action" onClick={() => openEditor(t)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* License Editor Modal */}
      {editLicense && (
        <div className="purge-modal-overlay">
          <div className="purge-modal" style={{ maxWidth: 520, borderColor: 'var(--accent)' }}>
            <h3>License — {editLicense}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '16px 0' }}>
              <div className="settings-field"><label>AD (${priceMap['AD'] || '?'}/seat)</label><input type="number" min="0" value={licenseForm.adminSeats} onChange={e => setLicenseForm(f => ({ ...f, adminSeats: parseInt(e.target.value) || 0 }))} /></div>
              <div className="settings-field"><label>ST (${priceMap['ST'] || '?'}/seat)</label><input type="number" min="0" value={licenseForm.standardSeats} onChange={e => setLicenseForm(f => ({ ...f, standardSeats: parseInt(e.target.value) || 0 }))} /></div>
              <div className="settings-field"><label>BS (${priceMap['BS'] || '?'}/seat)</label><input type="number" min="0" value={licenseForm.basicSeats} onChange={e => setLicenseForm(f => ({ ...f, basicSeats: parseInt(e.target.value) || 0 }))} /></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div className="settings-field"><label>Discount %</label><input type="number" min="0" max="100" value={licenseForm.discount} onChange={e => setLicenseForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} /></div>
              <div className="settings-field"><label>Term</label>
                <select value={licenseForm.term} onChange={e => setLicenseForm(f => ({ ...f, term: e.target.value }))}>
                  <option value="M">Monthly</option><option value="Q">Quarterly</option><option value="Y">Yearly</option>
                </select>
              </div>
              <div />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <div className="settings-field"><label>Start Date</label><input type="date" value={licenseForm.startDate} onChange={e => setLicenseForm(f => ({ ...f, startDate: e.target.value }))} /></div>
              <div className="settings-field"><label>End Date</label><input type="date" value={licenseForm.endDate} onChange={e => setLicenseForm(f => ({ ...f, endDate: e.target.value }))} /></div>
            </div>
            {(() => { const { gross, disc, net } = calcTotal(); return (
              <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 14, margin: '16px 0', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}><span>Gross</span><span>${gross.toLocaleString()}</span></div>
                {disc > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4ade80' }}><span>Discount ({licenseForm.discount}%)</span><span>-${disc.toLocaleString()}</span></div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)', fontWeight: 700, fontSize: 15, marginTop: 6, paddingTop: 6, borderTop: '1px solid #333' }}><span>Net Amount</span><span>${net.toLocaleString()}/period</span></div>
              </div>
            ); })()}
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="settings-btn" onClick={() => setEditLicense(null)} style={{ flex: 1, background: '#333' }}>Cancel</button>
              <button className="settings-btn" onClick={saveLicense} style={{ flex: 1 }}>Save License</button>
            </div>
          </div>
        </div>
      )}

      {/* License Pricing — now managed in User Tiers tab */}
      <section className="settings-section">
        <h2>License Pricing</h2>
        <p style={{ color: '#888', fontSize: 13 }}>Pricing is now managed per tier in the <strong>User Tiers</strong> tab. Each tier defines its own price/seat along with all feature settings.</p>
      </section>
    </>
  );
}

function PriceRow({ price, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(Number(price.pricePerSeat));
  const [desc, setDesc] = useState(price.description || '');

  if (!editing) {
    return (
      <tr>
        <td><span className={`badge-type type-${price.roleType}`}>{price.roleType}</span></td>
        <td><strong>${Number(price.pricePerSeat)}</strong></td>
        <td style={{ fontSize: 12, color: '#888' }}>{price.description}</td>
        <td><button className="admin-action" onClick={() => setEditing(true)}>Edit</button></td>
      </tr>
    );
  }

  return (
    <tr>
      <td><span className={`badge-type type-${price.roleType}`}>{price.roleType}</span></td>
      <td><input type="number" min="0" step="0.01" value={val} onChange={e => setVal(parseFloat(e.target.value) || 0)} style={{ width: 80, padding: '4px 8px', fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--accent)', borderRadius: 6, color: '#fff' }} /></td>
      <td><input value={desc} onChange={e => setDesc(e.target.value)} style={{ width: '100%', padding: '4px 8px', fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 6, color: '#bbb' }} /></td>
      <td style={{ display: 'flex', gap: 4 }}>
        <button className="admin-action" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }} onClick={() => { onSave(price.roleType, val, desc); setEditing(false); }}>Save</button>
        <button className="admin-action" onClick={() => setEditing(false)}>Cancel</button>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB 3: Application Configuration (System Config + Data Mgmt)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// TAB: User Tiers Management
// ═══════════════════════════════════════════════════════════════

function TierManagementTab({ msg, setMsg }) {
  const [tiers, setTiers] = useState([]);
  const [editTier, setEditTier] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => { loadTiers(); }, []);

  const loadTiers = async () => {
    try { const res = await api.get('/tiers'); setTiers(res.data.tiers || []); } catch {}
  };

  const saveTier = async (code, data) => {
    try {
      await api.put(`/tiers/${code}`, data);
      setMsg('Tier saved');
      setEditTier(null); setShowCreate(false);
      loadTiers();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to save tier'); }
  };

  const deleteTier = async (code) => {
    if (!confirm(`Delete tier ${code}?`)) return;
    try { await api.delete(`/tiers/${code}`); setMsg('Tier deleted'); loadTiers(); } catch (err) { setMsg('Delete failed'); }
  };

  return (
    <>
      <section className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2>User Tiers ({tiers.length})</h2>
            <p style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Define how AI responds for each user type — same data, different presentation</p>
          </div>
          <button className="settings-btn" onClick={() => { setShowCreate(true); setEditTier(null); }}>+ New Tier</button>
        </div>
      </section>

      {(showCreate || editTier) && (
        <TierForm
          tier={editTier}
          onSave={(code, data) => saveTier(code, data)}
          onCancel={() => { setShowCreate(false); setEditTier(null); }}
        />
      )}

      {tiers.map(t => (
        <section className="settings-section" key={t.tier_code} style={{ opacity: t.is_active ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0 }}>{t.tier_name}</h3>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(204,107,74,0.15)', color: 'var(--accent)' }}>{t.tier_code}</span>
                <span style={{ fontSize: 11, color: '#888' }}>${Number(t.price_per_seat).toFixed(0)}/seat</span>
              </div>
              <p style={{ fontSize: 12, color: '#888', margin: '4px 0' }}>{t.description}</p>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#666', flexWrap: 'wrap', marginTop: 6 }}>
                <span>Style: <strong style={{ color: '#aaa' }}>{t.response_style}</strong></span>
                <span>Words: <strong style={{ color: '#aaa' }}>{t.max_response_words}</strong></span>
                <span>Tokens: <strong style={{ color: '#aaa' }}>{t.max_output_tokens}</strong></span>
                <span>Queries: <strong style={{ color: '#aaa' }}>{t.max_queries_per_day === 0 ? '∞' : t.max_queries_per_day}/day</strong></span>
                {t.allow_widgets && <span style={{ color: '#4ade80' }}>Widgets</span>}
                {t.allow_charts && <span style={{ color: '#4ade80' }}>Charts</span>}
                {t.allow_export && <span style={{ color: '#4ade80' }}>Export</span>}
                {t.allow_email_read && <span style={{ color: '#3b82f6' }}>Email</span>}
                {t.allow_calendar_read && <span style={{ color: '#3b82f6' }}>Calendar</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="admin-action" onClick={() => { setEditTier(t); setShowCreate(false); }}>Edit</button>
              <button className="admin-action" onClick={() => deleteTier(t.tier_code)} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Del</button>
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

function TierForm({ tier, onSave, onCancel }) {
  const [form, setForm] = useState({
    tier_code: tier?.tier_code || '',
    tier_name: tier?.tier_name || '',
    description: tier?.description || '',
    price_per_seat: tier?.price_per_seat || 0,
    currency: tier?.currency || 'USD',
    response_style: tier?.response_style || 'moderate',
    max_response_words: tier?.max_response_words || 500,
    max_output_tokens: tier?.max_output_tokens || 2048,
    max_queries_per_day: tier?.max_queries_per_day || 100,
    max_scheduled_tasks: tier?.max_scheduled_tasks || 0,
    allowed_providers: tier?.allowed_providers || 'gemini-flash',
    allow_widgets: tier?.allow_widgets || false,
    allow_charts: tier?.allow_charts || false,
    allow_tables: tier?.allow_tables ?? true,
    allow_export: tier?.allow_export || false,
    export_formats: tier?.export_formats || 'csv',
    allow_email_read: tier?.allow_email_read || false,
    allow_email_write: tier?.allow_email_write || false,
    allow_calendar_read: tier?.allow_calendar_read || false,
    allow_calendar_write: tier?.allow_calendar_write || false,
    allow_memory: tier?.allow_memory ?? true,
    allow_news: tier?.allow_news ?? true,
    allow_weather: tier?.allow_weather ?? true,
    sort_order: tier?.sort_order || 0,
    is_active: tier?.is_active ?? true,
  });

  const inputStyle = { width: '100%', padding: '6px 10px', fontSize: 13, background: '#2a2a2a', border: '1px solid #444', borderRadius: 6, color: '#eee' };
  const sectionHeader = (title) => <h4 style={{ color: '#aaa', fontSize: 12, margin: '14px 0 8px', borderTop: '1px solid #333', paddingTop: 10 }}>{title}</h4>;

  return (
    <section className="settings-section" style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ color: 'var(--accent)', margin: '0 0 12px' }}>{tier ? `Edit Tier: ${tier.tier_name}` : 'New Tier'}</h3>

      {sectionHeader('Tier Identity')}
      <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 100px 80px', gap: 10, marginBottom: 12 }}>
        <div><label style={{ fontSize: 11, color: '#888' }}>Code *</label><input style={inputStyle} value={form.tier_code} onChange={e => setForm(f => ({ ...f, tier_code: e.target.value.toUpperCase() }))} placeholder="EX" maxLength={5} disabled={!!tier} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Name *</label><input style={inputStyle} value={form.tier_name} onChange={e => setForm(f => ({ ...f, tier_name: e.target.value }))} placeholder="Executive" /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Price/Seat</label><input type="number" style={inputStyle} value={form.price_per_seat} onChange={e => setForm(f => ({ ...f, price_per_seat: parseFloat(e.target.value) || 0 }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Currency</label>
          <select style={inputStyle} value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
            <option value="USD">USD</option><option value="PKR">PKR</option><option value="SAR">SAR</option><option value="AED">AED</option>
          </select>
        </div>
      </div>
      <div><label style={{ fontSize: 11, color: '#888' }}>Description</label><textarea style={{ ...inputStyle, minHeight: 40 }} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Describe what this tier provides to users..." /></div>

      {sectionHeader('AI Response Presentation')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
        <div><label style={{ fontSize: 11, color: '#888' }}>Response Style</label>
          <select style={inputStyle} value={form.response_style} onChange={e => setForm(f => ({ ...f, response_style: e.target.value }))}>
            <option value="brief">Brief — 2-3 sentences, facts only</option>
            <option value="moderate">Moderate — bullets, key insights</option>
            <option value="detailed">Detailed — tables, analysis, follow-ups</option>
            <option value="comprehensive">Comprehensive — dashboards, strategy, recommendations</option>
          </select>
        </div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Max Words per Response</label><input type="number" style={inputStyle} value={form.max_response_words} onChange={e => setForm(f => ({ ...f, max_response_words: parseInt(e.target.value) || 500 }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Max AI Output Tokens</label><input type="number" style={inputStyle} value={form.max_output_tokens} onChange={e => setForm(f => ({ ...f, max_output_tokens: parseInt(e.target.value) || 2048 }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>AI Providers</label><input style={inputStyle} value={form.allowed_providers} onChange={e => setForm(f => ({ ...f, allowed_providers: e.target.value }))} placeholder="gemini-flash,gemini" /></div>
      </div>
      <p style={{ fontSize: 10, color: '#555', margin: '0 0 4px' }}>Brief: "47 projects, 3 at risk" | Moderate: bullets + key highlights | Detailed: full tables + drill-links | Comprehensive: interactive dashboards + strategic advice</p>

      {sectionHeader('Output Formats')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        {[
          { key: 'allow_tables', label: 'Markdown Tables' },
          { key: 'allow_charts', label: 'Charts (bar, pie, line)' },
          { key: 'allow_widgets', label: 'Interactive Dashboards' },
          { key: 'allow_export', label: 'Export / Download' },
        ].map(opt => (
          <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
            <input type="checkbox" checked={form[opt.key]} onChange={e => setForm(f => ({ ...f, [opt.key]: e.target.checked }))} style={{ accentColor: 'var(--accent)' }} />
            {opt.label}
          </label>
        ))}
      </div>
      {form.allow_export && (
        <div style={{ marginBottom: 8 }}><label style={{ fontSize: 11, color: '#888' }}>Export Formats</label>
          <select style={inputStyle} value={form.export_formats} onChange={e => setForm(f => ({ ...f, export_formats: e.target.value }))}>
            <option value="csv">CSV only</option>
            <option value="csv,pdf">CSV + PDF</option>
            <option value="csv,pdf,doc">CSV + PDF + Word</option>
          </select>
        </div>
      )}

      {sectionHeader('Email & Calendar')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
        {[
          { key: 'allow_email_read', label: 'Read Email (inbox summary)' },
          { key: 'allow_email_write', label: 'Send/Reply Email' },
          { key: 'allow_calendar_read', label: 'View Calendar' },
          { key: 'allow_calendar_write', label: 'Create/Modify Events' },
        ].map(opt => (
          <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
            <input type="checkbox" checked={form[opt.key]} onChange={e => setForm(f => ({ ...f, [opt.key]: e.target.checked }))} style={{ accentColor: '#3b82f6' }} />
            {opt.label}
          </label>
        ))}
      </div>

      {sectionHeader('Usage Limits')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
        <div><label style={{ fontSize: 11, color: '#888' }}>Queries per Day (0 = unlimited)</label><input type="number" style={inputStyle} value={form.max_queries_per_day} onChange={e => setForm(f => ({ ...f, max_queries_per_day: parseInt(e.target.value) || 0 }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Scheduled Tasks (0 = unlimited)</label><input type="number" style={inputStyle} value={form.max_scheduled_tasks} onChange={e => setForm(f => ({ ...f, max_scheduled_tasks: parseInt(e.target.value) || 0 }))} /></div>
        <div><label style={{ fontSize: 11, color: '#888' }}>Sort Order</label><input type="number" style={inputStyle} value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))} /></div>
      </div>

      {sectionHeader('Additional Features')}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          { key: 'allow_memory', label: 'AI Memory (learns about user)' },
          { key: 'allow_news', label: 'News Headlines' },
          { key: 'allow_weather', label: 'Weather on Welcome' },
          { key: 'is_active', label: 'Tier Active' },
        ].map(opt => (
          <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#bbb', cursor: 'pointer' }}>
            <input type="checkbox" checked={form[opt.key]} onChange={e => setForm(f => ({ ...f, [opt.key]: e.target.checked }))} style={{ accentColor: opt.key === 'is_active' ? '#4ade80' : 'var(--accent)' }} />
            {opt.label}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button className="settings-btn" onClick={onCancel} style={{ flex: 1, background: '#333' }}>Cancel</button>
        <button className="settings-btn" onClick={() => onSave(form.tier_code, form)} style={{ flex: 1 }}>{tier ? 'Update Tier' : 'Create Tier'}</button>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// TAB: Application Configuration
// ═══════════════════════════════════════════════════════════════

function ConfigTab({ user }) {
  const [subTab, setSubTab] = useState('config');

  return (
    <>
      {user?.isSuperAdmin && (
        <div className="config-tabs sub-tabs">
          <button className={`config-tab ${subTab === 'config' ? 'active' : ''}`} onClick={() => setSubTab('config')}>Settings</button>
          <button className={`config-tab ${subTab === 'data' ? 'active' : ''}`} onClick={() => setSubTab('data')}>Data Management</button>
        </div>
      )}

      {subTab === 'config' && (
        <>
          {user?.isSuperAdmin && <LogoUploader />}
          <ConfigEditor sections={user?.isSuperAdmin ? SYSTEM_SECTIONS : CLIENT_SECTIONS} apiPath="/config" />
        </>
      )}

      {subTab === 'data' && user?.isSuperAdmin && <DataManagementSection />}
    </>
  );
}

// ─── Data Management (from SystemConfigPage) ───────────────────

function DataManagementSection() {
  const [tenants, setTenants] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [tables, setTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [purging, setPurging] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => { api.get('/config/data/tenants').then(r => setTenants(r.data.tenants)).catch(() => {}); }, []);
  useEffect(() => { loadTables(); }, [selectedClient]);

  const loadTables = async () => {
    try {
      const params = selectedClient ? `?client=${selectedClient}` : '';
      const res = await api.get(`/config/data/tables${params}`);
      setTables(res.data.tables || []);
      setSelectedTables(new Set());
      setPreview(null);
    } catch {}
  };

  const toggleTable = (key) => { setSelectedTables(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); setPreview(null); };
  const selectAll = (cat) => { setSelectedTables(new Set(tables.filter(t => !cat || t.category === cat).map(t => t.key))); setPreview(null); };

  const handlePreview = async () => {
    setMsg('');
    try { const res = await api.post('/config/data/preview', { tables: Array.from(selectedTables), clientNumber: selectedClient || undefined }); setPreview(res.data.preview); }
    catch (err) { setMsg(err.response?.data?.error || 'Preview failed'); }
  };

  const handlePurge = async () => {
    setPurging(true);
    try {
      const res = await api.delete('/config/data/purge', { data: { tables: Array.from(selectedTables), clientNumber: selectedClient || undefined } });
      const total = res.data.results.reduce((s, r) => s + r.deleted, 0);
      setMsg(`Purged ${total} records`);
      setShowConfirm(false); setPreview(null); setSelectedTables(new Set()); loadTables();
    } catch (err) { setMsg(err.response?.data?.error || 'Purge failed'); }
    setPurging(false);
  };

  const transactional = tables.filter(t => t.category === 'transactional');
  const aiMemory = tables.filter(t => t.category === 'ai_memory');
  const monitoring = tables.filter(t => t.category === 'monitoring');
  const configuration = tables.filter(t => t.category === 'configuration');
  const totalSelected = preview ? preview.reduce((s, p) => s + p.count, 0) : 0;

  return (
    <>
      {msg && <div className={`settings-msg ${msg.includes('Failed') || msg.includes('failed') ? 'error' : ''}`}>{msg}</div>}

      <section className="settings-section">
        <h2>Select Client</h2>
        <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} style={{ width: '100%', padding: '8px 12px', fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border-input)', borderRadius: 8, color: '#e8e8e0' }}>
          <option value="">All Clients</option>
          {tenants.map(t => <option key={t.clientNumber} value={t.clientNumber}>{t.clientNumber} — {t.name}</option>)}
        </select>
      </section>

      <section className="settings-section purge-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Transactional Data</h2>
          <div style={{ display: 'flex', gap: 6 }}><button className="admin-action" onClick={() => selectAll('transactional')}>All</button><button className="admin-action" onClick={() => setSelectedTables(new Set())}>Clear</button></div>
        </div>
        {transactional.map(t => (
          <label className="purge-row" key={t.key}><input type="checkbox" checked={selectedTables.has(t.key)} onChange={() => toggleTable(t.key)} /><span className="purge-label">{t.label}</span><span className="purge-count">{t.count.toLocaleString()}</span></label>
        ))}
      </section>

      {aiMemory.length > 0 && (
      <section className="settings-section purge-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>AI Memory & Learning</h2>
          <div style={{ display: 'flex', gap: 6 }}><button className="admin-action" onClick={() => selectAll('ai_memory')}>All</button></div>
        </div>
        {aiMemory.map(t => (
          <label className="purge-row" key={t.key}><input type="checkbox" checked={selectedTables.has(t.key)} onChange={() => toggleTable(t.key)} /><span className="purge-label">{t.label}</span><span className="purge-count">{t.count.toLocaleString()}</span></label>
        ))}
      </section>
      )}

      {monitoring.length > 0 && (
      <section className="settings-section purge-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Monitoring & Usage</h2>
          <div style={{ display: 'flex', gap: 6 }}><button className="admin-action" onClick={() => selectAll('monitoring')}>All</button></div>
        </div>
        {monitoring.map(t => (
          <label className="purge-row" key={t.key}><input type="checkbox" checked={selectedTables.has(t.key)} onChange={() => toggleTable(t.key)} /><span className="purge-label">{t.label}</span><span className="purge-count">{t.count.toLocaleString()}</span></label>
        ))}
      </section>
      )}

      <section className="settings-section purge-section">
        <h2>Configuration Data</h2>
        {configuration.map(t => (
          <label className="purge-row" key={t.key}><input type="checkbox" checked={selectedTables.has(t.key)} onChange={() => toggleTable(t.key)} /><span className="purge-label">{t.label}</span><span className="purge-count">{t.count.toLocaleString()}</span></label>
        ))}
      </section>

      {selectedTables.size > 0 && <button className="settings-btn" onClick={handlePreview} style={{ width: '100%', marginBottom: 12 }}>Preview ({selectedTables.size} tables)</button>}

      {preview && (
        <section className="settings-section" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
          <h2 style={{ color: '#ef4444' }}>Purge Preview — {selectedClient || 'ALL CLIENTS'}</h2>
          <div className="admin-cards">
            {preview.map(p => <div className="admin-card" key={p.table} style={{ borderColor: p.count > 0 ? 'rgba(239,68,68,0.3)' : 'var(--border)' }}><div className="admin-card-value" style={{ color: p.count > 0 ? '#ef4444' : '#888' }}>{p.count}</div><div className="admin-card-label">{p.label}</div></div>)}
          </div>
          <button className="settings-btn danger" onClick={() => setShowConfirm(true)} style={{ width: '100%', marginTop: 12 }}>Purge {totalSelected} Records</button>
        </section>
      )}

      {showConfirm && (
        <div className="purge-modal-overlay">
          <div className="purge-modal">
            <h3 style={{ color: '#ef4444' }}>Confirm Purge</h3>
            <p>Permanently delete <strong>{totalSelected}</strong> records from <strong>{selectedClient || 'ALL CLIENTS'}</strong>?</p>
            <p style={{ color: '#ef4444', fontWeight: 600, fontSize: 13, marginTop: 10 }}>This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="settings-btn" onClick={() => setShowConfirm(false)} style={{ flex: 1, background: '#333' }}>Cancel</button>
              <button className="settings-btn danger" onClick={handlePurge} disabled={purging} style={{ flex: 1 }}>{purging ? 'Purging...' : 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
