import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';

const s = {
  section: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, padding: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: '#e8e8e0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4, marginTop: 12 },
  input: { width: '100%', background: '#2a2a2a', border: '1px solid #444', color: '#eee', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' },
  btn: { padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' },
  btnPrimary: { background: '#cc6b4a', color: '#fff' },
  btnDanger: { background: '#ef4444', color: '#fff' },
  btnOutline: { background: 'transparent', border: '1px solid #555', color: '#aaa' },
  statusDot: (color) => ({ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', marginRight: 8 }),
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500 },
  row: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 },
  progress: { height: 6, background: '#333', borderRadius: 3, flex: 1 },
  progressFill: (pct) => ({ height: '100%', borderRadius: 3, background: pct > 80 ? '#ef4444' : '#cc6b4a', width: `${Math.min(pct, 100)}%` }),
  qrBox: { textAlign: 'center', padding: 20, background: '#fff', borderRadius: 12, display: 'inline-block' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 },
  th: { background: '#2a2a2a', color: '#e8e8e0', textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #cc6b4a', fontSize: 11, textTransform: 'uppercase' },
  td: { padding: '7px 10px', borderBottom: '1px solid #2a2a2a', color: '#bbb' },
};

const STATUS_COLORS = { connected: '#4ade80', connecting: '#f59e0b', disconnected: '#666', error: '#ef4444', not_configured: '#666' };

export default function WhatsAppTab({ user, msg, setMsg }) {
  // ── Tenant selector (SuperAdmin can pick which client to configure) ──
  const [tenants, setTenants] = useState([]);
  const [selectedTenant, setSelectedTenant] = useState(user?.clientNumber || '');

  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [qrCode, setQrCode] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [testNumber, setTestNumber] = useState('');
  const [showTest, setShowTest] = useState(false);
  const qrPollRef = useRef(null);

  // Form state
  const [companyNumber, setCompanyNumber] = useState(''); // The bot's WhatsApp number users message TO
  const [provider, setProvider] = useState('webjs');
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState('');
  const [metaAccessToken, setMetaAccessToken] = useState('');
  const [metaBusinessId, setMetaBusinessId] = useState('');
  const [metaWebhookSecret, setMetaWebhookSecret] = useState('');
  const [dailyLimit, setDailyLimit] = useState(100);
  const [monthlyLimit, setMonthlyLimit] = useState(2000);
  const [maxTokens, setMaxTokens] = useState(400);

  // ── Load tenant list for SuperAdmin ─────────────────────────────
  useEffect(() => {
    if (user?.isSuperAdmin) {
      api.get('/tenants').then(r => {
        const list = r.data?.tenants || r.data || [];
        setTenants(list);
        if (!selectedTenant && list.length > 0) setSelectedTenant(list[0].clientNumber);
      }).catch(() => {});
    }
  }, []);

  // ── Reload when tenant changes ──────────────────────────────────
  useEffect(() => {
    if (selectedTenant) loadAll();
    return () => { if (qrPollRef.current) clearInterval(qrPollRef.current); };
  }, [selectedTenant]);

  // Helper: add tenant query param for SuperAdmin
  const q = user?.isSuperAdmin && selectedTenant ? `?cn=${selectedTenant}` : '';
  const qAnd = user?.isSuperAdmin && selectedTenant ? `&cn=${selectedTenant}` : '';

  async function loadAll() {
    setLoading(true);
    try {
      const [cfgRes, statusRes, msgRes, sessRes] = await Promise.all([
        api.get(`/admin/whatsapp/config${q}`).catch(() => ({ data: { configured: false } })),
        api.get(`/admin/whatsapp/status${q}`).catch(() => ({ data: { status: 'not_configured' } })),
        api.get(`/admin/whatsapp/messages?limit=20${qAnd}`).catch(() => ({ data: { messages: [] } })),
        api.get(`/admin/whatsapp/sessions${q}`).catch(() => ({ data: { sessions: [] } })),
      ]);
      setConfig(cfgRes.data);
      setStatus(statusRes.data);
      setMessages(msgRes.data.messages || []);
      setSessions(sessRes.data.sessions || []);
      if (cfgRes.data.configured) {
        setProvider(cfgRes.data.provider || 'webjs');
        setCompanyNumber(cfgRes.data.connected_number || cfgRes.data.company_number || '');
        setDailyLimit(cfgRes.data.daily_limit || 100);
        setMonthlyLimit(cfgRes.data.monthly_limit || 2000);
        setMaxTokens(cfgRes.data.max_tokens_data || 400);
      }
      // Auto-start QR polling if already in connecting state
      if (statusRes.data?.status === 'connecting') {
        // Fetch QR immediately (don't wait for first poll interval)
        try {
          const qrRes = await api.get(`/admin/whatsapp/qr${q}`);
          if (qrRes.data.qrCode) setQrCode(qrRes.data.qrCode);
        } catch {}
        startQRPolling();
      }
    } catch {}
    setLoading(false);
  }

  // ── Save config ─────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true);
    try {
      await api.post(`/admin/whatsapp/config${q}`, {
        provider,
        companyNumber: companyNumber || undefined,
        ...(provider === 'meta' ? { metaPhoneNumberId, metaAccessToken: metaAccessToken || undefined, metaBusinessId, metaWebhookSecret: metaWebhookSecret || undefined } : {}),
        dailyLimit, monthlyLimit, maxTokensData: maxTokens,
      });
      setMsg('WhatsApp config saved');
      await loadAll();
    } catch (e) { setMsg('Failed to save config'); }
    setSaving(false);
  }

  // ── Connect ─────────────────────────────────────────────────────
  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await api.post(`/admin/whatsapp/connect${q}`);
      setStatus(res.data);
      if (res.data.status === 'connecting') {
        // Start polling for QR code (webjs)
        startQRPolling();
      }
      setMsg(res.data.status === 'connected' ? 'Connected!' : 'Connecting... scan QR code');
    } catch (e) { setMsg('Connection failed'); }
    setConnecting(false);
  }

  // ── QR polling ──────────────────────────────────────────────────
  function startQRPolling() {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    qrPollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/admin/whatsapp/qr${q}`);
        if (res.data.qrCode) setQrCode(res.data.qrCode);
        if (res.data.status === 'connected') {
          clearInterval(qrPollRef.current);
          qrPollRef.current = null;
          setQrCode(null);
          setMsg('WhatsApp connected!');
          loadAll();
        }
      } catch {}
    }, 3000);
  }

  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // ── Disconnect ──────────────────────────────────────────────────
  async function handleDisconnect() {
    try {
      await api.post(`/admin/whatsapp/disconnect${q}`);
      if (qrPollRef.current) { clearInterval(qrPollRef.current); qrPollRef.current = null; }
      setQrCode(null);
      setMsg('Disconnected');
      loadAll();
    } catch (e) { setMsg('Disconnect failed'); }
  }

  // ── Test message ────────────────────────────────────────────────
  async function handleTestSend() {
    if (!testNumber) return;
    try {
      const res = await api.post(`/admin/whatsapp/test${q}`, { testNumber });
      setMsg(res.data.success ? `Test sent! (ID: ${res.data.messageId})` : `Test failed: ${res.data.error}`);
      setShowTest(false);
      loadAll();
    } catch (e) { setMsg('Test send failed'); }
  }

  // ── Approve / Reject ───────────────────────────────────────────
  async function handleApprove(id) {
    try { await api.post(`/admin/whatsapp/messages/${id}/approve`); setMsg('Approved & sent'); loadAll(); } catch { setMsg('Approve failed'); }
  }
  async function handleReject(id) {
    try { await api.post(`/admin/whatsapp/messages/${id}/reject`); setMsg('Rejected'); loadAll(); } catch { setMsg('Reject failed'); }
  }

  if (loading) return <div style={{ color: '#888', padding: 20 }}>Loading WhatsApp config...</div>;

  const st = status?.status || 'not_configured';
  const todayPct = status?.daily_limit ? (status.messages_today / status.daily_limit) * 100 : 0;
  const monthPct = status?.monthly_limit ? (status.messages_this_month / status.monthly_limit) * 100 : 0;

  return (
    <div>
      {/* ── Tenant Selector ──────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Configure WhatsApp for Client</div>
        {user?.isSuperAdmin && tenants.length > 0 ? (
          <>
            <label style={s.label}>Select Client</label>
            <select
              style={{ ...s.input, cursor: 'pointer' }}
              value={selectedTenant}
              onChange={e => setSelectedTenant(e.target.value)}
            >
              {tenants.map(t => (
                <option key={t.clientNumber} value={t.clientNumber}>
                  {t.name} ({t.clientNumber})
                </option>
              ))}
            </select>
          </>
        ) : (
          <div style={{ color: '#eee', fontSize: 14 }}>
            Client: <strong>{user?.clientNumber}</strong>
          </div>
        )}
      </div>

      {/* ── Section 1: Provider Selection ──────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Provider</div>
        <div style={{ display: 'flex', gap: 12 }}>
          {[
            { key: 'webjs', label: 'WhatsApp Web', desc: 'Free — development/testing only', badge: 'DEV', badgeColor: '#f59e0b' },
            { key: 'meta', label: 'Meta Cloud API', desc: 'Production — recommended', badge: 'PROD', badgeColor: '#4ade80' },
          ].map(p => (
            <label key={p.key} style={{
              flex: 1, padding: 14, background: provider === p.key ? '#252525' : '#1a1a1a',
              border: `2px solid ${provider === p.key ? '#cc6b4a' : '#333'}`, borderRadius: 10, cursor: 'pointer',
            }}>
              <input type="radio" name="provider" value={p.key} checked={provider === p.key} onChange={() => setProvider(p.key)} style={{ display: 'none' }} />
              <div style={{ fontWeight: 600, color: '#eee', fontSize: 14 }}>{p.label}</div>
              <div style={{ color: '#888', fontSize: 12, marginTop: 4 }}>{p.desc}</div>
              <span style={{ ...s.badge, background: p.badgeColor + '22', color: p.badgeColor, marginTop: 6 }}>{p.badge}</span>
            </label>
          ))}
        </div>
      </div>

      {/* ── Company WhatsApp Number (both providers) ──────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Company WhatsApp Number</div>
        <p style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>
          This is the WhatsApp number your employees will message to chat with the AI.
          {provider === 'webjs' ? ' For Web.js, this will be the number of the phone that scans the QR code.' : ' For Meta, this is your registered WhatsApp Business number.'}
        </p>
        <label style={s.label}>WhatsApp Number (E.164 format) *</label>
        <input style={{
          ...s.input, maxWidth: 300,
          borderColor: companyNumber && !/^\+\d{10,15}$/.test(companyNumber.replace(/[\s-]/g, '')) ? '#ef4444' : '#444',
        }} value={companyNumber} onChange={e => setCompanyNumber(e.target.value)} placeholder="+923001234567" />
        {companyNumber && !/^\+\d{10,15}$/.test(companyNumber.replace(/[\s-]/g, '')) && (
          <p style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Invalid format. Must start with + followed by 10-15 digits. Example: +923001234567</p>
        )}
        <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>This number will be shown to users in their Settings page so they know where to send messages.</p>
      </div>

      {/* ── Section 2: Credentials ─────────────────────────────── */}
      {provider === 'meta' && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Meta Cloud API Credentials</div>
          <label style={s.label}>Phone Number ID *</label>
          <input style={s.input} value={metaPhoneNumberId} onChange={e => setMetaPhoneNumberId(e.target.value)} placeholder="From Meta Business → WhatsApp → API Setup" />
          <label style={s.label}>Access Token *</label>
          <input style={s.input} type="password" value={metaAccessToken} onChange={e => setMetaAccessToken(e.target.value)} placeholder="Permanent token from Meta Business" />
          <label style={s.label}>Business Account ID</label>
          <input style={s.input} value={metaBusinessId} onChange={e => setMetaBusinessId(e.target.value)} placeholder="Meta Business Account ID" />
          <label style={s.label}>Webhook Verify Token</label>
          <input style={s.input} value={metaWebhookSecret} onChange={e => setMetaWebhookSecret(e.target.value)} placeholder="Any secret string you choose" />

          <label style={s.label}>Webhook URL (register this in Meta Dashboard)</label>
          <div style={{ ...s.input, background: '#1a1a1a', color: '#cc6b4a', userSelect: 'all', cursor: 'text' }}>
            {window.location.origin.replace(':5174', ':4002')}/api/v1/webhooks/whatsapp/{user?.clientNumber}
          </div>
        </div>
      )}

      {provider === 'webjs' && (
        <div style={s.section}>
          <div style={s.sectionTitle}>WhatsApp Web (QR Code)</div>
          <p style={{ color: '#888', fontSize: 12, lineHeight: 1.6 }}>
            Uses your WhatsApp account via QR scan. <strong style={{ color: '#f59e0b' }}>Development and testing only.</strong><br />
            Use a spare SIM — not your main WhatsApp number.
          </p>
        </div>
      )}

      {/* ── Limits ─────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Limits & Response Settings</div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Daily Message Limit</label>
            <input style={s.input} type="number" value={dailyLimit} onChange={e => setDailyLimit(+e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Monthly Message Limit</label>
            <input style={s.input} type="number" value={monthlyLimit} onChange={e => setMonthlyLimit(+e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={s.label}>Max Response Tokens</label>
            <input style={s.input} type="number" value={maxTokens} onChange={e => setMaxTokens(+e.target.value)} />
            <p style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Controls response length. 400 = ~100 words. Higher = longer answers, more cost.</p>
          </div>
        </div>
      </div>

      {/* ── Save + Test Connection ────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        <button style={{ ...s.btn, ...s.btnOutline }} onClick={async () => {
          try {
            const res = await api.post(`/admin/whatsapp/test-connection${q}`);
            if (res.data.success) {
              setMsg(`Connection OK — Connected number: ${res.data.connectedNumber}`);
            } else {
              setMsg(`Connection failed: ${res.data.error}`);
            }
          } catch { setMsg('Test connection failed'); }
        }}>
          Test Connection
        </button>
      </div>

      {/* ── Section 3: Connection Status ───────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Connection Status</div>
        <div style={s.row}>
          <span style={s.statusDot(STATUS_COLORS[st] || '#666')} />
          <span style={{ fontWeight: 600, color: '#eee', textTransform: 'uppercase' }}>{st}</span>
          {status?.connected_number && <span style={{ color: '#888', marginLeft: 8 }}>{status.connected_number}</span>}
          {status?.connected_at && <span style={{ color: '#555', fontSize: 11, marginLeft: 8 }}>Since {new Date(status.connected_at).toLocaleString()}</span>}
        </div>

        {/* QR Code display (webjs connecting) */}
        {qrCode && st === 'connecting' && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={s.qrBox}>
              <img src={qrCode} alt="QR Code" style={{ width: 250, height: 250 }} />
            </div>
            <p style={{ color: '#888', fontSize: 12, marginTop: 8 }}>Open WhatsApp → Linked Devices → Link a Device → Scan this QR</p>
            <p style={{ color: '#555', fontSize: 11 }}>QR refreshes automatically every 3 seconds</p>
          </div>
        )}

        {/* Error display */}
        {st === 'error' && status?.last_error && (
          <div style={{ marginTop: 8, padding: 10, background: '#2a1a1a', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 12 }}>
            {status.last_error}
          </div>
        )}

        {/* Usage bars */}
        {st === 'connected' && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: '#888', fontSize: 12, width: 80 }}>Today</span>
              <div style={s.progress}><div style={s.progressFill(todayPct)} /></div>
              <span style={{ color: '#aaa', fontSize: 12, minWidth: 70, textAlign: 'right' }}>{status.messages_today} / {status.daily_limit}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#888', fontSize: 12, width: 80 }}>This month</span>
              <div style={s.progress}><div style={s.progressFill(monthPct)} /></div>
              <span style={{ color: '#aaa', fontSize: 12, minWidth: 70, textAlign: 'right' }}>{status.messages_this_month} / {status.monthly_limit}</span>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div style={{ ...s.row, marginTop: 16 }}>
          {(st === 'disconnected' || st === 'not_configured' || st === 'error') && (
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleConnect} disabled={connecting}>
              {connecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
          {st === 'connected' && (
            <>
              <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => setShowTest(true)}>Send Test Message</button>
              {!confirmDisconnect ? (
                <button style={{ ...s.btn, ...s.btnDanger }} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
              ) : (
                <>
                  <span style={{ color: '#ef4444', fontSize: 12, marginRight: 6 }}>Are you sure?</span>
                  <button style={{ ...s.btn, ...s.btnDanger, fontSize: 11, padding: '4px 12px' }} onClick={() => { setConfirmDisconnect(false); handleDisconnect(); }}>Yes, Disconnect</button>
                  <button style={{ ...s.btn, ...s.btnOutline, fontSize: 11, padding: '4px 12px' }} onClick={() => setConfirmDisconnect(false)}>Cancel</button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Test Message Modal ─────────────────────────────────── */}
      {showTest && (
        <div style={s.section}>
          <div style={s.sectionTitle}>Send Test Message</div>
          <label style={s.label}>Phone Number (E.164 format)</label>
          <input style={s.input} value={testNumber} onChange={e => setTestNumber(e.target.value)} placeholder="+923001234567" />
          <p style={{ color: '#888', fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            Message: "This is a test message from TMCAI. WhatsApp is configured correctly. — Sent via TMCAI Admin Panel"
          </p>
          <div style={{ ...s.row, marginTop: 12 }}>
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleTestSend}>Send Test</button>
            <button style={{ ...s.btn, ...s.btnOutline }} onClick={() => setShowTest(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Section 4: Message Log ─────────────────────────────── */}
      <div style={s.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={s.sectionTitle}>Recent Messages</div>
          <button style={{ ...s.btn, ...s.btnOutline, fontSize: 11 }} onClick={loadAll}>Refresh</button>
        </div>
        {messages.length === 0 ? (
          <p style={{ color: '#555', fontSize: 12 }}>No messages yet</p>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th}>Dir</th>
                  <th style={s.th}>Number</th>
                  <th style={s.th}>Content</th>
                  <th style={s.th}>Status</th>
                  <th style={s.th}>Time</th>
                  <th style={s.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m, i) => (
                  <tr key={m.id || i}>
                    <td style={s.td}>{m.direction === 'inbound' ? '📥' : '📤'}</td>
                    <td style={s.td}>{m.from_number || m.to_number}</td>
                    <td style={{ ...s.td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content?.slice(0, 60)}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge,
                        background: m.status === 'sent' ? '#4ade8022' : m.status === 'failed' ? '#ef444422' : m.status === 'queued' ? '#f59e0b22' : '#33333366',
                        color: m.status === 'sent' ? '#4ade80' : m.status === 'failed' ? '#ef4444' : m.status === 'queued' ? '#f59e0b' : '#888',
                      }}>{m.status}</span>
                    </td>
                    <td style={{ ...s.td, fontSize: 11, color: '#555' }}>{m.created_at ? new Date(m.created_at).toLocaleString() : ''}</td>
                    <td style={s.td}>
                      {m.status === 'queued' && m.requires_approval && (
                        <>
                          <button style={{ ...s.btn, ...s.btnPrimary, fontSize: 10, padding: '2px 8px', marginRight: 4 }} onClick={() => handleApprove(m.id)}>Approve</button>
                          <button style={{ ...s.btn, ...s.btnDanger, fontSize: 10, padding: '2px 8px' }} onClick={() => handleReject(m.id)}>Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Section 5: Active Sessions ─────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionTitle}>Active WhatsApp Sessions</div>
        {sessions.length === 0 ? (
          <p style={{ color: '#555', fontSize: 12 }}>No active conversations</p>
        ) : (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>User</th>
                <th style={s.th}>Messages</th>
                <th style={s.th}>Last Active</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((ses, i) => (
                <tr key={ses.id || i}>
                  <td style={s.td}>{ses.user_name}</td>
                  <td style={s.td}>{ses.message_count}</td>
                  <td style={{ ...s.td, fontSize: 11 }}>{ses.last_message_at ? new Date(ses.last_message_at).toLocaleString() : ''}</td>
                  <td style={s.td}>
                    <button style={{ ...s.btn, ...s.btnOutline, fontSize: 10, padding: '2px 8px' }}
                      onClick={async () => { await api.delete(`/admin/whatsapp/sessions/${ses.id}`); loadAll(); }}>
                      End Session
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
