export async function streamChat(message, provider, onChunk, onDone, onError, onMeta, onStatus, conversationId, abortSignal, onWidgetData) {
  try {
    const body = { message, provider };
    if (conversationId) body.conversationId = conversationId;

    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: abortSignal,
    });

    if (!response.ok) {
      let errMsg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        errMsg = err.error || errMsg;
      } catch {
        const text = await response.text().catch(() => '');
        errMsg = text || errMsg;
      }
      throw new Error(errMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'status' && onStatus) onStatus(data.content);
            else if (data.type === 'chunk') onChunk(data.content);
            else if (data.type === 'widget_data' && onWidgetData) onWidgetData(data.widget);
            else if (data.type === 'meta' && onMeta) onMeta(data);
            else if (data.type === 'done') onDone();
            else if (data.type === 'error') onError(data.content);
          } catch {
            // skip malformed SSE lines
          }
        }
      }
    }

    onDone();
  } catch (err) {
    if (err.name === 'AbortError') return; // User cancelled — silent
    onError(err.message || 'Connection failed');
  }
}
