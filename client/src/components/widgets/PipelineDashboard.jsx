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
  sectionLabel: { fontSize: 13, color: '#888', marginTop: 16, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
};

function formatPKR(val) {
  if (val == null) return '—';
  const n = Number(val);
  if (n >= 1e6) return `PKR ${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `PKR ${(n / 1e3).toFixed(0)}K`;
  return `PKR ${n.toLocaleString()}`;
}

function formatUSD(val) {
  if (val == null) return '—';
  const n = Number(val);
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

export default function PipelineDashboard({ data }) {
  const [stageFilter, setStageFilter] = useState('All');
  const [currency, setCurrency] = useState('PKR');

  const summary = data?.summary || {};
  const byStage = data?.by_stage || [];
  const opportunities = data?.opportunities || [];

  const stages = useMemo(() => ['All', ...new Set(byStage.map(s => s.stage).filter(Boolean))], [byStage]);

  const filtered = useMemo(() => {
    if (stageFilter === 'All') return opportunities;
    return opportunities.filter(o => o.stage === stageFilter);
  }, [opportunities, stageFilter]);

  const fmt = currency === 'PKR' ? formatPKR : formatUSD;
  const totalValue = currency === 'PKR' ? summary.total_value_pkr : summary.total_value_usd;

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Pipeline Dashboard</h2>

      <div style={styles.cardGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_opportunities ?? '—'}</div>
          <div style={styles.statLabel}>Opportunities</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{fmt(totalValue)}</div>
          <div style={styles.statLabel}>Total Value</div>
        </div>
        {summary.avg_probability != null && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>{summary.avg_probability}%</div>
            <div style={styles.statLabel}>Avg Probability</div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={styles.filterBar}>
        <button
          style={currency === 'PKR' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setCurrency('PKR')}
        >PKR</button>
        <button
          style={currency === 'USD' ? styles.filterBtnActive : styles.filterBtn}
          onClick={() => setCurrency('USD')}
        >USD</button>
        <span style={{ color: '#555', margin: '0 4px' }}>|</span>
        {stages.map(s => (
          <button
            key={s}
            style={stageFilter === s ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setStageFilter(s)}
          >{s}</button>
        ))}
      </div>

      {/* Pipeline by Stage */}
      {byStage.length > 0 && (
        <>
          <div style={styles.sectionLabel}>By Stage</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Stage</th>
                <th style={styles.th}>Count</th>
                <th style={styles.th}>Value (PKR)</th>
              </tr>
            </thead>
            <tbody>
              {byStage.map((row, i) => (
                <tr key={row.stage}>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.stage}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.count}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{formatPKR(row.value_pkr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Opportunities Table */}
      <div style={styles.sectionLabel}>Opportunities</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Stage</th>
              <th style={styles.th}>Value</th>
              <th style={styles.th}>Probability</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Expected Close</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o, i) => {
              const tdStyle = i % 2 === 1 ? styles.tdEven : styles.td;
              const valKey = currency === 'PKR' ? 'value_pkr' : 'value_usd';
              return (
                <tr key={o.opp_id || i}>
                  <td style={tdStyle}>{o.name}</td>
                  <td style={tdStyle}>{o.account}</td>
                  <td style={tdStyle}>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, background: 'rgba(204,107,74,0.15)', color: '#cc6b4a' }}>
                      {o.stage}
                    </span>
                  </td>
                  <td style={tdStyle}>{fmt(o[valKey])}</td>
                  <td style={tdStyle}>
                    <span style={{ color: o.probability >= 70 ? '#4ade80' : o.probability >= 40 ? '#f59e0b' : '#ef4444' }}>
                      {o.probability}%
                    </span>
                  </td>
                  <td style={tdStyle}>{o.owner}</td>
                  <td style={tdStyle}>{o.expected_close}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td style={{ ...styles.td, textAlign: 'center' }} colSpan={7}>No opportunities found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
