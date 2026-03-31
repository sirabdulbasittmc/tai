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
  searchInput: { background: '#2a2a2a', border: '1px solid #444', color: '#eee', padding: '6px 10px', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', minWidth: 180 },
  table: { width: '100%', borderCollapse: 'collapse', margin: '10px 0', fontSize: 13 },
  th: { background: '#2a2a2a', color: '#e8e8e0', textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #cc6b4a', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { padding: '8px 12px', borderBottom: '1px solid #2a2a2a', color: '#bbb' },
  tdEven: { padding: '8px 12px', borderBottom: '1px solid #2a2a2a', color: '#bbb', background: '#1a1a1a' },
  sectionLabel: { fontSize: 13, color: '#888', marginTop: 16, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
};

export default function EmployeeDashboard({ data }) {
  const [deptFilter, setDeptFilter] = useState('All');
  const [gradeFilter, setGradeFilter] = useState('All');
  const [search, setSearch] = useState('');

  const summary = data?.summary || {};
  const employees = data?.employees || [];
  const departments = summary.departments || [];
  const grades = summary.grades || [];
  const locations = summary.locations || [];

  const deptOptions = useMemo(() => ['All', ...departments.map(d => d.department).filter(Boolean)], [departments]);
  const gradeOptions = useMemo(() => ['All', ...grades.map(g => g.grade).filter(Boolean)], [grades]);

  const filtered = useMemo(() => {
    let list = employees;
    if (deptFilter !== 'All') {
      list = list.filter(e => e.department === deptFilter);
    }
    if (gradeFilter !== 'All') {
      list = list.filter(e => e.grade === gradeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e => (e.name || '').toLowerCase().includes(q));
    }
    return list;
  }, [employees, deptFilter, gradeFilter, search]);

  return (
    <div style={styles.container}>
      <h2 style={styles.h2}>Employee Dashboard</h2>

      <div style={styles.cardGrid}>
        <div style={styles.statCard}>
          <div style={styles.statValue}>{summary.total_employees ?? '—'}</div>
          <div style={styles.statLabel}>Total Employees</div>
        </div>
        {departments.slice(0, 4).map(d => (
          <div key={d.department} style={styles.statCard}>
            <div style={styles.statValue}>{d.count}</div>
            <div style={styles.statLabel}>{d.department}</div>
          </div>
        ))}
      </div>

      {/* Breakdown tables: Grades and Locations side by side */}
      {(grades.length > 0 || locations.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, margin: '10px 0' }}>
          {grades.length > 0 && (
            <div>
              <div style={styles.sectionLabel}>By Grade</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Grade</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {grades.map((g, i) => (
                    <tr key={g.grade}>
                      <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{g.grade}</td>
                      <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{g.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {locations.length > 0 && (
            <div>
              <div style={styles.sectionLabel}>By Location</div>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Location</th>
                    <th style={styles.th}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l, i) => (
                    <tr key={l.location}>
                      <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{l.location}</td>
                      <td style={i % 2 === 1 ? styles.tdEven : styles.td}>{l.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div style={styles.filterBar}>
        <input
          style={styles.searchInput}
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span style={{ color: '#555', margin: '0 4px' }}>|</span>
        {deptOptions.map(d => (
          <button
            key={d}
            style={deptFilter === d ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setDeptFilter(d)}
          >{d}</button>
        ))}
        <span style={{ color: '#555', margin: '0 4px' }}>|</span>
        {gradeOptions.map(g => (
          <button
            key={g}
            style={gradeFilter === g ? styles.filterBtnActive : styles.filterBtn}
            onClick={() => setGradeFilter(g)}
          >{g}</button>
        ))}
      </div>

      {/* Employees Table */}
      <div style={styles.sectionLabel}>Employees ({filtered.length})</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Department</th>
              <th style={styles.th}>Grade</th>
              <th style={styles.th}>Role</th>
              <th style={styles.th}>Location</th>
              <th style={styles.th}>Manager</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => {
              const tdStyle = i % 2 === 1 ? styles.tdEven : styles.td;
              return (
                <tr key={e.employee_id || i}>
                  <td style={tdStyle}>{e.employee_id}</td>
                  <td style={tdStyle}>{e.name}</td>
                  <td style={tdStyle}>{e.department}</td>
                  <td style={tdStyle}>{e.grade}</td>
                  <td style={tdStyle}>{e.role}</td>
                  <td style={tdStyle}>{e.location}</td>
                  <td style={tdStyle}>{e.manager}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td style={{ ...styles.td, textAlign: 'center' }} colSpan={7}>No employees found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
