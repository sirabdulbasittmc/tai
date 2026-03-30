import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const MODELS = [
  { id: 'gemini', nameSuffix: 'Deep thinking', sub: 'Best quality · Detailed analysis', dotColor: '#4285f4' },
  { id: 'gemini-flash', nameSuffix: 'Fast thinking', sub: 'Quick answers · Fast response', dotColor: '#34a853' },
];

export default function ModelSelector({ selected, onChange }) {
  const { appName, aiName } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const prefix = aiName || appName || 'AI';
  const models = MODELS.map(m => ({ ...m, name: `${prefix} ${m.nameSuffix}` }));
  const current = models.find(m => m.id === selected) || models[0];

  return (
    <div className="model-selector-wrap" ref={wrapRef}>
      <button className="model-selector-btn" onClick={() => setOpen(!open)}>
        <div className="model-dot" style={{ background: current.dotColor }} />
        <span>{current.name}</span>
        <svg className={`model-chevron${open ? ' open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div className={`model-dropdown${open ? ' open' : ''}`}>
        {models.map((model, i) => (
          <div key={model.id}>
            {i > 0 && <div className="model-divider" />}
            <button
              className={`model-option${selected === model.id ? ' selected' : ''}`}
              onClick={() => { onChange(model.id); setOpen(false); }}
            >
              <div className="model-dot" style={{ background: model.dotColor }} />
              <div className="model-option-info">
                <div className="model-option-name">{model.name}</div>
                <div className="model-option-sub">{model.sub}</div>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
