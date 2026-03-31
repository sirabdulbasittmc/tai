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

export default function SalesDashboard({ data }) {
  console.log('[SalesDashboard] Received data:', JSON.stringify(data, null, 2).slice(0, 500));
  const [currency, setCurrency] = useState('PKR');
  const [techFilter, setTechFilter] = useState('All');
  const [rowLimit, setRowLimit] = useState(10);

  const summary = data?.summary || {};
  const byTech = data?.by_tech || [];
  const byYear = data?.by_year || [];
  const byOwner = data?.by_owner || [];
  const topDeals = data?.top_deals || [];

  const techs = useMemo(() => ['All', ...new Set(byTech.map(t => t.tech).filter(Boolean))], [byTech]);

  const filteredDeals = useMemo(() => {
    let deals = topDeals;
    if (techFilter !== 'All') {
      deals = deals.filter(d => d.tech === techFilter);
    }
    if (rowLimit !== 'All') {
      deals = deals.slice(0, rowLimit);
    }
    return deals;
  }, [topDeals, techFilter, rowLimit]);

  const fmt = currency === 'PKR' ? formatPKR : formatUSD;
  const revenueKey = currency === 'PKR' ? 'revenue_pkr' : 'revenue_usd';
  const totalRevenue = currency === 'PKR' ? summary.total_revenue_pkr : summary.total_revenue_usd;
  const avgDeal = currency === 'PKR' ? summary.avg_deal_size_pkr : null;

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Sales Dashboard</h2>

      {/* Stat Cards */}
      <div style={styles.cardGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{fmt(totalRevenue)}</div>
          <div style={styles.statLabel}>Total Revenue</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_deals ?? '—'}</div>
          <div style={styles.statLabel}>Total Deals</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_clients ?? '—'}</div>
          <div style={styles.statLabel}>Clients</div>
        </div>
        {avgDeal != null && (
          <div style={styles.statCard}>
            <div style={styles.statValue}>{formatPKR(avgDeal)}</div>
            <div style={styles.statLabel}>Avg Deal Size</div>
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
        {techs.map(t => (
          <button
            key={t}
            style={techFilter === t ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setTechFilter(t)}
          >{t}</button>
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

      {/* Revenue by Year */}
      {byYear.length > 0 && (
        <>
          <div style={styles.sectionLabel}>Revenue by Year</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Year</th>
                <th style={styles.th}>Revenue</th>
                <th style={styles.th}>Deals</th>
              </tr>
            </thead>
            <tbody>
              {byYear.map((row, i) => (
                <tr key={row.year}>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.year}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{fmt(row[revenueKey])}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.deals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Revenue by Tech */}
      {byTech.length > 0 && (
        <>
          <div style={styles.sectionLabel}>Revenue by Technology</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Technology</th>
                <th style={styles.th}>Revenue (PKR)</th>
                <th style={styles.th}>Deals</th>
              </tr>
            </thead>
            <tbody>
              {byTech.map((row, i) => (
                <tr key={row.tech}>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.tech}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{formatPKR(row.revenue_pkr)}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.deals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Revenue by Owner */}
      {byOwner.length > 0 && (
        <>
          <div style={styles.sectionLabel}>Revenue by Owner</div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Owner</th>
                <th style={styles.th}>Revenue (PKR)</th>
                <th style={styles.th}>Deals</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((row, i) => (
                <tr key={row.owner}>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.owner}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{formatPKR(row.revenue_pkr)}</td>
                  <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{row.deals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Top Deals Table */}
      <div style={styles.sectionLabel}>Deals</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Description</th>
              <th style={styles.th}>Account</th>
              <th style={styles.th}>Revenue</th>
              <th style={styles.th}>Date Closed</th>
              <th style={styles.th}>Owner</th>
              <th style={styles.th}>Tech</th>
            </tr>
          </thead>
          <tbody>
            {filteredDeals.map((deal, i) => (
              <tr key={i}>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{deal.description}</td>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{deal.account}</td>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>
                  {deal.currency === 'USD' ? formatUSD(deal.revenue_usd) : formatPKR(deal.revenue_pkr)}
                </td>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{deal.date_closed}</td>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{deal.owner}</td>
                <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{deal.tech}</td>
              </tr>
            ))}
            {filteredDeals.length === 0 && (
              <tr><td style={{ ...styles.td, textAlign: 'center' }} colSpan={6}>No deals found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
