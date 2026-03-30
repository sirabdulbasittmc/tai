import prisma from '../db/prisma';

/**
 * Seeds the general_artifacts table with pre-built widget templates.
 * All templates feature:
 * - Dynamic filters auto-generated from data
 * - Chart type switcher (bar/line/pie/doughnut)
 * - Dimension picker (change what the chart shows)
 * - Responsive stat cards
 * - Searchable/filterable tables
 */

interface GeneralArtifact {
  artifact_key: string;
  title: string;
  description: string;
  match_intents: string;
  html_template: string;
  data_schema: string;
}

// ── Shared utility JS for all dashboards ──────────────────────
const SHARED_JS = `
function buildFilters(containerId,data,fields){
  const c=document.getElementById(containerId);if(!c)return;
  fields.forEach(f=>{
    const vals=[...new Set(data.map(d=>d[f.key]||'N/A'))].sort();
    const bar=document.createElement('div');bar.className='filter-bar';bar.id='filter_'+f.key;
    bar.innerHTML='<span style="color:#888;margin-right:4px">'+f.label+':</span><button class="filter-btn active" data-val="all">All</button>'+vals.map(v=>'<button class="filter-btn" data-val="'+v+'">'+v+'</button>').join('');
    bar.querySelectorAll('.filter-btn').forEach(b=>b.onclick=()=>{
      window['_f_'+f.key]=b.dataset.val;
      bar.querySelectorAll('.filter-btn').forEach(x=>x.classList.toggle('active',x===b));
      renderAll();
    });
    window['_f_'+f.key]='all';
    c.appendChild(bar);
  });
}
function applyFilters(data,fields){
  return data.filter(d=>fields.every(f=>{const v=window['_f_'+f.key];return v==='all'||d[f.key]===v||(v==='None'&&(!d[f.key]||d[f.key]==='None'||d[f.key]==='No open risks'))}));
}
function buildChartSwitcher(canvasId,label){
  const wrap=document.getElementById(canvasId).parentElement;
  const sw=document.createElement('div');sw.style.cssText='display:flex;gap:4px;margin-bottom:8px;justify-content:flex-end';
  ['bar','line','pie','doughnut'].forEach(t=>{
    const b=document.createElement('button');b.className='filter-btn';b.style.cssText='padding:2px 8px;font-size:10px';b.textContent=t;
    if(t==='bar')b.classList.add('active');
    b.onclick=()=>{
      window['_ct_'+canvasId]=t;sw.querySelectorAll('.filter-btn').forEach(x=>x.classList.remove('active'));b.classList.add('active');
      renderAll();
    };
    sw.appendChild(b);
  });
  window['_ct_'+canvasId]='bar';
  wrap.insertBefore(sw,wrap.firstChild);
}
function makeChart(canvasId,labels,datasets,title){
  const type=window['_ct_'+canvasId]||'bar';
  const ctx=document.getElementById(canvasId).getContext('2d');
  if(window['_ch_'+canvasId])window['_ch_'+canvasId].destroy();
  const isPie=type==='pie'||type==='doughnut';
  window['_ch_'+canvasId]=new Chart(ctx,{type,data:{labels,datasets:isPie?[{data:datasets[0].data,backgroundColor:datasets[0].backgroundColor||['#cc6b4a','#3b82f6','#4ade80','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4']}]:datasets},options:{responsive:true,plugins:{legend:{position:isPie?'bottom':'top',labels:{color:'#aaa'}},title:{display:!!title,text:title,color:'#aaa'}},scales:isPie?{}:{x:{ticks:{color:'#888'}},y:{ticks:{color:'#888'},grid:{color:'#333'}}}}});
}
function fmt(v,c){return (c||'')+(v>=1e9?(v/1e9).toFixed(1)+'B':v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'K':v.toFixed?v.toFixed(0):v)}
`;

const ARTIFACTS: GeneralArtifact[] = [
  // ─── 1. Project Dashboard ───────────────────────────────────
  {
    artifact_key: 'project_dashboard',
    title: 'Project Portfolio Dashboard',
    description: 'Interactive overview of all active projects with progress, risk levels, and schedule status',
    match_intents: 'project dashboard,project status,portfolio overview,project summary,project overview,active projects,all projects',
    data_schema: JSON.stringify({
      projects: [{ code: 'string', name: 'string', client: 'string', progress: 'number (0-100)', status: 'string', risk: 'string (Critical/High/Medium/None)', endDate: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sTotal">0</div><div class="stat-label">Total Projects</div></div>
  <div class="stat-card"><div class="stat-value" id="sOnTrack" style="color:#4ade80">0</div><div class="stat-label">No Risk</div></div>
  <div class="stat-card"><div class="stat-value" id="sAtRisk" style="color:#ef4444">0</div><div class="stat-label">At Risk</div></div>
  <div class="stat-card"><div class="stat-value" id="sAvgProg">0%</div><div class="stat-label">Avg Progress</div></div>
</div>
<div id="filters"></div>
<table><thead><tr><th>Code</th><th>Project</th><th>Client</th><th>Progress</th><th>Status</th><th>Risk</th><th>End Date</th></tr></thead><tbody id="tbody"></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="chart-wrap"><canvas id="ch1"></canvas></div>
  <div class="chart-wrap"><canvas id="ch2"></canvas></div>
</div>
<script>
${SHARED_JS}
const DATA={{DATA}};
buildFilters('filters',DATA.projects,[{key:'risk',label:'Risk'},{key:'status',label:'Status'},{key:'client',label:'Client'}]);
buildChartSwitcher('ch1','Status');buildChartSwitcher('ch2','Risk');
function renderAll(){
  const f=applyFilters(DATA.projects,[{key:'risk'},{key:'status'},{key:'client'}]);
  document.getElementById('sTotal').textContent=f.length;
  document.getElementById('sOnTrack').textContent=f.filter(p=>!p.risk||p.risk==='None'||p.risk==='No open risks').length;
  document.getElementById('sAtRisk').textContent=f.filter(p=>p.risk==='Critical'||p.risk==='High').length;
  document.getElementById('sAvgProg').textContent=f.length?Math.round(f.reduce((s,p)=>s+p.progress,0)/f.length)+'%':'0%';
  document.getElementById('tbody').innerHTML=f.sort((a,b)=>b.progress-a.progress).slice(0,15).map(p=>'<tr><td>'+p.code+'</td><td>'+p.name+'</td><td>'+p.client+'</td><td><div class="progress-bar"><div class="progress-fill" style="width:'+Math.round(p.progress)+'%"></div></div>'+Math.round(p.progress)+'%</td><td>'+p.status+'</td><td><span class="badge badge-'+(p.risk==='Critical'?'critical':p.risk==='High'?'high':p.risk==='Medium'?'medium':'low')+'">'+p.risk+'</span></td><td>'+p.endDate+'</td></tr>').join('');
  const sl={};f.forEach(p=>{sl[p.status]=(sl[p.status]||0)+1});
  makeChart('ch1',Object.keys(sl),[{label:'Projects',data:Object.values(sl),backgroundColor:['#3b82f6','#4ade80','#f59e0b','#ef4444','#8b5cf6']}],'By Status');
  const rl={};f.forEach(p=>{rl[p.risk||'None']=(rl[p.risk||'None']||0)+1});
  makeChart('ch2',Object.keys(rl),[{label:'Projects',data:Object.values(rl),backgroundColor:Object.keys(rl).map(l=>l==='Critical'?'#ef4444':l==='High'?'#f59e0b':l==='Medium'?'#3b82f6':'#4ade80')}],'By Risk');
}
renderAll();
</script>`,
  },

  // ─── 2. Sales Dashboard ─────────────────────────────────────
  {
    artifact_key: 'sales_dashboard',
    title: 'Sales & Revenue Dashboard',
    description: 'Revenue breakdown by client, currency, and year with deal pipeline',
    match_intents: 'sales dashboard,revenue dashboard,sales overview,revenue summary,sales report,deal summary,revenue breakdown',
    data_schema: JSON.stringify({
      deals: [{ client: 'string', project: 'string', value: 'number', currency: 'string (PKR/USD)', year: 'string', stage: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sPKR">PKR 0</div><div class="stat-label">PKR Revenue</div></div>
  <div class="stat-card"><div class="stat-value" id="sUSD">USD 0</div><div class="stat-label">USD Revenue</div></div>
  <div class="stat-card"><div class="stat-value" id="sDeals">0</div><div class="stat-label">Total Deals</div></div>
  <div class="stat-card"><div class="stat-value" id="sAvg">0</div><div class="stat-label">Avg Deal Size</div></div>
</div>
<div id="filters"></div>
<table><thead><tr><th>Client</th><th>Project/Deal</th><th>Value</th><th>Currency</th><th>Year</th><th>Stage</th></tr></thead><tbody id="tbody"></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="chart-wrap"><canvas id="ch1"></canvas></div>
  <div class="chart-wrap"><canvas id="ch2"></canvas></div>
</div>
<script>
${SHARED_JS}
const DATA={{DATA}};
buildFilters('filters',DATA.deals,[{key:'currency',label:'Currency'},{key:'year',label:'Year'},{key:'stage',label:'Stage'}]);
buildChartSwitcher('ch1','By Client');buildChartSwitcher('ch2','By Year');
function renderAll(){
  const f=applyFilters(DATA.deals,[{key:'currency'},{key:'year'},{key:'stage'}]);
  document.getElementById('sPKR').textContent=fmt(f.filter(d=>d.currency==='PKR').reduce((s,d)=>s+d.value,0),'PKR ');
  document.getElementById('sUSD').textContent=fmt(f.filter(d=>d.currency==='USD').reduce((s,d)=>s+d.value,0),'USD ');
  document.getElementById('sDeals').textContent=f.length;
  document.getElementById('sAvg').textContent=f.length?fmt(f.reduce((s,d)=>s+d.value,0)/f.length,''):'0';
  document.getElementById('tbody').innerHTML=f.sort((a,b)=>b.value-a.value).slice(0,15).map(d=>'<tr><td>'+d.client+'</td><td>'+d.project+'</td><td>'+fmt(d.value,d.currency+' ')+'</td><td>'+d.currency+'</td><td>'+d.year+'</td><td><span class="badge badge-medium">'+d.stage+'</span></td></tr>').join('');
  const byClient={};f.forEach(d=>{byClient[d.client]=(byClient[d.client]||0)+d.value});
  const cl=Object.entries(byClient).sort((a,b)=>b[1]-a[1]).slice(0,8);
  makeChart('ch1',cl.map(c=>c[0]),[{label:'Revenue',data:cl.map(c=>c[1]),backgroundColor:'#cc6b4a'}],'Revenue by Client');
  const byYear={};f.forEach(d=>{byYear[d.year]=(byYear[d.year]||0)+d.value});
  const yl=Object.entries(byYear).sort((a,b)=>a[0].localeCompare(b[0]));
  makeChart('ch2',yl.map(y=>y[0]),[{label:'Revenue',data:yl.map(y=>y[1]),backgroundColor:['#3b82f6','#4ade80','#f59e0b','#ef4444','#8b5cf6','#ec4899']}],'Revenue by Year');
}
renderAll();
</script>`,
  },

  // ─── 3. Org Chart ───────────────────────────────────────────
  {
    artifact_key: 'org_chart',
    title: 'Organization Hierarchy',
    description: 'Interactive org chart showing reporting structure with department filters',
    match_intents: 'org chart,organization chart,reporting structure,team structure,hierarchy,who reports to,management structure,org structure,organizational structure,company structure,org tree',
    data_schema: JSON.stringify({
      stats: { totalEmployees: 'number', departments: 'number' },
      employees: [{ id: 'string', name: 'string', title: 'string', grade: 'string', department: 'string', managerId: 'string', directReports: 'number' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sTotal">0</div><div class="stat-label">Employees</div></div>
  <div class="stat-card"><div class="stat-value" id="sDepts">0</div><div class="stat-label">Departments</div></div>
  <div class="stat-card"><div class="stat-value" id="sShown">0</div><div class="stat-label">Showing</div></div>
</div>
<input class="org-search" id="search" placeholder="Search by name, title or department..." oninput="renderAll()">
<div id="filters"></div>
<ul class="org-tree" id="orgTree"></ul>
<script>
${SHARED_JS}
const DATA={{DATA}};
document.getElementById('sTotal').textContent=DATA.stats.totalEmployees;
document.getElementById('sDepts').textContent=DATA.stats.departments;
buildFilters('filters',DATA.employees,[{key:'department',label:'Department'},{key:'grade',label:'Grade'}]);
function renderAll(){
  const q=document.getElementById('search').value.toLowerCase();
  const f=applyFilters(DATA.employees,[{key:'department'},{key:'grade'}]).filter(e=>!q||e.name.toLowerCase().includes(q)||e.title.toLowerCase().includes(q)||e.department.toLowerCase().includes(q));
  document.getElementById('sShown').textContent=f.length;
  const roots=f.filter(e=>!e.managerId||!f.find(m=>m.id===e.managerId));
  document.getElementById('orgTree').innerHTML=roots.map(r=>renderNode(r,f)).join('');
}
function renderNode(emp,all){
  const ch=all.filter(e=>e.managerId===emp.id);
  return '<li><div class="org-node"><div style="display:flex;justify-content:space-between;align-items:center"><span class="name">'+emp.name+'</span><span class="grade">'+emp.grade+'</span></div><div class="title">'+emp.title+'</div><div style="display:flex;gap:8px;margin-top:4px"><span class="dept">'+emp.department+'</span>'+(ch.length?'<span style="font-size:10px;color:#888">('+ch.length+' reports)</span>':'')+'</div></div>'+(ch.length?'<ul class="org-tree">'+ch.map(c=>renderNode(c,all)).join('')+'</ul>':'')+'</li>';
}
renderAll();
</script>`,
  },

  // ─── 4. Risk Dashboard ──────────────────────────────────────
  {
    artifact_key: 'risk_dashboard',
    title: 'Risk Management Dashboard',
    description: 'Overview of all project risks by severity with project breakdown',
    match_intents: 'risk dashboard,risk overview,risk summary,critical risks,open risks,risk management,project risks',
    data_schema: JSON.stringify({
      risks: [{ project: 'string', riskId: 'string', severity: 'string (Critical/High/Medium/Low)', description: 'string', owner: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sTotal">0</div><div class="stat-label">Total Risks</div></div>
  <div class="stat-card"><div class="stat-value" id="sCrit" style="color:#ef4444">0</div><div class="stat-label">Critical</div></div>
  <div class="stat-card"><div class="stat-value" id="sHigh" style="color:#f59e0b">0</div><div class="stat-label">High</div></div>
  <div class="stat-card"><div class="stat-value" id="sMed" style="color:#3b82f6">0</div><div class="stat-label">Medium</div></div>
</div>
<div id="filters"></div>
<table><thead><tr><th>Project</th><th>Risk ID</th><th>Severity</th><th>Description</th><th>Owner</th></tr></thead><tbody id="tbody"></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="chart-wrap"><canvas id="ch1"></canvas></div>
  <div class="chart-wrap"><canvas id="ch2"></canvas></div>
</div>
<script>
${SHARED_JS}
const DATA={{DATA}};
buildFilters('filters',DATA.risks,[{key:'severity',label:'Severity'},{key:'project',label:'Project'}]);
buildChartSwitcher('ch1','By Severity');buildChartSwitcher('ch2','By Project');
function renderAll(){
  const f=applyFilters(DATA.risks,[{key:'severity'},{key:'project'}]);
  document.getElementById('sTotal').textContent=f.length;
  document.getElementById('sCrit').textContent=f.filter(r=>r.severity==='Critical').length;
  document.getElementById('sHigh').textContent=f.filter(r=>r.severity==='High').length;
  document.getElementById('sMed').textContent=f.filter(r=>r.severity==='Medium').length;
  document.getElementById('tbody').innerHTML=f.slice(0,15).map(r=>'<tr><td>'+r.project+'</td><td>'+r.riskId+'</td><td><span class="badge badge-'+(r.severity==='Critical'?'critical':r.severity==='High'?'high':r.severity==='Medium'?'medium':'low')+'">'+r.severity+'</span></td><td>'+r.description+'</td><td>'+r.owner+'</td></tr>').join('');
  const bySev={};f.forEach(r=>{bySev[r.severity]=(bySev[r.severity]||0)+1});
  makeChart('ch1',Object.keys(bySev),[{label:'Risks',data:Object.values(bySev),backgroundColor:Object.keys(bySev).map(s=>s==='Critical'?'#ef4444':s==='High'?'#f59e0b':s==='Medium'?'#3b82f6':'#4ade80')}],'By Severity');
  const byProj={};f.forEach(r=>{byProj[r.project]=(byProj[r.project]||0)+1});
  const pl=Object.entries(byProj).sort((a,b)=>b[1]-a[1]).slice(0,8);
  makeChart('ch2',pl.map(p=>p[0]),[{label:'Risks',data:pl.map(p=>p[1]),backgroundColor:'#ef4444'}],'By Project');
}
renderAll();
</script>`,
  },

  // ─── 5. Employee Directory ──────────────────────────────────
  {
    artifact_key: 'employee_directory',
    title: 'Employee Directory',
    description: 'Searchable employee list with department and grade filters',
    match_intents: 'employee list,employee directory,staff list,all employees,team members,people directory,employee details',
    data_schema: JSON.stringify({
      employees: [{ id: 'string', name: 'string', title: 'string', grade: 'string', department: 'string', team: 'string', manager: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sTotal">0</div><div class="stat-label">Total</div></div>
  <div class="stat-card"><div class="stat-value" id="sDepts">0</div><div class="stat-label">Departments</div></div>
  <div class="stat-card"><div class="stat-value" id="sShown">0</div><div class="stat-label">Showing</div></div>
</div>
<input class="org-search" id="search" placeholder="Search by name, title or department..." oninput="renderAll()">
<div id="filters"></div>
<table><thead><tr><th>ID</th><th>Name</th><th>Title</th><th>Grade</th><th>Department</th><th>Manager</th></tr></thead><tbody id="tbody"></tbody></table>
<div class="chart-wrap" style="margin-top:16px"><canvas id="ch1"></canvas></div>
<script>
${SHARED_JS}
const DATA={{DATA}};
document.getElementById('sTotal').textContent=DATA.employees.length;
document.getElementById('sDepts').textContent=[...new Set(DATA.employees.map(e=>e.department))].length;
buildFilters('filters',DATA.employees,[{key:'department',label:'Department'},{key:'grade',label:'Grade'}]);
buildChartSwitcher('ch1','By Department');
let limit=15;
function renderAll(){
  const q=document.getElementById('search').value.toLowerCase();
  const f=applyFilters(DATA.employees,[{key:'department'},{key:'grade'}]).filter(e=>!q||e.name.toLowerCase().includes(q)||e.title.toLowerCase().includes(q));
  document.getElementById('sShown').textContent=f.length;
  document.getElementById('tbody').innerHTML=f.slice(0,limit).map(e=>'<tr><td>'+e.id+'</td><td><strong>'+e.name+'</strong></td><td>'+e.title+'</td><td><span class="grade">'+e.grade+'</span></td><td><span class="dept">'+e.department+'</span></td><td>'+e.manager+'</td></tr>').join('')+(f.length>limit?'<tr><td colspan="6" style="text-align:center;color:#cc6b4a;cursor:pointer" onclick="limit=999;renderAll()">Show all '+f.length+'</td></tr>':'');
  const byDept={};f.forEach(e=>{byDept[e.department]=(byDept[e.department]||0)+1});
  const dl=Object.entries(byDept).sort((a,b)=>b[1]-a[1]);
  makeChart('ch1',dl.map(d=>d[0]),[{label:'Employees',data:dl.map(d=>d[1]),backgroundColor:'#cc6b4a'}],'By Department');
}
renderAll();
</script>`,
  },

  // ─── 6. Pipeline Dashboard ──────────────────────────────────
  {
    artifact_key: 'pipeline_dashboard',
    title: 'Sales Pipeline Dashboard',
    description: 'Sales pipeline by stage with deal values and conversion funnel',
    match_intents: 'pipeline dashboard,pipeline overview,sales pipeline,opportunity pipeline,deal pipeline,pipeline stages,opportunities',
    data_schema: JSON.stringify({
      deals: [{ client: 'string', opportunity: 'string', value: 'number', currency: 'string', stage: 'string', probability: 'string', closeDate: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sValue">0</div><div class="stat-label">Pipeline Value</div></div>
  <div class="stat-card"><div class="stat-value" id="sDeals">0</div><div class="stat-label">Opportunities</div></div>
  <div class="stat-card"><div class="stat-value" id="sStages">0</div><div class="stat-label">Stages</div></div>
</div>
<div id="filters"></div>
<table><thead><tr><th>Client</th><th>Opportunity</th><th>Value</th><th>Stage</th><th>Probability</th><th>Close Date</th></tr></thead><tbody id="tbody"></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="chart-wrap"><canvas id="ch1"></canvas></div>
  <div class="chart-wrap"><canvas id="ch2"></canvas></div>
</div>
<script>
${SHARED_JS}
const DATA={{DATA}};
buildFilters('filters',DATA.deals,[{key:'stage',label:'Stage'},{key:'currency',label:'Currency'},{key:'client',label:'Client'}]);
buildChartSwitcher('ch1','By Stage');buildChartSwitcher('ch2','By Client');
function renderAll(){
  const f=applyFilters(DATA.deals,[{key:'stage'},{key:'currency'},{key:'client'}]);
  document.getElementById('sValue').textContent=fmt(f.reduce((s,d)=>s+d.value,0),'');
  document.getElementById('sDeals').textContent=f.length;
  document.getElementById('sStages').textContent=[...new Set(f.map(d=>d.stage))].length;
  document.getElementById('tbody').innerHTML=f.sort((a,b)=>b.value-a.value).slice(0,15).map(d=>'<tr><td>'+d.client+'</td><td>'+d.opportunity+'</td><td>'+fmt(d.value,d.currency+' ')+'</td><td><span class="badge badge-medium">'+d.stage+'</span></td><td>'+d.probability+'</td><td>'+d.closeDate+'</td></tr>').join('');
  const byStage={};f.forEach(d=>{byStage[d.stage]=(byStage[d.stage]||0)+1});
  makeChart('ch1',Object.keys(byStage),[{label:'Deals',data:Object.values(byStage),backgroundColor:'#cc6b4a'}],'Deals by Stage');
  const byClient={};f.forEach(d=>{byClient[d.client]=(byClient[d.client]||0)+d.value});
  const cl=Object.entries(byClient).sort((a,b)=>b[1]-a[1]).slice(0,6);
  makeChart('ch2',cl.map(c=>c[0]),[{label:'Value',data:cl.map(c=>c[1]),backgroundColor:['#3b82f6','#4ade80','#f59e0b','#ef4444','#8b5cf6','#cc6b4a']}],'Value by Client');
}
renderAll();
</script>`,
  },

  // ─── 7. Client Portfolio ────────────────────────────────────
  {
    artifact_key: 'client_portfolio',
    title: 'Client Portfolio Overview',
    description: 'All clients with their projects, revenue, and engagement status',
    match_intents: 'client portfolio,client overview,client list,all clients,client summary,account overview,client dashboard',
    data_schema: JSON.stringify({
      clients: [{ name: 'string', projects: 'number', revenue: 'string', currency: 'string', status: 'string', solutions: 'string' }],
    }),
    html_template: `<div class="card-grid">
  <div class="stat-card"><div class="stat-value" id="sClients">0</div><div class="stat-label">Clients</div></div>
  <div class="stat-card"><div class="stat-value" id="sProjects">0</div><div class="stat-label">Total Projects</div></div>
  <div class="stat-card"><div class="stat-value" id="sShown">0</div><div class="stat-label">Showing</div></div>
</div>
<input class="org-search" id="search" placeholder="Search clients..." oninput="renderAll()">
<div id="filters"></div>
<table><thead><tr><th>Client</th><th>Projects</th><th>Revenue</th><th>Status</th><th>Solutions</th></tr></thead><tbody id="tbody"></tbody></table>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="chart-wrap"><canvas id="ch1"></canvas></div>
  <div class="chart-wrap"><canvas id="ch2"></canvas></div>
</div>
<script>
${SHARED_JS}
const DATA={{DATA}};
document.getElementById('sClients').textContent=DATA.clients.length;
document.getElementById('sProjects').textContent=DATA.clients.reduce((s,c)=>s+c.projects,0);
buildFilters('filters',DATA.clients,[{key:'status',label:'Status'},{key:'solutions',label:'Solution'}]);
buildChartSwitcher('ch1','By Revenue');buildChartSwitcher('ch2','By Status');
function renderAll(){
  const q=document.getElementById('search').value.toLowerCase();
  const f=applyFilters(DATA.clients,[{key:'status'},{key:'solutions'}]).filter(c=>!q||c.name.toLowerCase().includes(q));
  document.getElementById('sShown').textContent=f.length;
  document.getElementById('tbody').innerHTML=f.map(c=>'<tr><td><strong>'+c.name+'</strong></td><td>'+c.projects+'</td><td>'+c.revenue+'</td><td><span class="badge badge-'+(c.status==='Active'?'low':'medium')+'">'+c.status+'</span></td><td>'+c.solutions+'</td></tr>').join('');
  const top=f.slice(0,10);
  makeChart('ch1',top.map(c=>c.name),[{label:'Revenue',data:top.map(c=>parseFloat(c.revenue.replace(/[^0-9.]/g,''))||0),backgroundColor:'#cc6b4a'}],'Revenue by Client');
  const byStat={};f.forEach(c=>{byStat[c.status]=(byStat[c.status]||0)+1});
  makeChart('ch2',Object.keys(byStat),[{label:'Clients',data:Object.values(byStat),backgroundColor:['#4ade80','#f59e0b','#ef4444','#3b82f6']}],'By Status');
}
renderAll();
</script>`,
  },
];

export async function seedGeneralArtifacts(): Promise<void> {
  console.log('[Seed] Seeding general_artifacts...');

  for (const art of ARTIFACTS) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO general_artifacts (artifact_key, title, description, match_intents, html_template, data_schema, version, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, 1, true)
      ON CONFLICT (artifact_key) DO UPDATE SET
        title = $2, description = $3, match_intents = $4, html_template = $5, data_schema = $6,
        version = general_artifacts.version + 1, updated_at = NOW()
    `, art.artifact_key, art.title, art.description, art.match_intents, art.html_template, art.data_schema);
    console.log(`  [+] ${art.artifact_key}: ${art.title}`);
  }

  console.log(`[Seed] Done — ${ARTIFACTS.length} general artifacts seeded.`);
}
