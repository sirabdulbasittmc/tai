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
  progressBar: { width: '100%', height: 6, background: '#333', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, background: '#cc6b4a' },
};

const riskColors = {
  Critical: { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  High: { background: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  Medium: { background: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
  Low: { background: 'rgba(74,222,128,0.15)', color: '#4ade80' },
};

const statusColors = {
  'On Track': { background: 'rgba(74,222,128,0.15)', color: '#4ade80' },
  'At Risk': { background: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
  'Delayed': { background: 'rgba(239,68,68,0.15)', color: '#ef4444' },
  'Completed': { background: 'rgba(59,130,246,0.15)', color: '#3b82f6' },
};

function Badge({ text, colorMap }) {
  const c = colorMap[text] || { background: 'rgba(136,136,136,0.15)', color: '#888' };
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, ...c }}>
      {text}
    </span>
  );
}

export default function ProjectDashboard({ data }) {
  const [statusFilter, setStatusFilter] = useState('All');
  const [rowLimit, setRowLimit] = useState(10);

  const summary = data?.summary || {};
  const projects = data?.projects || [];

  const statuses = ['All', 'On Track', 'At Risk', 'Delayed', 'Completed'];

  const filtered = useMemo(() => {
    let list = projects;
    if (statusFilter !== 'All') {
      list = list.filter(p => p.status === statusFilter);
    }
    if (rowLimit !== 'All') {
      list = list.slice(0, rowLimit);
    }
    return list;
  }, [projects, statusFilter, rowLimit]);

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Project Dashboard</h2>

      <div style={styles.cardGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_projects ?? '—'}</div>
          <div style={styles.statLabel}>Total Projects</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.on_track ?? '—'}</div>
          <div style={styles.statLabel}>On Track</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.at_risk ?? '—'}</div>
          <div style={styles.statLabel}>At Risk</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.delayed ?? '—'}</div>
          <div style={styles.statLabel}>Delayed</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.completed ?? '—'}</div>
          <div style={styles.statLabel}>Completed</div>
        </div>
        {summary.avg_progress != null && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>{summary.avg_progress}%</div>
            <div style={styles.statLabel}>Avg Progress</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={styles.filterBar}>
        {statuses.map(s => (
          <button
            key={s}
            style={statusFilter === s ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setStatusFilter(s)}
          >{s}</button>
        ))}
        <span style={{ color: '#555', margin: '0 4px' }}>|</span>
        {[10, 20, 'All'].map(n => (
          <button
            key={n}
            style={rowLimit === n ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setRowLimit(n)}
          >{n === 'All' ? 'All' : `Top ${n}`}</button>
        ))}
      </div>

      {/* Projects Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Code</th>
              <th style={styles.th}>Project</th>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Status</th>
              <th style={styles.th}>Progress</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Due Date</th>
              <th style={styles.th}>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const tdStyle = i % 2 === 1 ? styles.tdEven : styles.td;
              return (
                <tr key={p.project_code || i}>
                  <td style={tdStyle}>{p.project_code}</td>
                  <td style={{ ...tdStyle, maxWidth: 200 }}>{p.name}</td>
                  <td style={tdStyle}>{p.account}</td>
                  <td style={tdStyle}><Badge text={p.status} colorMap={statusColors} /></td>
                  <td style={{ ...tdStyle, minWidth: 100 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={styles.progressBar}>
                        <div style={{ ...styles.progressFill, width: `${p.progress || 0}%` }} />
                      </div>
                      <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{p.progress ?? 0}%</span>
                    </div>
                  </td>
                  <td style={tdStyle}>{p.owner}</td>
                  <td style={tdStyle}>{p.due_date}</td>
                  <td style={tdStyle}>
                    {p.risk_flag && <Badge text={p.risk_flag} colorMap={riskColors} />}
                    {p.open_risks > 0 && (
                      <span style={{ fontSize: 11, color: '#888', marginLeft: 4 }}>({p.open_risks})</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td style={{ ...styles.td, textAlign: 'center' }} colSpan={8}>No projects found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
