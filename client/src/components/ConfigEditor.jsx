import { useState, useEffect } from 'react';
import api from '../services/api';

const BOOLEAN_KEYS = ['rag_enabled', 'pii_enabled', 'smtp_secure', 'password_require_uppercase', 'password_require_number', 'password_require_special'];
const SENSITIVE_KEYS = [
  'gemini_api_key', 'anthropic_api_key', 'openai_api_key',
  'groq_api_key', 'openrouter_api_key', 'google_client_secret',
  'smtp_pass', 'encryption_key',
];
const MASKED = '********';

export default function ConfigEditor({ sections, apiPath, clientNumber }) {
  const [configs, setConfigs] = useState([]);
  const [editValues, setEditValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const queryParam = clientNumber ? `?client=${clientNumber}` : '';

  useEffect(() => { loadConfigs(); }, [clientNumber]);

  const loadConfigs = async () => {
    try {
      const res = await api.get(`${apiPath}${queryParam}`);
      setConfigs(res.data.configs || []);
      const vals = {};
      for (const c of res.data.configs || []) vals[c.key] = c.value;
      setEditValues(vals);
    } catch {
      setMsg('Failed to load configuration');
    }
  };

  const handleChange = (key, value) => {
    setEditValues(prev => ({ ...prev, [key]: value }));
  };

  const saveAll = async () => {
    setSaving(true);
    setMsg('');
    try {
      const sectionKeys = new Set(sections.flatMap(s => s.keys));
      const entries = Object.entries(editValues)
        .filter(([key]) => sectionKeys.has(key))
        .map(([key, value]) => ({ key, value, isSensitive: SENSITIVE_KEYS.includes(key) }));
      await api.put(`${apiPath}${queryParam}`, { configs: entries });
      setMsg('Configuration saved');
      loadConfigs();
    } catch (err) {
      setMsg('Failed to save: ' + (err.response?.data?.error || err.message));
    }
    setSaving(false);
  };

  const configMap = {};
  for (const c of configs) configMap[c.key] = c;

  return (
    <>
      {msg && <div className={`settings-msg ${msg.includes('Failed') ? 'error' : ''}`}>{msg}</div>}

      {sections.map(section => (
        <section className="settings-section" key={section.title}>
          <h2>{section.icon} {section.title}</h2>
          {section.keys.map(key => {
            const val = editValues[key] ?? '';
            const isSensitive = SENSITIVE_KEYS.includes(key);
            const isBoolean = BOOLEAN_KEYS.includes(key);
            const desc = configMap[key]?.description;

            return (
              <div className="config-row" key={key}>
                <div className="config-key">
                  <span>{key}</span>
                  {isSensitive && <span className="config-badge sensitive">encrypted</span>}
                  {desc && <span className="config-desc">{desc}</span>}
                </div>
                <div className="config-value">
                  {isBoolean ? (
                    <div className={`config-toggle ${val === 'true' ? 'on' : ''}`} onClick={() => handleChange(key, val === 'true' ? 'false' : 'true')}>
                      <div className="config-toggle-knob" />
                      <span>{val === 'true' ? 'Enabled' : 'Disabled'}</span>
                    </div>
                  ) : (
                    <input type={isSensitive ? 'password' : 'text'} value={val} onChange={e => handleChange(key, e.target.value)} placeholder={isSensitive ? '••••••••' : `Enter ${key}`} />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <div className="config-save-bar">
        <button className="settings-btn" onClick={saveAll} disabled={saving} style={{ width: '100%', padding: 14 }}>
          {saving ? 'Saving...' : 'Save All Changes'}
        </button>
      </div>
    </>
  );
}
