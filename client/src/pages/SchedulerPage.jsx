import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const INTERVAL_OPTIONS = [
  { label: 'Every hour', value: 'hourly' },
  { label: 'Every day', value: 'daily' },
  { label: 'Every week', value: 'weekly' },
  { label: 'Every month', value: 'monthly' },
];

const DAY_OPTIONS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function buildCron(interval, time, dayOfWeek, dayOfMonth) {
  const [h, m] = (time || '09:00').split(':').map(Number);
  switch (interval) {
    case 'hourly': return `0 * * * *`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekly': {
      const dayNum = DAY_OPTIONS.indexOf(dayOfWeek);
      return `${m} ${h} * * ${dayNum >= 0 ? dayNum + 1 : 1}`;
    }
    case 'monthly': return `${m} ${h} ${dayOfMonth || 1} * *`;
    default: return `${m} ${h} * * *`;
  }
}

export default function SchedulerPage() {
  const { user, aiName, appName } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [msg, setMsg] = useState('');
  const [running, setRunning] = useState(null);

  useEffect(() => { loadTasks(); }, []);

  const loadTasks = async () => {
    try {
      const res = await api.get('/schedules');
      setTasks(res.data.tasks || []);
    } catch {}
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const deleteTask = async (id) => {
    try {
      await api.delete(`/schedules/${id}`);
      setMsg('Task deleted');
      setConfirmDeleteId(null);
      loadTasks();
    } catch (err) { setMsg(err.response?.data?.error || 'Delete failed'); }
  };

  const toggleTask = async (task) => {
    try {
      await api.patch(`/schedules/${task.id}`, { isActive: !task.isActive });
      setMsg(task.isActive ? 'Task paused' : 'Task resumed');
      loadTasks();
    } catch (err) { setMsg(err.response?.data?.error || 'Update failed'); }
  };

  const runNow = async (id) => {
    setRunning(id);
    setMsg('Running...');
    try {
      await api.post(`/schedules/${id}/run`);
      setMsg('Done! Check your email.');
      loadTasks();
    } catch (err) { setMsg(err.response?.data?.error || 'Run failed'); }
    setRunning(null);
  };

  const displayName = aiName || appName || 'AI';

  return (
    <div className="settings-page">
      <div className="settings-container">
        <div className="settings-header">
          <button className="settings-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            Back to Chat
          </button>
          <h1>Scheduled Tasks</h1>
        </div>

        {msg && <div className={`settings-msg ${msg.includes('failed') || msg.includes('Failed') ? 'error' : ''}`}>{msg}</div>}

        <section className="settings-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2>My Tasks ({tasks.length})</h2>
              <p style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Schedule any prompt — {displayName} will run it and email you the result</p>
            </div>
            <button className="settings-btn" onClick={() => { setShowCreate(true); setEditingTask(null); }}>+ New Task</button>
          </div>
        </section>

        {(showCreate || editingTask) && (
          <TaskForm
            task={editingTask}
            userEmail={user?.email}
            onSave={() => { setShowCreate(false); setEditingTask(null); loadTasks(); setMsg(editingTask ? 'Task updated' : 'Task created and scheduled!'); }}
            onCancel={() => { setShowCreate(false); setEditingTask(null); }}
            onMsg={setMsg}
          />
        )}

        {tasks.length === 0 && !showCreate ? (
          <section className="settings-section" style={{ textAlign: 'center', padding: 40 }}>
            <p style={{ fontSize: 15, color: '#888', marginBottom: 12 }}>No scheduled tasks yet</p>
            <p style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
              Write any prompt and schedule it — {displayName} will run it automatically and email you.
            </p>
            <p style={{ fontSize: 12, color: '#555', marginBottom: 16 }}>
              Examples:<br/>
              "Send me critical project risks every Monday at 9am"<br/>
              "Email revenue dashboard as PDF on the 1st of every month"<br/>
              "Send daily employee attendance summary at 8am"
            </p>
            <button className="settings-btn" onClick={() => setShowCreate(true)}>Create First Task</button>
          </section>
        ) : (
          <div>
            {tasks.map(task => (
              <section className="settings-section" key={task.id} style={{ borderColor: task.isActive ? 'var(--border)' : 'rgba(255,255,255,0.05)', opacity: task.isActive ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: 14 }}>{task.title}</h3>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: task.isActive ? 'rgba(74,222,128,0.15)' : 'rgba(255,255,255,0.05)', color: task.isActive ? '#4ade80' : '#666' }}>
                        {task.isActive ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: '#aaa', margin: '4px 0', fontStyle: 'italic' }}>"{task.prompt}"</p>
                    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: '#666', marginTop: 6, flexWrap: 'wrap' }}>
                      <span>Runs: {describeCron(task.cronExpression)}</span>
                      {task.lastRunAt && <span>Last: {timeAgo(task.lastRunAt)}</span>}
                      <span>Emails: {task.notifySelf ? 'me' : ''}{task.notifyEmail ? (task.notifySelf ? ' + ' : '') + task.notifyEmail : ''}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className="admin-action" onClick={() => runNow(task.id)} disabled={running === task.id} style={{ borderColor: '#4ade80', color: '#4ade80' }}>
                      {running === task.id ? '...' : 'Run'}
                    </button>
                    <button className="admin-action" onClick={() => { setEditingTask(task); setShowCreate(false); }}>Edit</button>
                    <button className="admin-action" onClick={() => toggleTask(task)} style={{ borderColor: task.isActive ? '#f59e0b' : '#4ade80', color: task.isActive ? '#f59e0b' : '#4ade80' }}>
                      {task.isActive ? 'Pause' : 'Resume'}
                    </button>
                    {confirmDeleteId === task.id ? (
                      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                        <button className="admin-action" onClick={() => deleteTask(task.id)} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Yes</button>
                        <button className="admin-action" onClick={() => setConfirmDeleteId(null)}>No</button>
                      </span>
                    ) : (
                      <button className="admin-action" onClick={() => setConfirmDeleteId(task.id)} style={{ borderColor: '#ef4444', color: '#ef4444' }}>Del</button>
                    )}
                  </div>
                </div>

                {task.lastError && (
                  <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '6px 10px', marginTop: 8, fontSize: 11, color: '#ef4444' }}>
                    Error: {task.lastError}
                  </div>
                )}

                {task.lastResult && (
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer' }}>View last result</summary>
                    <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 12, marginTop: 6, fontSize: 12, color: '#bbb', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {task.lastResult}
                    </div>
                  </details>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskForm({ task, userEmail, onSave, onCancel, onMsg }) {
  const [prompt, setPrompt] = useState(task?.prompt || '');
  const [title, setTitle] = useState(task?.title || '');
  const [interval, setInterval] = useState('daily');
  const [time, setTime] = useState('09:00');
  const [dayOfWeek, setDayOfWeek] = useState('Monday');
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [notifyEmail, setNotifyEmail] = useState(task?.notifyEmail || '');
  const [notifySelf, setNotifySelf] = useState(task?.notifySelf ?? true);
  const [saving, setSaving] = useState(false);

  // Parse existing cron if editing
  useEffect(() => {
    if (task?.cronExpression) {
      const parts = task.cronExpression.split(' ');
      if (parts.length === 5) {
        const [m, h, dom, , dow] = parts;
        setTime(`${h.padStart(2, '0')}:${m.padStart(2, '0')}`);
        if (h === '*') setInterval('hourly');
        else if (dow !== '*') { setInterval('weekly'); setDayOfWeek(DAY_OPTIONS[parseInt(dow) - 1] || 'Monday'); }
        else if (dom !== '*') { setInterval('monthly'); setDayOfMonth(parseInt(dom) || 1); }
        else setInterval('daily');
      }
    }
  }, [task]);

  // Auto-generate title from prompt
  useEffect(() => {
    if (!title && prompt.length > 10) {
      setTitle(prompt.slice(0, 50).replace(/[^\w\s]/g, '').trim());
    }
  }, [prompt]);

  const save = async () => {
    if (!prompt) { onMsg('Write a prompt'); return; }
    const cronExpression = buildCron(interval, time, dayOfWeek, dayOfMonth);
    const finalTitle = title || prompt.slice(0, 50);
    setSaving(true);
    try {
      if (task?.id) {
        await api.patch(`/schedules/${task.id}`, { title: finalTitle, prompt, cronExpression, notifyEmail, notifySelf });
      } else {
        await api.post('/schedules', { title: finalTitle, prompt, cronExpression, notifyEmail, notifySelf });
      }
      onSave();
    } catch (err) {
      onMsg(err.response?.data?.error || 'Failed to save');
    }
    setSaving(false);
  };

  const inputStyle = { width: '100%', padding: '8px 12px', fontSize: 13, background: '#2a2a2a', border: '1px solid #444', borderRadius: 8, color: '#eee', fontFamily: 'inherit' };

  return (
    <section className="settings-section" style={{ borderColor: 'var(--accent)' }}>
      <h3 style={{ color: 'var(--accent)', margin: '0 0 14px' }}>{task ? 'Edit Task' : 'New Scheduled Task'}</h3>

      {/* Prompt */}
      <div className="settings-field">
        <label>Your Prompt</label>
        <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="Write exactly what you'd type in chat. Examples:
• Send me all projects with critical risks and their details
• Generate sales revenue dashboard and email as PDF
• List employees who haven't submitted timesheets this month" />
      </div>

      {/* Title (auto-filled) */}
      <div className="settings-field">
        <label>Task Name <span style={{ color: '#666', fontWeight: 400 }}>(auto-filled from prompt)</span></label>
        <input style={inputStyle} value={title} onChange={e => setTitle(e.target.value)} placeholder="Auto-generated from your prompt" />
      </div>

      {/* Schedule */}
      <div className="settings-field">
        <label>Run Every</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {INTERVAL_OPTIONS.map(opt => (
            <button key={opt.value} className={`filter-btn ${interval === opt.value ? 'active' : ''}`}
              style={{ fontSize: 12, padding: '5px 12px' }}
              onClick={() => setInterval(opt.value)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {interval !== 'hourly' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div className="settings-field" style={{ flex: 1 }}>
            <label>At Time</label>
            <input type="time" style={inputStyle} value={time} onChange={e => setTime(e.target.value)} />
          </div>
          {interval === 'weekly' && (
            <div className="settings-field" style={{ flex: 1 }}>
              <label>On Day</label>
              <select style={inputStyle} value={dayOfWeek} onChange={e => setDayOfWeek(e.target.value)}>
                {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {interval === 'monthly' && (
            <div className="settings-field" style={{ flex: 1 }}>
              <label>On Date</label>
              <select style={inputStyle} value={dayOfMonth} onChange={e => setDayOfMonth(parseInt(e.target.value))}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      <p style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
        Schedule: <strong style={{ color: '#aaa' }}>{describeCron(buildCron(interval, time, dayOfWeek, dayOfMonth))}</strong>
      </p>

      {/* Email */}
      <div className="settings-field">
        <label>Email Results To</label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#bbb', marginBottom: 6 }}>
          <input type="checkbox" checked={notifySelf} onChange={e => setNotifySelf(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
          My email ({userEmail})
        </label>
        <input style={inputStyle} value={notifyEmail} onChange={e => setNotifyEmail(e.target.value)}
          placeholder="Additional: ahmed@company.com, boss@company.com" />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button className="settings-btn" onClick={onCancel} style={{ flex: 1, background: '#333' }}>Cancel</button>
        <button className="settings-btn" onClick={save} disabled={saving} style={{ flex: 1 }}>
          {saving ? 'Saving...' : task ? 'Update Task' : 'Schedule Task'}
        </button>
      </div>
    </section>
  );
}

function describeCron(cron) {
  if (!cron) return 'Not set';
  const parts = cron.split(' ');
  if (parts.length !== 5) return cron;
  const [min, hour, dom, , dow] = parts;

  if (hour === '*') return 'Every hour';
  const t = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (dom !== '*') return `Monthly on the ${dom}${dom === '1' ? 'st' : dom === '2' ? 'nd' : dom === '3' ? 'rd' : 'th'} at ${t}`;
  if (dow !== '*') {
    const dayName = DAY_OPTIONS[parseInt(dow) - 1] || dow;
    return `Every ${dayName} at ${t}`;
  }
  return `Daily at ${t}`;
}

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
