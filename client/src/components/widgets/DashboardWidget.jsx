import DynamicDashboard from './DynamicDashboard';
import DynamicTable from './DynamicTable';

export default function DashboardWidget({ data }) {
  if (!data) return null;

  if (data.widget_type === 'table' && data.primary_table) {
    return (
      <div style={{ fontFamily: "'Inter', -apple-system, sans-serif", color: '#e8e8e0', fontSize: 14 }}>
        {data.title && <h2 style={{ fontSize: 18, fontWeight: 500, color: '#eee', margin: '0 0 12px' }}>{data.title}</h2>}
        <DynamicTable
          title={data.primary_table.title}
          columns={data.primary_table.columns}
          rows={data.primary_table.rows}
        />
      </div>
    );
  }

  // dashboard, chart, or any other type — use universal renderer
  return <DynamicDashboard data={data} />;
}
