import { useState, useMemo } from 'react';

const styles = {
  container: { fontFamily: "'Inter', -apple-system, sans-serif", background: '#1e1e1e', color: '#e8e8e0', padding: 16, fontSize: 14, lineHeight: 1.6 },
  h2: { fontSize: 18, fontWeight: 500, color: '#eee', margin: '0 0 12px' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '10px 0' },
  statCard: { background: 'linear-gradient(135deg, #252525, #1e1e1e)', border: '1px solid #333', borderRadius: 12, padding: 16, textAlign: 'center' },
  statValue: { fontSize: 26, fontWeight: 700, color: '#cc6b4a', letterSpacing: -0.5 },
  statLabel: { fontSize: 11, color: '#888', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterBar: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0', alignItems: 'center' },
  filterBtn: { padding: '5px 12px', borderRadius: 16, border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  filterBtnActive: { padding: '5px 12px', borderRadius: 16, border: '1px solid #cc6b4a', background: '#cc6b4a', color: '#fff', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  table: { width: '100%', borderCollapse: 'collapse', margin: '10px 0', fontSize: 13 },
  th: { background: '#2a2a2a', color: '#e8e8e0', textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #cc6b4a', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { padding: '8px 12px', borderBottom: '1px solid #2a2a2a', color: '#bbb' },
  tdEven: { padding: '8px 12px', borderBottom: '1px solid #2a2a2a', color: '#bbb', background: '#1a1a1a' },
};

const severityColors = {
  Critical: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  High: { background: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  Medium: { background: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  Low: { background: 'rgba(74,222,128,0.15)', color: '#4ade80' },
};

function SeverityBadge({ severity }) {
  const c = severityColors[severity] || { background: 'rgba(136,136,136,0.15)', color: '#888' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, ...c }}>
      {severity}
    </span>
  );
}

export default function RiskDashboard({ data }) {
  const [severityFilter, setSeverityFilter] = useState('All');

  const summary = data?.summary || {};
  const risks = data?.risks || [];

  const severities = ['All', 'Critical', 'High', 'Medium', 'Low'];

  const filtered = useMemo(() => {
    if (severityFilter === 'All') return risks;
    return risks.filter(r => r.severity === severityFilter);
  }, [risks, severityFilter]);

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Risk Dashboard</h2>

      <div style={styles.cardGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_risks ?? '—'}</div>
          <div style={styles.statLabel}>Total Risks</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#ef4444' }}>{summary.critical ?? '—'}</div>
          <div style={styles.statLabel}>Critical</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#f59e0b' }}>{summary.high ?? '—'}</div>
          <div style={styles.statLabel}>High</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#3b82f6' }}>{summary.medium ?? '—'}</div>
          <div style={styles.statLabel}>Medium</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statValue, color: '#4ade80' }}>{summary.low ?? '—'}</div>
          <div style={styles.statLabel}>Low</div>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filterBar}>
        {severities.map(s => (
          <button
            key={s}
            style={severityFilter === s ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setSeverityFilter(s)}
          >{s}</button>
        ))}
      </div>

      {/* Risks Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Project</th>
              <th style={styles.th}>Description</th>
              <th style={styles.th}>Severity</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Identified</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const tdStyle = i % 2 === 1 ? styles.tdEven : styles.td;
              return (
                <tr key={r.risk_id || i}>
                  <td style={tdStyle}>{r.risk_id}</td>
                  <td style={tdStyle}>{r.project}{r.project_code ? ` (${r.project_code})` : ''}</td>
                  <td style={{ ...tdStyle, maxWidth: 250 }}>{r.description}</td>
                  <td style={tdStyle}><SeverityBadge severity={r.severity} /></td>
                  <td style={tdStyle}>{r.category}</td>
                  <td style={tdStyle}>{r.owner}</td>
                  <td style={tdStyle}>{r.status}</td>
                  <td style={tdStyle}>{r.date_identified}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td style={{ ...styles.td, textAlign: 'center' }} colSpan={8}>No risks found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
