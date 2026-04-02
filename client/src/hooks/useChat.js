import { useState, useCallback, useRef } from 'react';
import { streamChat } from '../services/chatApi';
import api from '../services/api';

export default function useChat() {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('gemini-flash');
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [clarification, setClarification] = useState(null); // { query, options }
  const [sources, setSources] = useState(['org']); // Phase 3.3: active data sources
  const doneCalledRef = useRef(false);
  const abortRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await api.get('/conversations');
      setConversations(res.data.conversations || []);
    } catch {}
  }, []);

  const loadConversation = useCallback(async (id) => {
    try {
      const res = await api.get(`/conversations/${id}`);
      const conv = res.data.conversation;
      if (conv) {
        setConversationId(conv.id);
        setMessages(conv.messages.map(m => ({
          role: m.role,
          content: m.content,
          provider: m.provider,
          meta: m.inputTokens ? { inputTokens: m.inputTokens, outputTokens: m.outputTokens } : undefined,
        })));
        if (conv.provider) setSelectedProvider(conv.provider);
      }
    } catch {}
  }, []);

  // Stop current generation
  const stopGenerating = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    setStatusText('');
    // Mark last assistant message as stopped
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role === 'assistant' && last.content) {
        updated[updated.length - 1] = { ...last, stopped: true };
      }
      return updated;
    });
  }, []);

  // Dismiss clarification
  const dismissClarification = useCallback(() => setClarification(null), []);

  // Clarification disabled — BigQuery provides targeted retrieval, AI answers directly
  const checkClarification = useCallback((text) => {
    return null; // disabled — let AI decide the format

    // Skip clarification for conversational, short, or specific queries
    if (lower.length < 8) return null;
    if (/^(hi|hello|hey|thanks|bye|who are|how are|what can|do you|remember|my |i am|i'm|i live|i have|i want to call)/i.test(lower)) return null;
    if (lower.includes('dashboard') || lower.includes('chart') || lower.includes('summary') || lower.includes('list all') || lower.includes('compare')) return null;
    // Skip if query is specific (year, number, superlative, question word, follow-up)
    if (/\b(20\d{2}|highest|lowest|top \d|bottom|how many|which|who|what is|where|when|specific|particular|detail|total|count|average|last|first|recent|current|open|critical|behind|ahead)\b/i.test(lower)) return null;
    // Skip if query mentions a specific person/entity (2+ capitalized words in original text)
    if (/[A-Z][a-z]+\s+[A-Z][a-z]/.test(text)) return null;
    // Skip if follow-up or drill-down
    if (/\b(follow up|drill|more about|details on|tell me about|analyze|explain|insights)\b/i.test(lower)) return null;

    // Detect broad data queries that could go multiple ways
    const patterns = [
      { match: /^(show|give|provide|tell).*(project|projects)/i, options: [
        { label: 'Quick summary', query: 'give me a brief project status summary' },
        { label: 'Interactive dashboard', query: 'show project status as interactive dashboard with charts' },
        { label: 'Detailed report', query: 'provide detailed project status report for all projects' },
      ]},
      { match: /^(show|give|provide|tell).*(sales|revenue|deal)/i, options: [
        { label: 'Revenue overview', query: 'give me a brief revenue summary' },
        { label: 'Sales dashboard', query: 'show sales dashboard with charts' },
        { label: 'Top clients', query: 'show top clients by revenue' },
      ]},
      { match: /^(show|give|provide|tell).*(team|employee|people|staff|hr)/i, options: [
        { label: 'Org chart', query: 'show organizational hierarchy chart' },
        { label: 'Team list', query: 'list all team members with departments' },
        { label: 'Department summary', query: 'show department-wise headcount summary' },
      ]},
      { match: /^(show|give|provide|tell).*(client|account|customer)/i, options: [
        { label: 'Client overview', query: 'give me client portfolio overview' },
        { label: 'Top accounts', query: 'show top accounts by revenue' },
        { label: 'Client dashboard', query: 'show client dashboard with charts' },
      ]},
      { match: /^(show|give|provide|tell).*(risk|issue|problem)/i, options: [
        { label: 'Risk summary', query: 'summarize all critical and high risks' },
        { label: 'Risk dashboard', query: 'show risk dashboard with charts' },
        { label: 'At-risk projects', query: 'which projects have critical risks?' },
      ]},
    ];

    for (const p of patterns) {
      if (p.match.test(lower)) {
        return { query: text, options: [...p.options, { label: 'Just answer directly', query: text }] };
      }
    }
    return null;
  }, []);

  // Actual send logic (extracted so clarification can call it)
  const actualSend = useCallback(async (text) => {
    if (!text.trim()) return;

    // If currently streaming, stop it first (redirect)
    if (isStreaming && abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      // Keep partial response
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, stopped: true };
        }
        return updated;
      });
    }

    const userMsg = { role: 'user', content: text.trim() };
    const assistantMsg = { role: 'assistant', content: '', provider: selectedProvider };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);
    setStatusText('');
    doneCalledRef.current = false;

    // Create abort controller for this request
    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(
      text.trim(),
      selectedProvider,
      (chunk) => {
        if (controller.signal.aborted) return;
        setStatusText('');
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content + chunk };
          return updated;
        });
      },
      () => {
        if (controller.signal.aborted) return;
        if (!doneCalledRef.current) {
          doneCalledRef.current = true;
          setIsStreaming(false);
          setStatusText('');
          abortRef.current = null;
          loadConversations();
        }
      },
      (err) => {
        if (controller.signal.aborted) return;
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, content: last.content || `Error: ${err}` };
          return updated;
        });
        setIsStreaming(false);
        setStatusText('');
        abortRef.current = null;
      },
      (meta) => {
        if (controller.signal.aborted) return;
        if (meta.conversationId && !conversationId) {
          setConversationId(meta.conversationId);
        }
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, meta };
          return updated;
        });
      },
      (status) => {
        if (controller.signal.aborted) return;
        setStatusText(status);
      },
      conversationId,
      controller.signal,
      (widgetData) => {
        if (controller.signal.aborted) return;
        // Attach widget data to the current assistant message
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, widgetData };
          return updated;
        });
      },
      sources.length > 0 ? sources : undefined,
    );
  }, [isStreaming, selectedProvider, conversationId, loadConversations, sources]);

  // Send with clarification — user picked an option
  const sendWithClarification = useCallback((selectedQuery) => {
    setClarification(null);
    actualSend(selectedQuery);
  }, [actualSend]);

  // Public sendMessage — checks clarification before sending
  const sendMessage = useCallback((text) => {
    if (!text.trim()) return;
    setClarification(null);

    const clarify = checkClarification(text);
    if (clarify) {
      // Show user's message in chat, then show clarification chips below
      setMessages(prev => [...prev, { role: 'user', content: text }]);
      setClarification(clarify);
      return;
    }

    actualSend(text);
  }, [checkClarification, actualSend]);

  const newChat = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setMessages([]);
    setConversationId(null);
    setIsStreaming(false);
    setStatusText('');
  }, []);

  const archiveConversation = useCallback(async (id) => {
    try {
      await api.delete(`/conversations/${id}`);
      if (conversationId === id) newChat();
      loadConversations();
    } catch {}
  }, [conversationId, newChat, loadConversations]);

  return {
    messages, isStreaming, statusText,
    selectedProvider, setSelectedProvider,
    sendMessage, stopGenerating, newChat,
    clarification, sendWithClarification, dismissClarification,
    conversationId, conversations,
    loadConversations, loadConversation, archiveConversation,
    sources, setSources,
  };
}
