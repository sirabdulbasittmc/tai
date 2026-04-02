import React, { useState, useEffect } from 'react';
import api from '../../services/api';

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

  const [confirmDeleteCode, setConfirmDeleteCode] = useState(null);

  const deleteTier = async (code) => {
    try { await api.delete(`/tiers/${code}`); setMsg('Tier deleted'); setConfirmDeleteCode(null); loadTiers(); } catch (err) { setMsg('Delete failed'); }
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
              {confirmDeleteCode === t.tier_code ? (
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <button className="admin-action" onClick={() => deleteTier(t.tier_code)} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Yes</button>
                  <button className="admin-action" onClick={() => setConfirmDeleteCode(null)}>No</button>
                </span>
              ) : (
                <button className="admin-action" onClick={() => setConfirmDeleteCode(t.tier_code)} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Del</button>
              )}
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

export default TierManagementTab;
