import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const s = {
  page: { padding: '20px 24px', maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  card: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, padding: 16, marginBottom: 12 },
  cardActive: { borderColor: '#4ade80' },
  cardFired: { borderColor: '#555', opacity: 0.6 },
  name: { fontSize: 16, fontWeight: 600, color: '#eee' },
  badge: (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, background: color + '22', color, marginLeft: 8 }),
  meta: { fontSize: 12, color: '#888', marginTop: 4 },
  btn: { padding: '7px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500, fontFamily: 'inherit' },
  btnPrimary: { background: '#cc6b4a', color: '#fff' },
  btnOutline: { background: 'transparent', border: '1px solid #555', color: '#aaa' },
  btnDanger: { background: '#ef4444', color: '#fff' },
  btnSuccess: { background: '#4ade80', color: '#111' },
  input: { width: '100%', background: '#2a2a2a', border: '1px solid #444', color: '#eee', padding: '8px 12px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' },
  label: { display: 'block', fontSize: 12, color: '#888', marginBottom: 4, marginTop: 14 },
  section: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 10, padding: 20, marginBottom: 16 },
};

export default function AgentsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [showWizard, setShowWizard] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('active'); // active | archive

  useEffect(() => { loadAgents(); }, []);

  async function loadAgents() {
    try {
      const res = await api.get('/agents');
      setAgents(res.data.agents || []);
    } catch {}
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div>
          <button style={{ ...s.btn, ...s.btnOutline, marginRight: 10 }} onClick={() => navigate('/')}>
            ← Back to Chat
          </button>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#eee' }}>My Team</span>
          <span style={{ ...s.badge('#cc6b4a'), marginLeft: 12 }}>{agents.filter(a => a.is_active).length} Active</span>
        </div>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => { setSelectedAgent(null); setShowWizard(true); }}>
          + Hire New Agent
        </button>
      </div>

      {msg && <div style={{ padding: '8px 14px', background: '#252525', border: '1px solid #444', borderRadius: 8, marginBottom: 12, color: '#eee', fontSize: 13 }}>{msg}</div>}

      {/* Tabs: Active / Archive */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        <button onClick={() => setTab('active')} style={{
          ...s.btn, ...(tab === 'active' ? s.btnPrimary : s.btnOutline), padding: '6px 20px',
        }}>
          Active ({agents.filter(a => a.is_active).length})
        </button>
        <button onClick={() => setTab('archive')} style={{
          ...s.btn, ...(tab === 'archive' ? { background: '#555', color: '#fff', border: 'none' } : s.btnOutline), padding: '6px 20px',
        }}>
          Archive ({agents.filter(a => !a.is_active).length})
        </button>
      </div>

      {/* Agent List */}
      {(() => {
        const filtered = agents.filter(a => tab === 'active' ? a.is_active : !a.is_active);
        if (filtered.length === 0 && tab === 'active') return (
        <div style={{ textAlign: 'center', padding: 60, color: '#555' }}>
          <p style={{ fontSize: 16 }}>No agents hired yet</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>Hire your first AI agent to monitor projects, track risks, or scout opportunities.</p>
          <button style={{ ...s.btn, ...s.btnPrimary, marginTop: 16 }} onClick={() => setShowWizard(true)}>Hire First Agent</button>
        </div>
      );
        if (filtered.length === 0 && tab === 'archive') return (
          <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>
            <p style={{ fontSize: 14 }}>No archived agents</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Fired agents will appear here</p>
          </div>
        );
        return filtered.map(agent => (
          <AgentCard key={agent.id} agent={agent} onRefresh={loadAgents} setMsg={setMsg}
            onEdit={() => { setSelectedAgent(agent); setShowWizard(true); }}
            onViewRuns={() => setSelectedAgent({ ...agent, showRuns: true })} />
        ));
      })()}

      {/* Wizard Modal */}
      {showWizard && (
        <AgentWizard
          agent={selectedAgent}
          onClose={() => { setShowWizard(false); setSelectedAgent(null); }}
          onSaved={() => { setShowWizard(false); setSelectedAgent(null); loadAgents(); setMsg('Agent saved!'); }}
        />
      )}

      {/* Run History */}
      {selectedAgent?.showRuns && (
        <RunHistory agentId={selectedAgent.id} agentName={selectedAgent.display_name || selectedAgent.name}
          onClose={() => setSelectedAgent(null)} />
      )}
    </div>
  );
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({ agent, onRefresh, setMsg, onEdit, onViewRuns }) {
  const [confirmFire, setConfirmFire] = useState(false);
  const [fireReason, setFireReason] = useState('');
  const [running, setRunning] = useState(!!agent.is_running);
  const [abortCtrl, setAbortCtrl] = useState(null);

  // Sync running state from server data on prop change
  useEffect(() => { setRunning(!!agent.is_running); }, [agent.is_running]);

  // Poll for completion while running
  useEffect(() => {
    if (!running) return;
    const poll = setInterval(() => { onRefresh(); }, 5000); // check every 5s
    return () => clearInterval(poll);
  }, [running]);

  const isActive = agent.is_active;
  const statusColor = isActive ? (running ? '#f59e0b' : '#4ade80') : '#666';
  const hasError = agent.error_count >= 3;

  async function handleRun() {
    const ctrl = new AbortController();
    setAbortCtrl(ctrl);
    setRunning(true);
    try {
      const res = await api.post(`/agents/${agent.id}/run`, {}, { signal: ctrl.signal });
      setMsg(res.data.success ? `${agent.display_name || agent.name}: ${res.data.summary || 'Run completed'}` : `Error: ${res.data.error}`);
      onRefresh();
    } catch (e) {
      if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') {
        setMsg(`${agent.display_name || agent.name}: Run stopped.`);
      } else {
        setMsg('Run failed');
      }
    }
    setRunning(false);
    setAbortCtrl(null);
  }

  function handleStop() {
    if (abortCtrl) abortCtrl.abort();
    setRunning(false);
    setAbortCtrl(null);
    setMsg(`${agent.display_name || agent.name}: Stopping...`);
  }

  async function handleFire() {
    try {
      await api.post(`/agents/${agent.id}/fire`, { reason: fireReason || 'Fired by user' });
      setMsg(`${agent.display_name || agent.name} has been fired.`);
      setConfirmFire(false);
      onRefresh();
    } catch { setMsg('Failed to fire agent'); }
  }

  async function handleHire() {
    try {
      await api.post(`/agents/${agent.id}/hire`);
      setMsg(`${agent.display_name || agent.name} has been re-hired!`);
      onRefresh();
    } catch { setMsg('Failed to hire agent'); }
  }

  return (
    <div style={{ ...s.card, ...(isActive ? (running ? { borderColor: '#f59e0b' } : s.cardActive) : s.cardFired) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span style={s.name}>{agent.display_name || agent.name}</span>
          <span style={s.badge(statusColor)}>
            {running ? 'RUNNING...' : isActive ? (hasError ? 'PAUSED (errors)' : 'ACTIVE') : 'FIRED'}
          </span>
          {agent.schedule && <span style={s.badge('#3b82f6')}>{agent.schedule}</span>}
          <p style={s.meta}>{agent.instructions?.slice(0, 120)}{agent.instructions?.length > 120 ? '...' : ''}</p>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: '#666' }}>
            <span>Runs: {agent.run_count || 0}</span>
            <span>Errors: {agent.error_count || 0}</span>
            {agent.last_run_at && <span>Last run: {new Date(agent.last_run_at).toLocaleString()}</span>}
            {agent.next_run_at && <span>Next: {new Date(agent.next_run_at).toLocaleString()}</span>}
          </div>
          {agent.last_result && (
            <p style={{ fontSize: 12, color: '#aaa', marginTop: 6, background: '#252525', padding: '6px 10px', borderRadius: 6 }}>
              Last finding: {agent.last_result?.slice(0, 150)}
            </p>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {isActive && (
          <>
            {!running ? (
              <button style={{ ...s.btn, ...s.btnPrimary }} onClick={handleRun}>▶ Run Now</button>
            ) : (
              <>
                <button style={{ ...s.btn, ...s.btnPrimary, opacity: 0.5, cursor: 'not-allowed' }} disabled>⏳ Running...</button>
                <button style={{ ...s.btn, background: '#f59e0b', color: '#111' }} onClick={handleStop}>⏹ Stop</button>
              </>
            )}
            <button style={{ ...s.btn, ...s.btnOutline, ...(running ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }}
              onClick={() => { if (!running) onEdit(); }} disabled={running}
              title={running ? 'Stop the agent first to edit' : 'Edit agent'}>
              Edit
            </button>
            <button style={{ ...s.btn, ...s.btnOutline }} onClick={onViewRuns}>History</button>
            {running && (
              <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 4 }}>Stop agent to edit or fire</span>
            )}
            {!running && !confirmFire && (
              <button style={{ ...s.btn, ...s.btnDanger }} onClick={() => setConfirmFire(true)}>Fire</button>
            )}
            {!running && confirmFire && (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: '#ef4444' }}>Fire this agent?</span>
                <button style={{ ...s.btn, ...s.btnDanger, fontSize: 11, padding: '4px 10px' }} onClick={handleFire}>Yes, Fire</button>
                <button style={{ ...s.btn, ...s.btnOutline, fontSize: 11, padding: '4px 10px' }} onClick={() => setConfirmFire(false)}>Cancel</button>
              </div>
            )}
            {running && (
              <button style={{ ...s.btn, ...s.btnDanger }} onClick={async () => {
                handleStop();
                await api.post(`/agents/${agent.id}/fire`, { reason: 'Stopped by user' }).catch(() => {});
                setMsg(`${agent.display_name || agent.name} stopped and fired.`);
                onRefresh();
              }}>⏹ Stop & Fire</button>
            )}
          </>
        )}
        {!isActive && (
          <>
            <button style={{ ...s.btn, ...s.btnSuccess }} onClick={handleHire}>Re-Hire</button>
            <button style={{ ...s.btn, ...s.btnOutline }} onClick={() => onEdit()}>Edit & Re-Hire</button>
            <button style={{ ...s.btn, ...s.btnOutline }} onClick={onViewRuns}>History</button>
            {!confirmFire ? (
              <button style={{ ...s.btn, ...s.btnDanger, fontSize: 11 }} onClick={() => setConfirmFire(true)}>Fire Permanently</button>
            ) : (
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: '#ef4444' }}>Delete agent and all history?</span>
                <button style={{ ...s.btn, ...s.btnDanger, fontSize: 11, padding: '4px 10px' }}
                  onClick={async () => {
                    try {
                      await api.delete(`/agents/${agent.id}`);
                      setMsg(`${agent.display_name || agent.name} permanently removed.`);
                      onRefresh();
                    } catch { setMsg('Failed to delete'); }
                  }}>Yes, Delete</button>
                <button style={{ ...s.btn, ...s.btnOutline, fontSize: 11, padding: '4px 10px' }} onClick={() => setConfirmFire(false)}>Cancel</button>
              </div>
            )}
            {agent.last_error && <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>Fired: {agent.last_error?.slice(0, 80)}</span>}
          </>
        )}
        {hasError && isActive && !running && (
          <button style={{ ...s.btn, ...s.btnOutline, borderColor: '#f59e0b', color: '#f59e0b' }}
            onClick={async () => { await api.post(`/agents/${agent.id}/reset-breaker`); onRefresh(); }}>
            Reset Errors
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Agent Wizard (Hire / Edit) ───────────────────────────────────────────────

function AgentWizard({ agent, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hasWhatsApp, setHasWhatsApp] = useState(false);

  // Check if user has WhatsApp number registered
  useEffect(() => {
    api.get('/agents/whatsapp/status').then(r => {
      setHasWhatsApp(!!r.data?.connected);
    }).catch(() => setHasWhatsApp(false));
  }, []);

  const [form, setForm] = useState({
    name: agent?.name || '',
    displayName: agent?.display_name || '',
    gender: agent?.gender || '',
    instructions: agent?.instructions || '',
    personality: agent?.personality || '',
    dataSources: agent?.data_sources || ['org'],
    schedule: agent?.schedule || '',
    notifyEmail: agent?.notify_email ?? true,
    notifyWhatsapp: agent?.notify_whatsapp ?? false,
    notifyRecipients: (agent?.notify_recipients || []).join(', '),
    notifyWhatsappNumbers: (agent?.notify_whatsapp_numbers || []).join(', '),
  });

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  async function handleSave() {
    setSaving(true);
    try {
      const data = {
        ...form,
        dataSources: form.dataSources,
        notifyRecipients: form.notifyRecipients ? form.notifyRecipients.split(',').map(s => s.trim()).filter(Boolean) : [],
        notifyWhatsappNumbers: form.notifyWhatsappNumbers ? form.notifyWhatsappNumbers.split(',').map(s => s.trim()).filter(Boolean) : [],
      };
      if (agent?.id) {
        await api.put(`/agents/${agent.id}`, data);
      } else {
        await api.post('/agents', data);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  }

  const STEPS = [
    { num: 1, label: 'Identity' },
    { num: 2, label: 'Task' },
    { num: 3, label: 'Schedule' },
    { num: 4, label: 'Notifications' },
    { num: 5, label: 'Review & Hire' },
  ];

  const SCHEDULE_PRESETS = [
    { label: 'Every hour', value: 'hourly' },
    { label: 'Every morning (8 AM)', value: 'every morning' },
    { label: 'Twice daily (9 AM & 5 PM)', value: 'twice daily' },
    { label: 'Weekly (Monday 9 AM)', value: 'weekly' },
    { label: 'Monthly (1st, 9 AM)', value: 'monthly' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1a1a', borderRadius: 12, width: 580, maxHeight: '85vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ color: '#eee', margin: 0, fontSize: 18 }}>{agent?.id ? 'Edit Agent' : 'Hire New Agent'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}>x</button>
        </div>

        {error && <div style={{ padding: '8px 14px', background: '#2a1a1a', border: '1px solid #ef4444', borderRadius: 8, marginBottom: 12, color: '#ef4444', fontSize: 13 }}>{error}</div>}

        {/* Step Indicators */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
          {STEPS.map(st => (
            <div key={st.num} onClick={() => setStep(st.num)} style={{
              flex: 1, textAlign: 'center', padding: '6px 0', borderRadius: 6, cursor: 'pointer', fontSize: 11,
              background: step === st.num ? '#cc6b4a' : step > st.num ? '#2a3a2a' : '#252525',
              color: step === st.num ? '#fff' : step > st.num ? '#4ade80' : '#666',
            }}>
              {st.label}
            </div>
          ))}
        </div>

        {/* Step 1: Identity */}
        {step === 1 && (
          <div>
            <label style={s.label}>Agent Name *</label>
            <input style={s.input} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g., Project Sentinel" />

            <label style={s.label}>Display Name (used in WhatsApp — short, easy to type)</label>
            <input style={s.input} value={form.displayName} onChange={e => set('displayName', e.target.value)} placeholder="e.g., Atlas, Faria, Abdullah" />
            <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>This is how you'll call the agent on WhatsApp: "Faria, check risks"</p>

            <label style={s.label}>Gender</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {[
                { key: 'male', label: 'Male (He/Him)' },
                { key: 'female', label: 'Female (She/Her)' },
              ].map(g => (
                <button key={g.key} onClick={() => set('gender', g.key)} style={{
                  ...s.btn, ...(form.gender === g.key ? s.btnPrimary : s.btnOutline), fontSize: 12, padding: '6px 16px',
                }}>{g.label}</button>
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Affects how the agent refers to itself and addresses you</p>

            <label style={s.label}>Personality (optional — how the agent communicates)</label>
            <textarea style={{ ...s.input, height: 60 }} value={form.personality} onChange={e => set('personality', e.target.value)}
              placeholder="e.g., Professional and direct. Highlights risks first. Uses data to back up every claim." />
          </div>
        )}

        {/* Step 2: Task */}
        {step === 2 && (
          <div>
            <label style={s.label}>Instructions — What should this agent do? *</label>
            <textarea style={{ ...s.input, height: 120 }} value={form.instructions} onChange={e => set('instructions', e.target.value)}
              placeholder="e.g., Monitor all active projects daily. Flag any project that is behind schedule or has critical risks. Compare with previous check and highlight what changed." />
            <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>Be specific. The agent will follow these instructions every time it runs.</p>

            <label style={s.label}>Data Sources</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {['org', 'personal', 'uploads'].map(src => (
                <label key={src} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#aaa', fontSize: 13 }}>
                  <input type="checkbox" checked={form.dataSources.includes(src)}
                    onChange={e => {
                      const next = e.target.checked ? [...form.dataSources, src] : form.dataSources.filter(s => s !== src);
                      set('dataSources', next);
                    }} style={{ accentColor: '#cc6b4a' }} />
                  {src === 'org' ? 'Company Data' : src === 'personal' ? 'My Drive' : 'My Uploads'}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Schedule */}
        {step === 3 && (
          <div>
            <label style={s.label}>How often should this agent run?</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {SCHEDULE_PRESETS.map(p => (
                <button key={p.value} onClick={() => set('schedule', p.value)} style={{
                  ...s.btn, ...(form.schedule === p.value ? s.btnPrimary : s.btnOutline), fontSize: 11,
                }}>{p.label}</button>
              ))}
            </div>

            <label style={s.label}>Or custom schedule</label>
            <input style={s.input} value={form.schedule} onChange={e => set('schedule', e.target.value)}
              placeholder="e.g., 'daily at 9am', 'monday 8am', 'every 2 hours', or cron: '0 9 * * 1'" />
            <p style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
              Supports: "daily at 9am", "every morning", "weekly", "monthly", "every 2 hours", or standard cron expressions.
            </p>
          </div>
        )}

        {/* Step 4: Notifications */}
        {step === 4 && (
          <div>
            <label style={s.label}>How should the agent report findings?</label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer', color: '#aaa', fontSize: 13 }}>
              <input type="checkbox" checked={form.notifyEmail} onChange={e => set('notifyEmail', e.target.checked)} style={{ accentColor: '#cc6b4a' }} />
              Send findings by Email
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, cursor: hasWhatsApp ? 'pointer' : 'not-allowed', color: hasWhatsApp ? '#aaa' : '#555', fontSize: 13 }}>
              <input type="checkbox" checked={form.notifyWhatsapp} disabled={!hasWhatsApp}
                onChange={e => set('notifyWhatsapp', e.target.checked)} style={{ accentColor: '#cc6b4a' }} />
              Send findings on WhatsApp
              {!hasWhatsApp && <span style={{ fontSize: 11, color: '#f59e0b', marginLeft: 4 }}>(Register your WhatsApp number in Settings first)</span>}
            </label>

            {form.notifyEmail && (
              <>
                <label style={s.label}>CC email recipients (optional — comma separated)</label>
                <input style={s.input} value={form.notifyRecipients} onChange={e => set('notifyRecipients', e.target.value)}
                  placeholder="manager@company.com, team-lead@company.com" />
              </>
            )}

            {form.notifyWhatsapp && (
              <>
                <label style={s.label}>Also notify these WhatsApp numbers (optional)</label>
                <input style={s.input} value={form.notifyWhatsappNumbers} onChange={e => set('notifyWhatsappNumbers', e.target.value)}
                  placeholder="+923001234567, +923009876543" />
              </>
            )}
          </div>
        )}

        {/* Step 5: Review */}
        {step === 5 && (
          <div>
            <div style={{ background: '#252525', borderRadius: 8, padding: 16 }}>
              <h3 style={{ color: '#cc6b4a', margin: '0 0 12px', fontSize: 15 }}>Agent Summary</h3>
              <div style={{ fontSize: 13, color: '#aaa', lineHeight: 1.8 }}>
                <div><strong style={{ color: '#eee' }}>Name:</strong> {form.displayName || form.name || '—'}</div>
                <div><strong style={{ color: '#eee' }}>Task:</strong> {form.instructions?.slice(0, 100) || '—'}{form.instructions?.length > 100 ? '...' : ''}</div>
                <div><strong style={{ color: '#eee' }}>Schedule:</strong> {form.schedule || 'Manual only'}</div>
                <div><strong style={{ color: '#eee' }}>Data:</strong> {form.dataSources.join(', ')}</div>
                <div><strong style={{ color: '#eee' }}>Notify:</strong> {[form.notifyEmail && 'Email', form.notifyWhatsapp && 'WhatsApp'].filter(Boolean).join(' + ') || 'None'}</div>
                {form.notifyRecipients && <div><strong style={{ color: '#eee' }}>CC:</strong> {form.notifyRecipients}</div>}
                {form.personality && <div><strong style={{ color: '#eee' }}>Personality:</strong> {form.personality.slice(0, 60)}</div>}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
          <button style={{ ...s.btn, ...s.btnOutline }} onClick={() => step > 1 ? setStep(step - 1) : onClose()}>
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step < 5 ? (
            <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => setStep(step + 1)}
              disabled={step === 1 && !form.name || step === 2 && !form.instructions}>
              Next →
            </button>
          ) : (
            <button style={{ ...s.btn, ...s.btnSuccess, fontSize: 14, padding: '8px 24px' }} onClick={handleSave} disabled={saving}>
              {saving ? 'Hiring...' : agent?.id ? 'Save Changes' : '🤝 Hire This Agent'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Run History ──────────────────────────────────────────────────────────────

function RunHistory({ agentId, agentName, onClose }) {
  const [runs, setRuns] = useState([]);
  const [selectedRun, setSelectedRun] = useState(null);

  useEffect(() => {
    api.get(`/agents/${agentId}/runs`).then(r => setRuns(r.data.runs || [])).catch(() => {});
  }, [agentId]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1a1a1a', borderRadius: 12, width: 650, maxHeight: '80vh', overflow: 'auto', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ color: '#eee', margin: 0, fontSize: 16 }}>{agentName} — Run History</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}>x</button>
        </div>

        {selectedRun ? (
          <div>
            <button style={{ ...s.btn, ...s.btnOutline, marginBottom: 12 }} onClick={() => setSelectedRun(null)}>← Back to list</button>
            <div style={{ background: '#252525', borderRadius: 8, padding: 16 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 8 }}>
                {new Date(selectedRun.started_at).toLocaleString()} — {selectedRun.status}
                {selectedRun.tokens_used > 0 && ` — ${selectedRun.tokens_used} tokens`}
              </div>
              <pre style={{ color: '#ddd', fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6, margin: 0 }}>
                {selectedRun.findings || 'No findings recorded.'}
              </pre>
            </div>
          </div>
        ) : (
          <div>
            {runs.length === 0 ? (
              <p style={{ color: '#555', textAlign: 'center', padding: 30 }}>No runs yet. Click "Run Now" to start.</p>
            ) : (
              runs.map(run => (
                <div key={run.id} onClick={() => setSelectedRun(run)} style={{
                  ...s.card, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div>
                    <span style={{ fontSize: 12, color: run.status === 'completed' ? '#4ade80' : run.status === 'failed' ? '#ef4444' : '#f59e0b' }}>
                      {run.status === 'completed' ? '✅' : run.status === 'failed' ? '❌' : '⏳'} {run.status}
                    </span>
                    <span style={{ fontSize: 11, color: '#666', marginLeft: 12 }}>{run.trigger_type}</span>
                    <span style={{ fontSize: 11, color: '#555', marginLeft: 12 }}>{new Date(run.started_at).toLocaleString()}</span>
                    <p style={{ fontSize: 12, color: '#aaa', margin: '4px 0 0' }}>{run.findings_summary?.slice(0, 120) || run.error?.slice(0, 80) || '—'}</p>
                  </div>
                  <span style={{ color: '#555', fontSize: 16 }}>→</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
