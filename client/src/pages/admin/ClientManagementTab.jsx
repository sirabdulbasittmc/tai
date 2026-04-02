import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import ConfigEditor from '../../components/ConfigEditor';
import { CLIENT_SECTIONS } from './adminConstants';

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
// Tenant Row (used in Client table)
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

export default ClientManagementTab;
export { TenantRow };
