import { useState, useRef, useEffect } from 'react';
import ModelSelector from './ModelSelector';
import { useAuth } from '../context/AuthContext';

export default function ChatInput({ onSend, onStop, isStreaming, isFrozen, selectedProvider, onProviderChange }) {
  const { appName, aiName } = useAuth();
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => { setTimeout(() => textareaRef.current?.focus(), 100); }, []);
  useEffect(() => { if (!isStreaming) textareaRef.current?.focus(); }, [isStreaming]);
  useEffect(() => { if (!isFrozen) setTimeout(() => textareaRef.current?.focus(), 100); }, [isFrozen]);

  function handleInput(e) {
    setText(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSend() {
    if (!text.trim()) return;
    // If streaming, sendMessage in useChat handles stop+redirect
    onSend(text.trim());
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  const hasText = text.trim().length > 0;

  return (
    <div className="input-area">
      <div className="input-box">
        <textarea
          ref={textareaRef}
          className="input-textarea"
          placeholder={isFrozen ? 'Just a moment...' : isStreaming ? 'Type to redirect AI...' : 'How can I help you today?'}
          disabled={isFrozen}
          rows="1"
          value={text}
          onChange={handleInput}
          onKeyDown={handleKey}
        />
        <div className="input-bottom">
          <div className="input-right">
            {isStreaming && (
              <button className="stop-btn" onClick={onStop} title="Stop generating">
                <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                Stop
              </button>
            )}
            <ModelSelector selected={selectedProvider} onChange={onProviderChange} />
            <button
              className={`send-btn${hasText ? ' active' : ''}`}
              onClick={handleSend}
              disabled={isFrozen || !hasText}
              title={isStreaming ? 'Send (stops current response)' : 'Send'}
            >
              <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="input-footer">{aiName || appName || 'AI Intelligence'} &middot; Searches your live Drive data on every message</div>
    </div>
  );
}
