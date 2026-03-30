import { useEffect, useState } from 'react';

function timeAgo(date) {
  const now = new Date();
  const diff = now - new Date(date);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function groupConversations(conversations) {
  const groups = { today: [], yesterday: [], week: [], older: [] };
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart - 86400000);
  const weekStart = new Date(todayStart - 6 * 86400000);

  for (const conv of conversations) {
    const d = new Date(conv.updatedAt || conv.createdAt);
    if (d >= todayStart) groups.today.push(conv);
    else if (d >= yesterdayStart) groups.yesterday.push(conv);
    else if (d >= weekStart) groups.week.push(conv);
    else groups.older.push(conv);
  }
  return groups;
}

export default function HistorySidebar({ conversations, activeId, onSelect, onNew, onDelete, isOpen, onClose }) {
  const groups = groupConversations(conversations);
  const [hoveredId, setHoveredId] = useState(null);

  const renderGroup = (label, items) => {
    if (items.length === 0) return null;
    return (
      <div className="history-group" key={label}>
        <div className="history-group-label">{label}</div>
        {items.map(conv => (
          <div
            key={conv.id}
            className={`history-item ${conv.id === activeId ? 'active' : ''}`}
            onClick={() => onSelect(conv.id)}
            onMouseEnter={() => setHoveredId(conv.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div className="history-item-title">{conv.title || 'New conversation'}</div>
            <div className="history-item-meta">
              <span>{timeAgo(conv.updatedAt || conv.createdAt)}</span>
              <span>{conv.messageCount} msgs</span>
            </div>
            {hoveredId === conv.id && (
              <button
                className="history-item-delete"
                onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
                title="Delete"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`history-sidebar ${isOpen ? 'open' : ''}`}>
      <div className="history-header">
        <h2>History</h2>
        <div className="history-header-actions">
          <button className="history-new-btn" onClick={onNew} title="New chat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button className="history-close-btn" onClick={onClose} title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>
      <div className="history-list">
        {conversations.length === 0 ? (
          <div className="history-empty">No conversations yet</div>
        ) : (
          <>
            {renderGroup('Today', groups.today)}
            {renderGroup('Yesterday', groups.yesterday)}
            {renderGroup('This Week', groups.week)}
            {renderGroup('Older', groups.older)}
          </>
        )}
      </div>
    </div>
  );
}
