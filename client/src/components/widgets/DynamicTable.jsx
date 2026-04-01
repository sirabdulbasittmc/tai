import { useState, useMemo } from 'react';

const s = {
  wrap: { margin: '12px 0' },
  title: { fontSize: 13, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  filterBar: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0', alignItems: 'center' },
  btn: { padding: '4px 10px', borderRadius: 14, border: '1px solid #444', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' },
  btnActive: { padding: '4px 10px', borderRadius: 14, border: '1px solid #cc6b4a', background: '#cc6b4a', color: '#fff', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { background: '#2a2a2a', color: '#e8e8e0', textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #cc6b4a', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { padding: '7px 10px', borderBottom: '1px solid #2a2a2a', color: '#bbb' },
  search: { background: '#2a2a2a', border: '1px solid #444', color: '#eee', padding: '5px 10px', borderRadius: 8, fontSize: 12, fontFamily: 'inherit', width: 180 },
};

export default function DynamicTable({ title, columns, rows, maxHeight }) {
  const [search, setSearch] = useState('');
  const [rowLimit, setRowLimit] = useState(10);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const filtered = useMemo(() => {
    let result = rows || [];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(row => row.some(cell => String(cell || '').toLowerCase().includes(q)));
    }
    if (sortCol !== null) {
      result = [...result].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol];
        const an = parseFloat(String(av).replace(/[^0-9.-]/g, ''));
        const bn = parseFloat(String(bv).replace(/[^0-9.-]/g, ''));
        if (!isNaN(an) && !isNaN(bn)) return sortDir === 'asc' ? an - bn : bn - an;
        return sortDir === 'asc' ? String(av || '').localeCompare(String(bv || '')) : String(bv || '').localeCompare(String(av || ''));
      });
    }
    return result;
  }, [rows, search, sortCol, sortDir]);

  const visible = rowLimit === 'all' ? filtered : filtered.slice(0, rowLimit);

  if (!columns || !rows || rows.length === 0) return null;

  return (
    <div style={s.wrap}>
      {title && <div style={s.title}>{title}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <input style={s.search} placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={s.filterBar}>
          {[10, 20, 'all'].map(n => (
            <button key={n} style={rowLimit === n ? s.btnActive : s.btn} onClick={() => setRowLimit(n)}>
              {n === 'all' ? 'All' : `Top ${n}`}
            </button>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: maxHeight || 400, overflowY: 'auto' }}>
        <table style={s.table}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th key={i} style={{ ...s.th, cursor: 'pointer' }} onClick={() => {
                  if (sortCol === i) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
                  else { setSortCol(i); setSortDir('asc'); }
                }}>
                  {col} {sortCol === i ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, ri) => (
              <tr key={ri} style={ri % 2 === 0 ? {} : { background: '#1a1a1a' }}>
                {row.map((cell, ci) => (
                  <td key={ci} style={s.td}>{cell ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
        Showing {visible.length} of {filtered.length} rows
      </div>
    </div>
  );
}
