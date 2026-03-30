import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';

const PROVIDER_LABELS = {
  gemini: 'Brain Deep',
  'gemini-flash': 'Brain Fast',
  groq: 'Groq (Llama 4)',
  openrouter: 'OpenRouter',
  claude: 'Claude Sonnet 4',
  openai: 'GPT-4o',
};

// Estimated total time per status stage (seconds from start)
// Used to show "~Xs remaining" to keep user engaged
const STAGE_ESTIMATES = {
  'Understanding your question': { at: 1, total: 12 },
  'Analyzing query': { at: 2, total: 12 },
  'Searching data': { at: 3, total: 12 },
  'Performing semantic search': { at: 4, total: 12 },
  'Ranking results': { at: 5, total: 12 },
  'Applying privacy filters': { at: 7, total: 12 },
  'Found': { at: 8, total: 15 },
  'Generating response': { at: 10, total: 20 },
  'Analyzing data patterns': { at: 12, total: 20 },
  'Cross-referencing': { at: 14, total: 22 },
  'Structuring response': { at: 16, total: 22 },
  'Formatting output': { at: 18, total: 24 },
  'Finalizing': { at: 20, total: 25 },
};

function getEstimate(statusText, elapsed) {
  if (!statusText) return null;
  for (const [key, est] of Object.entries(STAGE_ESTIMATES)) {
    if (statusText.startsWith(key)) {
      const remaining = Math.max(est.total - elapsed, 1);
      return remaining;
    }
  }
  return null;
}

export default function ThinkingIndicator({ provider, statusText }) {
  const { appName, aiName, logoUrl } = useAuth();
  const displayName = aiName || appName || 'AI';
  const label = PROVIDER_LABELS[provider] || 'AI';
  const [seconds, setSeconds] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    setSeconds(0);
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (s) => {
    if (s < 60) return `${s}s`;
    const min = Math.floor(s / 60);
    const sec = s % 60;
    return `${min}m ${sec}s`;
  };

  const estimate = getEstimate(statusText, seconds);

  return (
    <div className="thinking-row">
      <div className="thinking-inner">
        <div className="msg-avatar assistant thinking-avatar">
          <img src={logoUrl} alt="TMC" className="avatar-logo" />
        </div>
        <div className="thinking-content">
          <div className="thinking-text">
            <div className="thinking-dots">
              <span></span><span></span><span></span>
            </div>
            {displayName} ({label}) is thinking&hellip;
            <span className="thinking-timer">{formatTime(seconds)}</span>
          </div>
          {statusText && (
            <div className="thinking-status">
              {statusText}
              {estimate && (
                <span className="thinking-eta"> &middot; ~{estimate}s remaining</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
