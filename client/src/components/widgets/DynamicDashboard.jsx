import DynamicTable from './DynamicTable';

const s = {
  container: { fontFamily: "'Inter', -apple-system, sans-serif", color: '#e8e8e0', fontSize: 14, lineHeight: 1.6 },
  title: { fontSize: 18, fontWeight: 500, color: '#eee', margin: '0 0 12px' },
  cardGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, margin: '10px 0' },
  card: { background: 'linear-gradient(135deg, #252525, #1e1e1e)', border: '1px solid #333', borderRadius: 12, padding: 16, textAlign: 'center' },
  cardValue: { fontSize: 24, fontWeight: 700, color: '#cc6b4a', letterSpacing: -0.5 },
  cardLabel: { fontSize: 10, color: '#888', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardUnit: { fontSize: 11, color: '#666', marginTop: 2 },
  insights: { margin: '14px 0', padding: '12px 16px', background: '#252525', border: '1px solid #333', borderRadius: 10 },
  insightTitle: { fontSize: 12, color: '#cc6b4a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontWeight: 600 },
  insightItem: { fontSize: 13, color: '#bbb', margin: '4px 0', lineHeight: 1.5 },
};

export default function DynamicDashboard({ data }) {
  if (!data) return null;

  return (
    <div style={s.container}>
      {data.title && <h2 style={s.title}>{data.title}</h2>}

      {/* Summary Cards */}
      {data.summary_cards && data.summary_cards.length > 0 && (
        <div style={s.cardGrid}>
          {data.summary_cards.map((card, i) => (
            <div key={i} style={s.card}>
              <div style={s.cardValue}>{card.value ?? '—'}</div>
              <div style={s.cardLabel}>{card.label}</div>
              {card.unit && card.unit !== 'count' && <div style={s.cardUnit}>{card.unit}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Primary Table */}
      {data.primary_table && (
        <DynamicTable
          title={data.primary_table.title}
          columns={data.primary_table.columns}
          rows={data.primary_table.rows}
        />
      )}

      {/* Secondary Table */}
      {data.secondary_table && (
        <DynamicTable
          title={data.secondary_table.title}
          columns={data.secondary_table.columns}
          rows={data.secondary_table.rows}
        />
      )}

      {/* AI Insights */}
      {data.insights && data.insights.length > 0 && (
        <div style={s.insights}>
          <div style={s.insightTitle}>Key Insights</div>
          {data.insights.map((insight, i) => (
            <div key={i} style={s.insightItem}>• {insight}</div>
          ))}
        </div>
      )}
    </div>
  );
}
