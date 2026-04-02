import { useState, useEffect } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const PROVIDER_LABELS = {
  gemini: 'Deep',
  'gemini-flash': 'Fast',
  groq: 'Groq (Llama 4)',
  openrouter: 'OpenRouter',
  claude: 'Claude Sonnet 4',
  openai: 'GPT-4o',
};

export default function ChatMessage({ message, isLastAssistant, isStreaming, onFollowUp, onOpenArtifact, previousUserMessage }) {
  const { user, appName, aiName, logoUrl } = useAuth();

  // Auto-open right panel when widget data arrives
  useEffect(() => {
    if (message.widgetData && isLastAssistant && onOpenArtifact) {
      onOpenArtifact('dashboard', null, message.widgetData?.title || 'Dashboard', message.widgetData);
    }
  }, [message.widgetData]);
  const displayName = aiName || appName || 'AI Intelligence';
  const userInitial = user?.name?.charAt(0)?.toUpperCase() || 'U';
  const userName = user?.name?.split(' ')[0] || 'You';

  if (message.role === 'user') {
    return (
      <div className="message-row">
        <div className="message-inner">
          <div className="msg-avatar user">{userInitial}</div>
          <div className="msg-body">
            <div className="msg-name">{userName}</div>
            <div className="msg-text">
              {message.content.split('\n').map((line, i) => (
                <span key={i}>{line}{i < message.content.split('\n').length - 1 && <br />}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const providerLabel = PROVIDER_LABELS[message.provider] || 'AI';
  const showCursor = isLastAssistant && isStreaming;
  const hasContent = message.content && message.content.length > 10;

  return (
    <div className="message-row">
      <div className="message-inner">
        <div className="msg-avatar assistant"><img src={logoUrl} alt="" className="avatar-logo" /></div>
        <div className="msg-body">
          <div className="msg-name">
            {displayName} <span>via {providerLabel}</span>
          </div>
          <MarkdownRenderer content={message.content} isStreaming={showCursor} onFollowUp={onFollowUp} onOpenArtifact={onOpenArtifact} />
          {message.widgetData && (
            <button
              className="open-dashboard-btn"
              onClick={() => onOpenArtifact?.('dashboard', null, message.widgetData?.title || 'Dashboard', message.widgetData)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              {message.widgetData?.title || 'Open Dashboard'}
            </button>
          )}
          {message.meta && (
            <div className="msg-meta-row">
              <div className="msg-meta">
                {message.meta.elapsed}s &middot; ~{message.meta.outputTokens} output tokens &middot; ~{message.meta.totalTokens} total tokens
                {message.meta.dataLastUpdated && (
                  <> &middot; Updated as of {new Date(message.meta.dataLastUpdated).toLocaleString()}</>
                )}
              </div>
              {hasContent && !isStreaming && (
                <FeedbackButtons query={previousUserMessage} response={message.content} conversationId={message.meta?.conversationId} />
              )}
            </div>
          )}
          {message.stopped && <div className="msg-stopped">Response stopped</div>}
        </div>
      </div>
    </div>
  );
}

function FeedbackButtons({ query, response, conversationId }) {
  const [voted, setVoted] = useState(null);

  const vote = async (rating) => {
    setVoted(rating);
    api.post('/chat/feedback', {
      rating,
      query: query || '',
      responsePreview: (response || '').slice(0, 300),
      conversationId,
    }).catch(() => {});
  };

  return (
    <div className="feedback-btns">
      <button
        className={`feedback-btn ${voted === 'up' ? 'voted-up' : ''}`}
        onClick={() => vote('up')}
        disabled={voted !== null}
        title="Good response"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14zM7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" /></svg>
      </button>
      <button
        className={`feedback-btn ${voted === 'down' ? 'voted-down' : ''}`}
        onClick={() => vote('down')}
        disabled={voted !== null}
        title="Bad response"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10zM17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" /></svg>
      </button>
    </div>
  );
}
