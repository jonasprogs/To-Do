
// Taskflow — ultra-lean PWA (Vanilla JS + IndexedDB)
/* eslint-disable */

// --- PWA register ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

// --- Theme ---
const modeToggle = document.getElementById('modeToggle');
const root = document.documentElement;
const LS_THEME_KEY = 'taskflow-theme';
function applyTheme(pref) {
  root.classList.remove('light','dark');
  if (pref === 'light' || pref === 'dark') root.classList.add(pref);
}
applyTheme(localStorage.getItem(LS_THEME_KEY) || '');
modeToggle.addEventListener('click', () => {
  const current = root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : '';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(LS_THEME_KEY, next);
  applyTheme(next);
});

// --- Tiny helpers ---
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const h = (tag, attrs={}, children=[]) => {
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).filter(Boolean).forEach(c => {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else el.appendChild(c);
  });
  return el;
};
const formatMin = m => {
  if (!m || m <= 0) return '0m';
  const h = Math.floor(m/60), mm = m%60;
  return (h?`${h}h `:'') + (mm?`${mm}m`: (h?'' : '0m'));
};
const todayStr = () => new Date().toISOString().slice(0,10);
const addDays = (dateStr, days) => {
  const d = new Date(dateStr || todayStr());
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
};
const vibrate = ms => 'vibrate' in navigator && navigator.vibrate(ms);

// --- Storage (IndexedDB with localStorage fallback) ---
const DB = (()=>{
  const DB_NAME = 'taskflow-db';
  const DB_VER = 1;
  let db;
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('workspaces')) d.createObjectStore('workspaces', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('tasks')) d.createObjectStore('tasks', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('subtasks')) d.createObjectStore('subtasks', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  async function store(name, mode='readonly') {
    if (!('indexedDB' in window)) return null;
    if (!db) await idb();
    return db.transaction(name, mode).objectStore(name);
  }
  const F = {
    async put(name, value){ const s = await store(name,'readwrite'); if(!s){ localStorage.setItem(name+':'+value.id, JSON.stringify(value)); return value; } return new Promise((res,rej)=>{ const r=s.put(value); r.onsuccess=()=>res(value); r.onerror=()=>rej(r.error);}); },
    async getAll(name){ const s = await store(name); if(!s){ return Object.entries(localStorage).filter(([k])=>k.startsWith(name+':')).map(([,v])=>JSON.parse(v)); } return new Promise((res,rej)=>{ const r=s.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);}); },
    async get(name,id){ const s = await store(name); if(!s){ const v = localStorage.getItem(name+':'+id); return v?JSON.parse(v):null; } return new Promise((res,rej)=>{ const r=s.get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error);}); },
    async del(name,id){ const s = await store(name,'readwrite'); if(!s){ localStorage.removeItem(name+':'+id); return; } return new Promise((res,rej)=>{ const r=s.delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error);}); }
  };
  return F;
})();

// --- Data model ---
const WS = { PRIVATE:'private', WORK:'work' };

// --- State ---
const state = {
  ws: WS.PRIVATE,
  view: 'inbox',
  selectionMode: false,
  selected: new Set(),
  cache: { workspaces:[], projects:[], tasks:[], subtasks:[] },
  lastDeleted: null, // for undo
};

// --- Seeding (first run) ---
(async function seedIfEmpty(){
  const tasks = await DB.getAll('tasks');
  if (tasks.length) { await refreshCache(); renderAll(); return; }
  // Workspaces
  await DB.put('workspaces',{ id: WS.PRIVATE, type:'private' });
  await DB.put('workspaces',{ id: WS.WORK, type:'work' });
  // Projects
  const p1 = { id: crypto.randomUUID(), workspaceId: WS.WORK, name:'ACME Möbel GmbH', description:'Flyer Q4', createdAt: Date.now() };
  const p2 = { id: crypto.randomUUID(), workspaceId: WS.WORK, name:'Hagebau Schneider', description:'Prospekt KW40', createdAt: Date.now() };
  await DB.put('projects', p1); await DB.put('projects', p2);
  // Tasks
  const t = (o)=> DB.put('tasks', Object.assign({id:crypto.randomUUID(), createdAt:Date.now()}, o));
  await t({ workspaceId: WS.PRIVATE, title:'Einkaufen', estimateMinutes:30, dueDate: todayStr() });
  await t({ workspaceId: WS.PRIVATE, title:'Laufen 5km', estimateMinutes:45 });
  const t1 = { workspaceId: WS.WORK, title:'Briefing finalisieren', estimateMinutes:60, projectId:p1.id, dueDate: todayStr() };
  const t1id = crypto.randomUUID(); await DB.put('tasks', { id:t1id, ...t1 });
  await DB.put('subtasks', { id: crypto.randomUUID(), taskId: t1id, title:'Korrektur lesen', estimateMinutes:20 });
  await DB.put('subtasks', { id: crypto.randomUUID(), taskId: t1id, title:'Freigabe einholen', estimateMinutes:10 });
  await t({ workspaceId: WS.WORK, title:'Druckerei anfragen', estimateMinutes:30, projectId:p2.id, dueDate: addDays(todayStr(),1) });
  await refreshCache(); renderAll();
})();

async function refreshCache(){
  state.cache.workspaces = await DB.getAll('workspaces');
  state.cache.projects = await DB.getAll('projects');
  state.cache.tasks = await DB.getAll('tasks');
  state.cache.subtasks = await DB.getAll('subtasks');
}

// --- UI wiring (tabs, workspace switch) ---
const tabButtons = $$('.bottombar .tab');
tabButtons.forEach(btn => btn.addEventListener('click', () => {
  tabButtons.forEach(b => b.classList.toggle('active', b===btn));
  setView(btn.dataset.view);
}));
function setView(view){
  state.view = view;
  $$('#content > section').forEach(s => s.classList.toggle('hidden', s.dataset.view !== view));
  if (view === 'inbox') renderInbox();
  if (view === 'today') renderToday();
  if (view === 'planned') renderPlanned();
  if (view === 'projects') renderProjects();
  if (view === 'search') { $('#searchInput').value = ''; renderSearch(''); }
  if (view === 'project-detail') renderProjectDetail();
}
const wsButtons = [$('#wsPrivateBtn'), $('#wsWorkBtn')];
wsButtons.forEach(btn => btn.addEventListener('click', () => {
  state.ws = btn.dataset.ws;
  wsButtons.forEach(b => b.setAttribute('aria-selected', b===btn ? 'true':'false'));
  // Show/hide Projects tab
  $$('.work-only').forEach(el => el.style.display = state.ws===WS.WORK ? '' : 'none');
  // Change default to inbox
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.view==='inbox'));
  setView('inbox');
  updateQuickPlaceholder();
}));

function updateQuickPlaceholder(){
  $('#quickInput').placeholder = state.ws===WS.WORK ? 'Neue Arbeitsaufgabe… (Enter)' : 'Neue private Aufgabe… (Enter)';
}
updateQuickPlaceholder();

// --- Quick add ---
$('#quickAddBtn').addEventListener('click', () => quickAdd());
$('#quickInput').addEventListener('keydown', e => { if (e.key==='Enter'){ e.preventDefault(); quickAdd(); }});
async function quickAdd(){
  const input = $('#quickInput');
  const title = input.value.trim();
  if (!title) return;
  const t = { id: crypto.randomUUID(), workspaceId: state.ws, title, createdAt: Date.now() };
  await DB.put('tasks', t);
  input.value = '';
  await refreshCache();
  toast('Aufgabe erstellt');
  renderInbox();
}

// --- Toast with undo ---
let toastTimer;
function toast(msg, {actionText, onAction}={}){
  const el = $('#toast');
  el.innerHTML = actionText ? `${msg} <span role="button" class="link" id="toastAction">${actionText}</span>` : msg;
  el.classList.add('show');
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
  if (onAction){
    $('#toastAction')?.addEventListener('click', () => { onAction(); el.classList.remove('show'); });
  }
}

// --- Multi select toolbar ---
function setSelectionMode(on){
  state.selectionMode = on;
  state.selected.clear();
  $('#multiToolbar').setAttribute('aria-hidden', on ? 'false' : 'true');
  if (!on) $$('.item.selected').forEach(i => i.classList.remove('selected'));
  updateMultiCount();
}
$('#multiCloseBtn').addEventListener('click', () => setSelectionMode(false));
function toggleSelect(id, el){
  if (!state.selectionMode) return;
  if (state.selected.has(id)) { state.selected.delete(id); el.classList.remove('selected'); }
  else { state.selected.add(id); el.classList.add('selected'); }
  updateMultiCount();
}
function updateMultiCount(){ $('#multiCount').textContent = state.selected.size; }

$('#batchCompleteBtn').addEventListener('click', async () => {
  for (const id of state.selected) {
    const t = state.cache.tasks.find(t=>t.id===id); if (!t) continue;
    t.completedAt = Date.now();
    await DB.put('tasks', t);
  }
  await refreshCache(); renderCurrent(); setSelectionMode(false); toast('Erledigt');
});
$('#batchSnoozeBtn').addEventListener('click', async () => {
  for (const id of state.selected) {
    const t = state.cache.tasks.find(t=>t.id===id); if (!t) continue;
    t.dueDate = addDays(t.dueDate || todayStr(), 1);
    await DB.put('tasks', t);
  }
  await refreshCache(); renderCurrent(); setSelectionMode(false); toast('Verschoben +1 Tag');
});
$('#batchDeleteBtn').addEventListener('click', async () => {
  const toDelete = state.cache.tasks.filter(t=>state.selected.has(t.id));
  for (const t of toDelete) {
    t._deleted = true; t._deletedAt = Date.now();
    await DB.put('tasks', t);
  }
  state.lastDeleted = toDelete;
  await refreshCache(); renderCurrent();
  setSelectionMode(false);
  toast(`${toDelete.length} gelöscht`, { actionText:'Rückgängig', onAction: async ()=>{
    for (const t of toDelete){ delete t._deleted; delete t._deletedAt; await DB.put('tasks', t); }
    await refreshCache(); renderCurrent();
  }});
});

// --- Rendering helpers ---
function renderCurrent(){
  setView(state.view);
}

function taskEstimateTotal(tasks){
  return tasks.reduce((sum,t)=> sum + (t.estimateMinutes||0) + subtaskTotal(t.id), 0);
}
function subtaskTotal(taskId){
  return state.cache.subtasks.filter(s=>s.taskId===taskId).reduce((a,s)=>a+(s.estimateMinutes||0),0);
}
function taskProgress(taskId){
  const subs = state.cache.subtasks.filter(s=>s.taskId===taskId);
  if (!subs.length) return null;
  const done = subs.filter(s=>s.completedAt).length;
  return Math.round(done/subs.length*100);
}
function projectProgress(projectId){
  const tasks = state.cache.tasks.filter(t=>t.projectId===projectId && !t._deleted);
  if (!tasks.length) return 0;
  const done = tasks.filter(t=>t.completedAt).length;
  return Math.round(done/tasks.length*100);
}

// --- Inbox ---
function renderInbox(){
  const list = $('#view-inbox');
  list.innerHTML = '';
  const tasks = state.cache.tasks
    .filter(t=>t.workspaceId===state.ws && !t._deleted && !t.completedAt)
    .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  if (!tasks.length) { list.appendChild(h('div',{class:'empty'},'Keine Aufgaben in der Inbox.')); return; }
  tasks.forEach(t => list.appendChild(taskItem(t)));
}

function taskItem(t){
  const est = (t.estimateMinutes||0) + subtaskTotal(t.id);
  const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString() : null;
  const li = h('div',{class:'item', 'data-id':t.id});
  // swipe hints
  li.appendChild(h('div',{class:'swipe-hint swipe-left'},'Erledigen'));
  li.appendChild(h('div',{class:'swipe-hint swipe-right'},'Snooze +1'));

  const cb = h('div',{class:'checkbox'+(t.completedAt?' done':''), role:'checkbox', 'aria-checked':!!t.completedAt});
  const textWrap = h('div',{style:'min-width:0;'});
  textWrap.appendChild(h('div',{class:'title'}, t.title || '(ohne Titel)'));
  const meta = h('div',{class:'meta'});
  if (est) meta.appendChild(h('span',{class:'badge'}, formatMin(est)));
  if (t.priority) meta.appendChild(h('span',{class:'badge'}, 'P'+t.priority));
  if (t.tags && t.tags.length) meta.appendChild(h('span',{class:'badge'}, t.tags.join(', ')));
  if (due) meta.appendChild(h('span',{class:'badge'}, due));
  if (t.projectId){
    const p = state.cache.projects.find(p=>p.id===t.projectId);
    if (p) meta.appendChild(h('span',{class:'badge'}, p.name));
  }
  const prog = taskProgress(t.id);
  if (prog!==null) meta.appendChild(h('span',{class:'badge'}, `${prog}%`));
  textWrap.appendChild(meta);

  const right = h('div',{class:'right'});
  const editBtn = h('button',{class:'ghost small', onclick:()=>openSheet(t.id)}, 'Bearbeiten');

  li.append(cb, textWrap, right);
  right.append(editBtn);

  // events
  cb.addEventListener('click', async e => {
    t.completedAt = t.completedAt ? null : Date.now();
    await DB.put('tasks', t); await refreshCache(); renderCurrent();
  });
  li.addEventListener('click', e => {
    if (state.selectionMode){ toggleSelect(t.id, li); return; }
    openSheet(t.id);
  });
  // long press to select
  let lpTimer, moved=false;
  li.addEventListener('touchstart', () => { moved=false; lpTimer=setTimeout(()=>{ setSelectionMode(true); toggleSelect(t.id, li); vibrate(10); }, 450); }, {passive:true});
  li.addEventListener('touchmove', ()=>{ moved=true; clearTimeout(lpTimer); }, {passive:true});
  li.addEventListener('touchend', ()=>{ clearTimeout(lpTimer); });

  // swipe
  let startX=0, startY=0, swiping=false;
  li.addEventListener('touchstart', (e)=>{ const t0=e.touches[0]; startX=t0.clientX; startY=t0.clientY; swiping=true; li.classList.add('swiping'); }, {passive:true});
  li.addEventListener('touchmove', (e)=>{
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dx) < Math.abs(dy)) return; // vertical scroll
    li.style.transform = `translateX(${dx}px)`;
  }, {passive:true});
  li.addEventListener('touchend', async (e)=>{
    li.classList.remove('swiping');
    const dx = (e.changedTouches[0].clientX - startX);
    li.style.transform = '';
    if (dx < -80){ // left complete
      t.completedAt = Date.now(); await DB.put('tasks', t); await refreshCache(); toast('Erledigt'); renderCurrent(); vibrate(8);
    } else if (dx > 80){ // right snooze +1
      t.dueDate = addDays(t.dueDate || todayStr(), 1); await DB.put('tasks', t); await refreshCache(); toast('Verschoben +1 Tag'); renderCurrent(); vibrate(8);
    }
    swiping=false;
  });
  return li;
}

// --- Today ---
function renderToday(){
  const tasks = state.cache.tasks.filter(t=> t.workspaceId===state.ws && !t._deleted && !t.completedAt && t.dueDate === todayStr());
  const done = state.cache.tasks.filter(t=> t.workspaceId===state.ws && t.completedAt && (t.dueDate===todayStr() || new Date(t.completedAt).toISOString().slice(0,10)===todayStr()));
  const total = taskEstimateTotal(tasks);
  const doneMin = taskEstimateTotal(done);
  const openMin = Math.max(0, total - doneMin);
  $('#todayTotals').innerHTML = `Geplant: ${formatMin(total)} · Erledigt: ${formatMin(doneMin)} · Offen: ${formatMin(openMin)}`;
  const list = $('#todayList'); list.innerHTML = '';
  if (!tasks.length){ list.appendChild(h('div',{class:'empty'},'Heute ist nichts fällig.')); return; }
  tasks.sort((a,b)=> (a.priority||9)-(b.priority||9));
  tasks.forEach(t=> list.appendChild(taskItem(t)));
}

// --- Planned ---
function renderPlanned(){
  const container = $('#plannedGroups'); container.innerHTML='';
  const tasks = state.cache.tasks.filter(t=> t.workspaceId===state.ws && !t._deleted && !t.completedAt && t.dueDate);
  if (!tasks.length){ container.appendChild(h('div',{class:'empty'},'Keine geplanten Aufgaben.')); return; }
  // group by date
  const groups = {};
  tasks.forEach(t=> { groups[t.dueDate] = groups[t.dueDate] || []; groups[t.dueDate].push(t); });
  const dates = Object.keys(groups).sort();
  dates.forEach(d => {
    const head = h('div',{class:'header-row'}, [h('h3',{}, new Date(d).toLocaleDateString()), h('span',{class:'badge'}, formatMin(taskEstimateTotal(groups[d])))]);
    container.appendChild(head);
    const list = h('div',{class:'list'});
    groups[d].sort((a,b)=>(a.priority||9)-(b.priority||9));
    groups[d].forEach(t=> list.appendChild(taskItem(t)));
    container.appendChild(list);
  });
}

// --- Projects (work only) ---
function renderProjects(){
  if (state.ws !== WS.WORK){
    $('#projectList').innerHTML = '<div class="empty">Wechsle zu „Arbeit“, um Projekte zu sehen.</div>';
    return;
  }
  const holder = $('#projectList'); holder.innerHTML='';
  const projects = state.cache.projects.filter(p=>p.workspaceId===WS.WORK);
  if (!projects.length){ holder.appendChild(h('div',{class:'empty'},'Noch keine Projekte.')); return; }
  projects.forEach(p => {
    const total = taskEstimateTotal(state.cache.tasks.filter(t=>t.projectId===p.id && !t._deleted));
    const prog = projectProgress(p.id);
    const card = h('div',{class:'card'});
    card.appendChild(h('div',{class:'header-row'},[
      h('strong',{},p.name),
      h('span',{class:'spacer'}),
      h('span',{class:'badge'},formatMin(total)),
      h('span',{class:'badge'}, prog+'%')
    ]));
    const bar = h('div',{class:'progress'}, h('i',{style:`width:${prog}%;`}));
    card.appendChild(bar);
    card.addEventListener('click', ()=>openProject(p.id));
    holder.appendChild(card);
  });
}
$('#addProjectBtn').addEventListener('click', async ()=>{
  const name = prompt('Projektname (Kunde):'); if (!name) return;
  await DB.put('projects', { id: crypto.randomUUID(), workspaceId: WS.WORK, name, createdAt: Date.now() });
  await refreshCache(); renderProjects();
});

let currentProjectId = null;
function openProject(id){
  currentProjectId = id;
  tabButtons.forEach(b=>b.classList.remove('active'));
  setView('project-detail');
  renderProjectDetail();
}
function renderProjectDetail(){
  if (!currentProjectId) return;
  const p = state.cache.projects.find(p=>p.id===currentProjectId);
  $('#projectTitle').textContent = p?.name || 'Projekt';
  const tasks = state.cache.tasks.filter(t=>t.projectId===p.id && !t._deleted);
  const total = taskEstimateTotal(tasks);
  const prog = projectProgress(p.id);
  $('#projectMeta').innerHTML = `<span class="badge">Gesamt: ${formatMin(total)}</span> <span class="badge">${prog}%</span>`;
  // Subtabs
  const tabs = $$('.subtab');
  tabs.forEach(t=> t.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.remove('active')); t.classList.add('active');
    const showTasks = t.dataset.subtab==='tasks';
    $('#projectTasks').classList.toggle('hidden', !showTasks);
    $('#projectGantt').classList.toggle('hidden', showTasks);
    if (!showTasks) drawGantt(p.id);
  }));
  // Task list
  const list = $('#projectTasks'); list.innerHTML='';
  tasks.sort((a,b)=>(a.completedAt?1:0)-(b.completedAt?1:0));
  tasks.forEach(t=> list.appendChild(taskItem(t)));
  $('#projectBackBtn').onclick = () => { currentProjectId=null; setView('projects'); };
}

function drawGantt(projectId){
  const holder = $('#projectGantt'); holder.innerHTML='';
  const tasks = state.cache.tasks.filter(t=>t.projectId===projectId && !t._deleted);
  if (!tasks.length){ holder.appendChild(h('div',{class:'empty'},'Keine Aufgaben für Timeline.')); return; }
  // derive start & end
  const items = tasks.map(t=>{
    const start = t.startDate || t.dueDate || todayStr();
    const end = t.dueDate || start;
    return { id:t.id, title:t.title, start, end, done: !!t.completedAt };
  });
  const minDate = items.reduce((min,i)=> i.start<min ? i.start : min, items[0].start);
  const maxDate = items.reduce((max,i)=> i.end>max ? i.end : max, items[0].end);
  const dayMs = 86400000;
  const min = new Date(minDate); const max = new Date(maxDate);
  const days = Math.max(1, Math.round((max - min)/dayMs)+1);
  const width = Math.max(600, days*60);
  const rowH = 28, padL = 80, padT = 20;
  const svg = h('svg',{viewBox:`0 0 ${width+padL+20} ${padT + items.length*rowH + 40}`});
  // grid
  for (let d=0; d<days; d++){
    const x = padL + d*(width/days);
    const line = h('line',{x1:x,y1:padT-10,x2:x,y2:padT + items.length*rowH + 10, stroke:'#2b3448', 'stroke-width':0.5});
    svg.appendChild(line);
    const dateStr = new Date(min.getTime()+d*dayMs).toLocaleDateString();
    svg.appendChild(h('text',{x:x+4, y:14, 'font-size':10, fill:'#8aa0c4'}, dateStr));
  }
  // rows
  items.forEach((it,idx)=>{
    const totalDays = Math.max(1, (new Date(it.end)-new Date(it.start))/dayMs + 1);
    const x = padL + ( (new Date(it.start) - min)/dayMs ) * (width/days);
    const w = totalDays * (width/days) - 6;
    const y = padT + idx*rowH;
    svg.appendChild(h('text',{x:6, y:y+12, 'font-size':12, fill:'#8aa0c4'}, it.title.slice(0,18)));
    const rect = h('rect',{x:x, y:y, width:Math.max(12,w), height:16, rx:6, fill: it.done ? '#22c55e' : '#3b82f6'});
    svg.appendChild(rect);
  });
  holder.appendChild(svg);
}

// --- Search ---
$('#searchBtn').addEventListener('click', ()=>{
  tabButtons.forEach(b=>b.classList.remove('active'));
  setView('search');
});
$('#searchInput').addEventListener('input', (e)=> renderSearch(e.target.value));
function renderSearch(q){
  const res = $('#searchResults'); res.innerHTML='';
  const term = (q||'').toLowerCase();
  const tasks = state.cache.tasks.filter(t=> t.workspaceId===state.ws && !t._deleted && !t.completedAt);
  const projsById = Object.fromEntries(state.cache.projects.map(p=>[p.id,p]));
  const matches = tasks.filter(t=>{
    const inTitle = (t.title||'').toLowerCase().includes(term);
    const inNotes = (t.notes||'').toLowerCase().includes(term);
    const inTags = (t.tags||[]).join(' ').toLowerCase().includes(term);
    const inProj = t.projectId && (projsById[t.projectId]?.name || '').toLowerCase().includes(term);
    return !term || inTitle || inNotes || inTags || inProj;
  });
  if (!matches.length){ res.appendChild(h('div',{class:'empty'}, 'Keine Treffer.')); return; }
  matches.forEach(t=> res.appendChild(taskItem(t)));
}

// --- Edit sheet ---
const sheet = $('#sheet');
function openSheet(id){
  const t = state.cache.tasks.find(x=>x.id===id);
  if (!t) return;
  $('#taskId').value = t.id;
  $('#taskTitle').value = t.title || '';
  $('#taskEstimate').value = t.estimateMinutes || '';
  $('#taskPriority').value = t.priority || '';
  $('#taskNotes').value = t.notes || '';
  $('#taskTags').value = (t.tags||[]).join(', ');
  $('#taskDate').value = t.dueDate || '';
  $('#taskTime').value = t.dueTime || '';
  // work fields
  const isWork = t.workspaceId === WS.WORK;
  $('#workOnlyFields').classList.toggle('hidden', !isWork);
  $('#subtasksBlock').classList.toggle('hidden', !isWork);
  if (isWork){
    // populate project list
    const sel = $('#taskProject'); sel.innerHTML = '<option value="">—</option>';
    state.cache.projects.filter(p=>p.workspaceId===WS.WORK).forEach(p=> sel.appendChild(h('option',{value:p.id, selected: t.projectId===p.id ? 'selected':null}, p.name)));
    // list subtasks
    renderSubtasksFor(t.id);
  }
  // buttons
  $('#completeTaskBtn').onclick = async ()=>{
    t.completedAt = Date.now(); await DB.put('tasks', t); await refreshCache(); closeSheet(); renderCurrent(); toast('Erledigt');
  };
  $('#deleteTaskBtn').onclick = async ()=>{
    t._deleted = true; t._deletedAt = Date.now(); await DB.put('tasks', t); state.lastDeleted=[t];
    await refreshCache(); closeSheet(); renderCurrent();
    toast('Gelöscht', { actionText:'Rückgängig', onAction: async ()=>{
      delete t._deleted; delete t._deletedAt; await DB.put('tasks', t); await refreshCache(); renderCurrent();
    }});
  };
  sheet.setAttribute('aria-hidden','false');
}
function closeSheet(){ sheet.setAttribute('aria-hidden','true'); }

$('#taskForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const id = $('#taskId').value;
  const t = state.cache.tasks.find(x=>x.id===id);
  if (!t) return;
  t.title = $('#taskTitle').value.trim();
  t.estimateMinutes = parseInt($('#taskEstimate').value || '0',10) || 0;
  t.priority = $('#taskPriority').value || null;
  t.notes = $('#taskNotes').value.trim() || '';
  t.tags = $('#taskTags').value.split(',').map(s=>s.trim()).filter(Boolean);
  t.dueDate = $('#taskDate').value || null;
  t.dueTime = $('#taskTime').value || null;
  if (t.workspaceId === WS.WORK){
    t.projectId = $('#taskProject').value || null;
  }
  await DB.put('tasks', t); await refreshCache(); closeSheet(); renderCurrent(); toast('Gespeichert');
});

// chips
$$('.chip[data-snooze]').forEach(c => c.addEventListener('click', ()=>{
  const id = $('#taskId').value; const t = state.cache.tasks.find(x=>x.id===id); if(!t) return;
  const type = c.dataset.snooze;
  if (type==='today') t.dueDate = todayStr();
  if (type==='tomorrow') t.dueDate = addDays(todayStr(),1);
  if (type==='nextweek') t.dueDate = addDays(todayStr(),7);
  DB.put('tasks', t).then(refreshCache).then(()=>{ $('#taskDate').value=t.dueDate||''; renderCurrent(); });
}));
$$('.chip[data-est]').forEach(c => c.addEventListener('click', ()=>{
  $('#taskEstimate').value = c.dataset.est;
}));

// subtasks
function renderSubtasksFor(taskId){
  const holder = $('#subtaskList'); holder.innerHTML='';
  const subs = state.cache.subtasks.filter(s=>s.taskId===taskId);
  if (!subs.length){ holder.appendChild(h('div',{class:'muted'},'Keine Unteraufgaben.')); }
  subs.forEach(s=>{
    const row = h('div',{class:'row', style:'align-items:center; margin-bottom:6px;'});
    row.appendChild(h('input',{type:'text', value:s.title, oninput:(e)=>{ s.title=e.target.value; DB.put('subtasks', s);} }));
    row.appendChild(h('input',{type:'number', min:'0', step:'5', value:s.estimateMinutes||0, oninput:(e)=>{ s.estimateMinutes=parseInt(e.target.value||'0',10)||0; DB.put('subtasks', s);} }));
    const del = h('button',{class:'danger', onclick: async ()=>{ await DB.del('subtasks', s.id); await refreshCache(); renderSubtasksFor(taskId); renderCurrent(); }}, '–');
    row.appendChild(del);
    holder.appendChild(row);
  });
}
$('#addSubtaskBtn').addEventListener('click', async ()=>{
  const taskId = $('#taskId').value; if (!taskId) return;
  const title = $('#subtaskTitleInput').value.trim(); if (!title) return;
  const est = parseInt($('#subtaskEstInput').value||'0',10)||0;
  await DB.put('subtasks', { id: crypto.randomUUID(), taskId, title, estimateMinutes: est });
  $('#subtaskTitleInput').value=''; $('#subtaskEstInput').value='';
  await refreshCache(); renderSubtasksFor(taskId); renderCurrent();
});

// sheet dismissal
sheet.addEventListener('click', (e)=>{ if (e.target===sheet) closeSheet(); });

// --- Export / Import ---
const exportDialog = $('#exportDialog');
$('#exportBtn').addEventListener('click', ()=> exportDialog.showModal());
$('#doExportBtn').addEventListener('click', async (e)=>{
  e.preventDefault();
  const data = {
    workspaces: await DB.getAll('workspaces'),
    projects: await DB.getAll('projects'),
    tasks: await DB.getAll('tasks'),
    subtasks: await DB.getAll('subtasks'),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = h('a',{href:url, download:'taskflow-export.json'}); document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
});
$('#doImportBtn').addEventListener('click', async (e)=>{
  e.preventDefault();
  const file = $('#importFile').files[0]; if (!file) return;
  const text = await file.text();
  const data = JSON.parse(text);
  for (const w of data.workspaces||[]) await DB.put('workspaces', w);
  for (const p of data.projects||[]) await DB.put('projects', p);
  for (const t of data.tasks||[]) await DB.put('tasks', t);
  for (const s of data.subtasks||[]) await DB.put('subtasks', s);
  await refreshCache(); renderAll(); exportDialog.close(); toast('Import abgeschlossen');
});

// --- Today capacity (optional) ---
const CAP_KEY = 'taskflow-capacity';
let capacity = JSON.parse(localStorage.getItem(CAP_KEY) || '{"private":240,"work":360}');
function remainingToday(){
  const planned = state.cache.tasks.filter(t=>t.workspaceId===state.ws && !t._deleted && !t.completedAt && t.dueDate===todayStr());
  const need = taskEstimateTotal(planned);
  const cap = state.ws===WS.WORK ? capacity.work : capacity.private;
  return { planned: need, cap, left: Math.max(0, cap-need) };
}

// --- Render ALL views ---
function renderAll(){ renderInbox(); renderToday(); renderPlanned(); renderProjects(); }

// Initial boot to inbox
setView('inbox');

// --- Accessibility: keyboard shortcut ("/" for search) ---
document.addEventListener('keydown', (e)=>{
  if (e.key==='/'){ e.preventDefault(); setView('search'); $('#searchInput').focus(); }
});

