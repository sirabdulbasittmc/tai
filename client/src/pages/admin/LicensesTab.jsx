import React, { useState, useEffect } from 'react';
import api from '../../services/api';

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

export default LicensesTab;
export { PriceRow };
