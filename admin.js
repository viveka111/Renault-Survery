(function () {
'use strict';
const API = (window.CBP_API || '').replace(/\/$/, '');
const v = document.getElementById('view');
let key = ''; try { key = sessionStorage.getItem('cbp_admin') || ''; } catch (e) { key = ''; }
let data = null, insight = '', busy = false, msg = '';

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) { const x = attrs[k]; if (x == null || x === false) continue;
    if (k === 'class') e.className = x; else if (k.startsWith('on')) e.addEventListener(k.slice(2), x); else e.setAttribute(k, x === true ? '' : x); }
  (function add(l) { for (const c of l) { if (c == null || c === false) continue; if (Array.isArray(c)) add(c); else e.append(c.nodeType ? c : document.createTextNode(String(c))); } })(kids);
  return e;
}
async function api(path, opts) {
  const res = await fetch(API + path, { ...opts, headers: { 'x-admin-key': key, 'content-type': 'application/json' } });
  if (res.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
  if (!res.ok) { const e = new Error('http ' + res.status); e.status = res.status; throw e; }
  return res;
}
async function load() {
  msg = '';
  try { data = (await (await api('/api/admin/responses')).json()).responses; try { sessionStorage.setItem('cbp_admin', key); } catch (e) { /* ignore */ } }
  catch (e) { data = null; msg = e.status === 401 ? 'That key is not right.' : e.status === 503 ? 'Admin is disabled. Set ADMIN_KEY on the server.' : 'Could not load responses.'; if (e.status === 401) key = ''; }
  render();
}
async function summarize() {
  busy = true; insight = ''; msg = ''; render();
  try { insight = (await (await api('/api/admin/summary', { method: 'POST', body: '{}' })).json()).text; }
  catch (e) { msg = 'Could not write the summary. Check ANTHROPIC_API_KEY and try again.'; }
  busy = false; render();
}
async function exportCsv() {
  try {
    const blob = await (await api('/api/admin/export.csv')).blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: 'car-brand-pulse.csv' });
    document.body.append(a); a.click(); a.remove();
  } catch (e) { msg = 'Could not export.'; render(); }
}
function render() {
  v.textContent = '';
  if (!data) {
    const inp = h('input', { class: 'field', id: 'key', type: 'password', placeholder: 'Admin key', autocomplete: 'current-password' });
    inp.value = key;
    const go = () => { key = inp.value.trim(); load(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    v.append(h('section', { class: 'card' },
      h('p', { class: 'kicker' }, 'Survey owner'), h('h1', null, 'Responses'),
      inp, msg ? h('p', { class: 'notice' }, msg) : null,
      h('div', { class: 'actions' }, h('button', { class: 'primary', type: 'button', onclick: go }, 'Open'))));
    return;
  }
  const done = data.filter(x => x.completed).length;
  const avg = data.length ? Math.round(data.reduce((s, x) => s + x.answers.length, 0) / data.length * 10) / 10 : 0;
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, 'Survey owner · responses'), h('h1', null, 'Responses'),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, String(data.length)), 'started'),
      h('div', { class: 'stat' }, h('b', null, String(done)), 'finished'),
      h('div', { class: 'stat' }, h('b', null, String(avg)), 'questions each')),
    h('div', { class: 'actions' },
      h('button', { class: 'ghost', type: 'button', onclick: load }, 'Refresh'),
      h('button', { class: 'ghost', type: 'button', disabled: !data.length, onclick: exportCsv }, 'Export CSV'),
      h('button', { class: 'primary', type: 'button', disabled: busy || !data.length, onclick: summarize }, busy ? 'Writing…' : 'Summarise with Claude')),
    msg ? h('p', { class: 'notice' }, msg) : null,
    insight ? h('div', { class: 'insight' }, insight) : null,
    !data.length ? h('p', { class: 'hint' }, 'No responses yet. Share the survey link, or take the survey yourself to see how it adapts.') : null,
    data.map(x => h('details', { class: 'resp' },
      h('summary', null, h('span', null, new Date(x.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })),
        h('span', { class: 'c' }, (x.completed ? 'Finished' : 'Incomplete') + ' · ' + x.answers.length + ' answers · ' + x.mode)),
      h('ul', { class: 'sum' }, x.answers.map(a => h('li', null,
        h('span', { class: 'c' }, (a.id === 'probe' ? 'Follow-up: ' : '') + a.question), h('span', { class: 'a' }, a.answer), a.note ? h('span', { class: 'c' }, 'Comment: ' + a.note) : null)))))
  ));
}
if (key) load(); else render();
})();
