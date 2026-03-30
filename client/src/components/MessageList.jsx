import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import WelcomeScreen from './WelcomeScreen';
import ThinkingIndicator from './ThinkingIndicator';
import ClarificationPrompt from './ClarificationPrompt';

export default function MessageList({ messages, isStreaming, statusText, selectedProvider, onFollowUp, onWelcomeAction, onWelcomeLoaded, clarification, onClarificationSelect, onOpenArtifact }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  })();

  // Find the user message before each assistant message
  const getPreviousUserMessage = (index) => {
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === 'user') return messages[i].content;
    }
    return '';
  };

  return (
    <div className="messages-container">
      {messages.length === 0 ? (
        <WelcomeScreen onAction={onWelcomeAction} onLoadingChange={(loading) => { if (!loading) onWelcomeLoaded?.(); }} />
      ) : (
        messages.map((msg, i) => {
          const isEmptyAssistant = msg.role === 'assistant' && msg.content === '' && isStreaming;
          if (isEmptyAssistant) return null;
          return (
            <ChatMessage
              key={i}
              message={msg}
              isLastAssistant={i === lastAssistantIdx}
              isStreaming={isStreaming}
              onFollowUp={onFollowUp}
              onOpenArtifact={onOpenArtifact}
              previousUserMessage={msg.role === 'assistant' ? getPreviousUserMessage(i) : ''}
            />
          );
        })
      )}
      {clarification && (
        <ClarificationPrompt clarification={clarification} onSelect={onClarificationSelect} />
      )}
      {isStreaming && messages[messages.length - 1]?.content === '' && (
        <ThinkingIndicator provider={selectedProvider} statusText={statusText} />
      )}
      <div className="messages-end" ref={endRef} />
    </div>
  );
}
