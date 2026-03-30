import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

export default function TenantPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tenants, setTenants] = useState([]);
  const [prices, setPrices] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newTenant, setNewTenant] = useState({ name: '', domain: '' });
  const [editLicense, setEditLicense] = useState(null); // clientNumber being edited
  const [licenseForm, setLicenseForm] = useState({ adminSeats: 0, standardSeats: 0, basicSeats: 0, discount: 0, term: 'M', startDate: '', endDate: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [tRes, pRes] = await Promise.all([
        api.get('/tenants'),
        api.get('/licenses/prices'),
      ]);
      setTenants(tRes.data.tenants || []);
      setPrices(pRes.data.prices || []);
    } catch { setMsg('Failed to load data'); }
  };

  const createTenant = async () => {
    if (!newTenant.name) { setMsg('Client name is required'); return; }
    setMsg('');
    try {
      const res = await api.post('/tenants', newTenant);
      setMsg(`Client ${res.data.tenant.clientNumber} created`);
      setNewTenant({ name: '', domain: '' });
      setShowCreate(false);
      loadData();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to create'); }
  };

  const openLicenseEditor = (tenant) => {
    const lic = tenant.license;
    setEditLicense(tenant.clientNumber);
    setLicenseForm({
      adminSeats: lic?.adminSeats || 0,
      standardSeats: lic?.standardSeats || 0,
      basicSeats: lic?.basicSeats || 0,
      discount: lic ? Number(lic.discount || 0) : 0,
      term: lic?.term || 'M',
      startDate: lic?.startDate ? lic.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      endDate: lic?.endDate ? lic.endDate.slice(0, 10) : new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    });
  };

  const saveLicense = async () => {
    setMsg('');
    try {
      await api.put(`/tenants/${editLicense}/license`, licenseForm);
      setMsg(`License updated for ${editLicense}`);
      setEditLicense(null);
      loadData();
    } catch (err) { setMsg(err.response?.data?.error || 'Failed to save license'); }
  };

  const toggleActive = async (clientNumber, currentActive) => {
    try {
      await api.patch(`/tenants/${clientNumber}`, { isActive: !currentActive });
      loadData();
    } catch { setMsg('Failed to update'); }
  };

  const priceMap = {};
  prices.forEach(p => { priceMap[p.roleType] = Number(p.pricePerSeat); });

  const calcTotal = () => {
    const gross = (licenseForm.adminSeats * (priceMap['AD'] || 0)) +
                  (licenseForm.standardSeats * (priceMap['ST'] || 0)) +
                  (licenseForm.basicSeats * (priceMap['BS'] || 0));
    const disc = gross * (licenseForm.discount / 100);
    return { gross, disc, net: gross - disc };
  };

  if (!user?.isSuperAdmin) {
    return <div className="settings-page"><div className="settings-container"><h1>Access Denied</h1></div></div>;
  }

  return (
    <div className="settings-page">
      <div className="settings-container" style={{ maxWidth: 800 }}>
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate('/admin')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back
          </button>
          <h1>Tenant Management</h1>
        </div>

        {msg && <div className={`settings-msg ${msg.includes('Failed') ? 'error' : ''}`}>{msg}</div>}

        {/* Create Tenant */}
        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Clients ({tenants.length})</h2>
            <button className="settings-btn" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : '+ New Client'}
            </button>
          </div>

          {showCreate && (
            <div className="admin-create-form">
              <div className="settings-field">
                <label>Company Name</label>
                <input value={newTenant.name} onChange={e => setNewTenant(t => ({ ...t, name: e.target.value }))} placeholder="e.g. TallyMarks Consulting" />
              </div>
              <div className="settings-field">
                <label>Domain (optional)</label>
                <input value={newTenant.domain} onChange={e => setNewTenant(t => ({ ...t, domain: e.target.value }))} placeholder="e.g. tmc.com" />
              </div>
              <p style={{ fontSize: 11, color: '#888', marginBottom: 10 }}>Client number will be auto-generated (e.g. TMC-0001)</p>
              <button className="settings-btn" onClick={createTenant}>Create Client</button>
            </div>
          )}

          {/* Tenant List */}
          <table className="admin-table" style={{ marginTop: 14 }}>
            <thead>
              <tr><th>Client #</th><th>Name</th><th>Users</th><th>License</th><th>Expiry</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {tenants.map(t => (
                <tr key={t.clientNumber}>
                  <td><strong>{t.clientNumber}</strong></td>
                  <td>{t.name}</td>
                  <td>{t.userCount}</td>
                  <td>
                    {t.license ? (
                      <span style={{ fontSize: 11 }}>{t.license.adminSeats}AD / {t.license.standardSeats}ST / {t.license.basicSeats}BS</span>
                    ) : (
                      <span style={{ color: '#888', fontSize: 11 }}>No license</span>
                    )}
                  </td>
                  <td>
                    {t.expiry ? (
                      <span style={{ color: new Date(t.expiry) > new Date() ? '#4ade80' : '#ef4444', fontSize: 12 }}>
                        {new Date(t.expiry).toLocaleDateString()}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <span className={`badge-type ${t.isActive ? 'type-ST' : 'type-SA'}`} style={{ cursor: 'pointer' }} onClick={() => toggleActive(t.clientNumber, t.isActive)}>
                      {t.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button className="admin-action" onClick={() => openLicenseEditor(t)}>License</button>
                  </td>
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

              {/* Seat Allocation */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, margin: '16px 0' }}>
                <div className="settings-field">
                  <label>AD Seats (${priceMap['AD'] || '?'}/seat)</label>
                  <input type="number" min="0" value={licenseForm.adminSeats} onChange={e => setLicenseForm(f => ({ ...f, adminSeats: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="settings-field">
                  <label>ST Seats (${priceMap['ST'] || '?'}/seat)</label>
                  <input type="number" min="0" value={licenseForm.standardSeats} onChange={e => setLicenseForm(f => ({ ...f, standardSeats: parseInt(e.target.value) || 0 }))} />
                </div>
                <div className="settings-field">
                  <label>BS Seats (${priceMap['BS'] || '?'}/seat)</label>
                  <input type="number" min="0" value={licenseForm.basicSeats} onChange={e => setLicenseForm(f => ({ ...f, basicSeats: parseInt(e.target.value) || 0 }))} />
                </div>
              </div>

              {/* Terms */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <div className="settings-field">
                  <label>Discount %</label>
                  <input type="number" min="0" max="100" value={licenseForm.discount} onChange={e => setLicenseForm(f => ({ ...f, discount: parseFloat(e.target.value) || 0 }))} />
                </div>
                <div className="settings-field">
                  <label>Billing Term</label>
                  <select value={licenseForm.term} onChange={e => setLicenseForm(f => ({ ...f, term: e.target.value }))}>
                    <option value="M">Monthly</option>
                    <option value="Q">Quarterly</option>
                    <option value="Y">Yearly</option>
                  </select>
                </div>
                <div />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div className="settings-field">
                  <label>Start Date</label>
                  <input type="date" value={licenseForm.startDate} onChange={e => setLicenseForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div className="settings-field">
                  <label>End Date</label>
                  <input type="date" value={licenseForm.endDate} onChange={e => setLicenseForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>

              {/* Price Summary */}
              {(() => {
                const { gross, disc, net } = calcTotal();
                return (
                  <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 14, margin: '16px 0', fontSize: 13 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#888' }}>
                      <span>Gross Amount</span><span>${gross.toLocaleString()}</span>
                    </div>
                    {disc > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4ade80' }}>
                        <span>Discount ({licenseForm.discount}%)</span><span>-${disc.toLocaleString()}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--accent)', fontWeight: 700, fontSize: 15, marginTop: 6, paddingTop: 6, borderTop: '1px solid #333' }}>
                      <span>Net Amount</span><span>${net.toLocaleString()}/period</span>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="settings-btn" onClick={() => setEditLicense(null)} style={{ flex: 1, background: '#333' }}>Cancel</button>
                <button className="settings-btn" onClick={saveLicense} style={{ flex: 1 }}>Save License</button>
              </div>
            </div>
          </div>
        )}

        {/* Pricing Editor */}
        <section className="settings-section">
          <h2>License Pricing (per seat/month)</h2>
          <table className="admin-table">
            <thead>
              <tr><th>Type</th><th>Price (USD)</th><th>Description</th><th></th></tr>
            </thead>
            <tbody>
              {prices.map(p => (
                <PriceRow key={p.roleType} price={p} onSaved={loadData} setMsg={setMsg} />
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function PriceRow({ price, onSaved, setMsg }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(Number(price.pricePerSeat));
  const [desc, setDesc] = useState(price.description || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/tenants/prices/${price.roleType}`, { pricePerSeat: val, description: desc });
      setMsg(`Price updated for ${price.roleType}`);
      setEditing(false);
      onSaved();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Failed to save price');
    }
    setSaving(false);
  };

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
        <button className="admin-action" onClick={save} disabled={saving} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>{saving ? '...' : 'Save'}</button>
        <button className="admin-action" onClick={() => setEditing(false)}>Cancel</button>
      </td>
    </tr>
  );
}
