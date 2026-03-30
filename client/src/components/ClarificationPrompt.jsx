import { useAuth } from '../context/AuthContext';

export default function ClarificationPrompt({ clarification, onSelect }) {
  const { appName, aiName, logoUrl } = useAuth();
  const displayName = aiName || appName || 'AI Intelligence';

  if (!clarification) return null;

  return (
    <div className="message-row">
      <div className="message-inner">
        <div className="msg-avatar assistant">
          <img src={logoUrl} alt="" className="avatar-logo" />
        </div>
        <div className="msg-body">
          <div className="msg-name">{displayName}</div>
          <div className="msg-text">
            <p className="clarify-text">How would you like to see this?</p>
            <div className="clarify-chips">
              {clarification.options.map((opt, i) => (
                <button key={i} className="clarify-chip" onClick={() => onSelect(opt.query)}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
