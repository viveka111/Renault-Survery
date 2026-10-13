(function () {
'use strict';
const { SECTIONS, BANK, BYID, MAX_Q, MAX_PROBES } = window.Shared;
const API = (window.CBP_API || '').replace(/\/$/, '');
const DEBUG = /[?&]debug=1(&|$)/.test(location.search);
const EXCL = /^(none|neither|not sure|i am not familiar|i do not know|not familiar|no preference|nothing)/i;

/* ---------- State ---------- */
const S = { view: 'intro', mode: 'adaptive', answers: [], covered: new Set(), current: null, draft: null, lead: '', notice: '',
  probes: 0, lastS: 0, rid: null, completed: false, saveState: 'idle', ctl: null, failures: [], contact: { email: '', consent: false }, contactSaved: false };
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e) && e.length <= 254;
let saveChain = Promise.resolve();

/* ---------- DOM helper ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k]; if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  (function add(list) {
    for (const c of list) {
      if (c == null || c === false) continue;
      if (Array.isArray(c)) add(c); else e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  })(kids);
  return e;
}
const $ = id => document.getElementById(id);

/* ---------- Helpers ---------- */
const pending = () => BANK.filter(b => !S.covered.has(b.id));
function answerFor(id) { return S.answers.find(a => a.covers.includes(id)); }
function val(id) { const x = answerFor(id); return x ? x.value : null; }
function unaware() {
  const a4 = val('q4');
  if (Array.isArray(a4) && !a4.includes('Renault')) return true;
  const a5 = val('q5');
  return !!(Array.isArray(a5) && a5.includes('I am not familiar with Renault'));
}
function ownsCar() { const v = val('q1'); return v === 'I currently own a car' || v === 'Both'; }
function notInMarket() { return val('q1') === 'Neither' || val('q15') === 'Not planning to buy a car'; }
function staticSkip(b) {
  if (b.id === 'q5') { const a4 = val('q4'); return Array.isArray(a4) && !a4.includes('Renault'); }
  if (['q6', 'q7', 'q11', 'q12', 'q21'].includes(b.id)) return unaware();
  if (['q15', 'q2', 'q17', 'q24'].includes(b.id)) return notInMarket();
  if (b.id === 'q18') return !ownsCar();
  return false;
}
function staticNext() {
  for (const b of pending()) {
    if (staticSkip(b)) { S.covered.add(b.id); continue; }
    return { ...b, covers: [b.id] };
  }
  return null;
}
function shuffled(opts) {
  const body = [], tail = [];
  opts.forEach(o => (EXCL.test(o) ? tail : body).push(o));
  for (let i = body.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [body[i], body[j]] = [body[j], body[i]]; }
  return body.concat(tail);
}
function newDraft(q) { return { sel: q.type === 'multi' ? [] : null, other: '', scale: null, grid: {}, text: '', note: '' }; }
function otherText(d) { return 'Other: ' + (d.other.trim() || 'unspecified'); }
function readAnswer(q, d) {
  if (q.type === 'single') {
    if (d.sel == null) return { ok: !q.req, empty: true, value: null, display: '(skipped)' };
    const v = d.sel === 'Other' ? otherText(d) : d.sel; return { ok: true, value: v, display: v };
  }
  if (q.type === 'multi') {
    if (!d.sel.length) return { ok: !q.req, empty: true, value: [], display: '(skipped)' };
    const v = d.sel.map(x => x === 'Other' ? otherText(d) : x); return { ok: true, value: v, display: v.join('; ') };
  }
  if (q.type === 'scale') {
    if (d.scale == null) return { ok: !q.req, empty: true, value: null, display: '(skipped)' };
    if (d.scale === 'na') return { ok: true, value: 'na', display: q.naLabel };
    return { ok: true, value: d.scale, display: d.scale + ' of 5 (' + q.labels[d.scale - 1] + ')' };
  }
  if (q.type === 'grid') {
    const done = q.rows.every(r => d.grid[r] != null);
    const parts = q.rows.filter(r => d.grid[r] != null).map(r => r + ': ' + (d.grid[r] === 'na' ? 'not rated' : d.grid[r] + '/5'));
    return { ok: done, empty: !parts.length, value: { ...d.grid }, display: parts.join('; ') };
  }
  const t = d.text.trim();
  return { ok: !q.req || !!t, empty: !t, value: t, display: t || '(skipped)' };
}

/* ---------- Saving ---------- */
function queueSave() {
  const payload = {
    rid: S.rid, completed: S.completed, mode: S.mode,
    contact: S.contactSaved ? { email: S.contact.email, consent: S.contact.consent } : { email: '', consent: false },
    debug: { origin: location.origin, api: API || '(same site)', ua: (navigator.userAgent || '').slice(0, 160), failures: S.failures.slice(0, 10) },
    answers: S.answers.map(a => ({ id: a.id, covers: a.covers, question: a.question, type: a.type, answer: a.display, note: a.note || '' }))
  };
  S.saveState = 'saving';
  saveChain = saveChain
    .then(() => fetch(API + '/api/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))
    .then(r => { S.saveState = r.ok ? 'saved' : 'failed'; syncSaveLabel(); })
    .catch(() => { S.saveState = 'failed'; syncSaveLabel(); });
}
function syncSaveLabel() { const el = $('savestate'); if (el) el.textContent = saveText(); }
function saveText() {
  return { saved: 'Your answers are saved.', saving: 'Saving your answers…', failed: 'Your answers could not be saved. Please tell the person who sent you this link.', idle: '' }[S.saveState] || '';
}

/* ---------- Flow ---------- */
function start() {
  S.mode = 'adaptive'; S.notice = '';
  S.answers = []; S.failures = []; S.covered = new Set(); S.probes = 0; S.lastS = 0; S.completed = false; S.lead = ''; S.saveState = 'idle'; S.contact = { email: '', consent: false }; S.contactSaved = false;
  S.rid = 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  S.current = { ...BYID.q1, covers: ['q1'] }; S.draft = newDraft(S.current); S.view = 'question'; render(); window.scrollTo(0, 0);
}
function onNext() {
  const q = S.current, d = S.draft, r = readAnswer(q, d); if (!r.ok) return;
  const covers = q.covers || [];
  S.answers.push({ id: covers[0] || 'probe', covers, question: q.text, type: q.type, value: r.value, display: r.display, note: d.note.trim() });
  covers.forEach(id => S.covered.add(id));
  if (covers.length) S.lastS = BYID[covers[0]].s; else S.probes++;
  queueSave();
  advance();
}
function finish() { S.view = 'contact'; queueSave(); render(); window.scrollTo(0, 0); }
function toEnd() { S.view = 'end'; render(); window.scrollTo(0, 0); }
function show(q, lead) {
  if (q.shuffle && q.options) q.options = shuffled(q.options);
  q.s = q.covers && q.covers.length ? BYID[q.covers[0]].s : S.lastS;
  S.current = q; S.draft = newDraft(q); S.lead = lead || ''; S.view = 'question'; render(); window.scrollTo(0, 0);
}
async function askServer(signal) {
  const res = await fetch(API + '/api/next', {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({
      sid: S.rid, probes: S.probes, covered: [...S.covered],
      answers: S.answers.map(a => ({ id: a.id, question: a.question, display: a.display, note: a.note }))
    })
  });
  if (!res.ok) {
    let j = {}; try { j = await res.json(); } catch (x) { /* ignore */ }
    const e = new Error('http ' + res.status);
    e.http = res.status; e.code = j.error || ('http_' + res.status); e.upstream = j.status || 0; e.detail = j.detail || '';
    throw e;
  }
  return res.json();
}
function techText() {
  const f = S.failures[S.failures.length - 1] || {};
  return ['Reason: ' + (f.code || f.kind || 'unknown'), f.status ? 'Status: ' + f.status : '', f.detail ? 'Message: ' + f.detail : '',
    'Survey page: ' + location.origin, 'Worker: ' + (API || '(same site)')].filter(Boolean).join('\n');
}
function noteFail(f) {
  S.failures.push({ n: S.answers.length + 1, kind: f.kind, code: f.code || '', status: f.status || 0, detail: String(f.detail || '').slice(0, 400) });
}
function debugLine(f) {
  return DEBUG ? ' [debug] ' + [f.code, f.status || '', f.detail].filter(Boolean).join(' · ') : '';
}
async function advance() {
  if (!pending().length || S.answers.length >= MAX_Q) { finish(); return; }
  if (S.mode !== 'adaptive') { const q = staticNext(); if (!q) { finish(); return; } show(q, ''); return; }
  S.view = 'loading'; render();
  const ctl = new AbortController(); S.ctl = ctl;
  const slow = setTimeout(() => { const b = $('slowbtn'); if (b) b.hidden = false; }, 7000);
  try {
    const r = await askServer(ctl.signal);
    clearTimeout(slow); S.ctl = null;
    if (Array.isArray(r.skip)) r.skip.forEach(id => { if (BYID[id]) S.covered.add(id); });
    if (!pending().length) { finish(); return; }
    if (!r.done && !r.question) { noteFail({ kind: 'rejected', code: 'question_rejected', detail: r.raw || 'Claude answered, but the question could not be used' }); queueSave(); if (DEBUG) S.notice = 'Debug: Claude answered, but the question was rejected. ' + (r.raw || ''); }
    let q = (!r.done && r.question) ? r.question : null;
    if (q) q.covers = (q.covers || []).filter(id => !S.covered.has(id));
    if (q && !q.covers.length && S.probes >= MAX_PROBES) q = null;
    if (!q) { const sq = staticNext(); if (!sq) { finish(); return; } show(sq, ''); return; }
    show(q, typeof r.lead === 'string' ? r.lead : '');
  } catch (e) {
    clearTimeout(slow); S.ctl = null;
    S.mode = 'standard';
    let f;
    if (e && e.name === 'AbortError') f = { kind: 'skipped', code: 'user_skipped', detail: 'The respondent chose to continue with the standard questions' };
    else if (e && e.http) f = { kind: 'server', code: e.code, status: e.upstream || e.http, detail: e.detail };
    else f = { kind: 'network', code: 'network', detail: 'The browser could not reach ' + (API || 'the server') + ' from ' + location.origin + (e && e.message ? ' (' + e.message + ')' : '') };
    noteFail(f); queueSave();
    S.notice = (f.code === 'user_skipped' ? 'You chose the standard questions for the rest of the survey.'
      : 'The next question could not be written, so the rest of the survey follows the standard set.') + debugLine(f);
    const q = staticNext(); if (!q) { finish(); return; } show(q, '');
  }
}

/* ---------- Rendering ---------- */
function renderRoute() {
  const on = ['question', 'loading', 'contact', 'end'].includes(S.view);
  const done = S.view === 'end' || S.view === 'contact';
  $('route').hidden = !on; if (!on) return;
  const segs = $('segs'); segs.textContent = '';
  const curS = S.view === 'question' && S.current ? S.current.s : (done ? -1 : S.lastS);
  SECTIONS.forEach((n, i) => {
    const items = BANK.filter(b => b.s === i), res = items.filter(b => S.covered.has(b.id)).length;
    segs.append(h('div', { class: 'seg' + (i === curS ? ' cur' : ''), title: n }, h('i', { style: 'width:' + Math.round(res / items.length * 100) + '%' })));
  });
  $('seclabel').textContent = done ? 'Complete' : SECTIONS[Math.max(curS, 0)];
  $('countlabel').textContent = done ? '' : 'Question ' + (S.answers.length + (S.view === 'question' ? 1 : 0));
}
function render() {
  renderRoute();
  const v = $('view'); v.textContent = '';
  v.style.animation = 'none'; void v.offsetWidth; v.style.animation = '';
  ({ intro: renderIntro, question: renderQuestion, loading: renderLoading, contact: renderContact, end: renderEnd }[S.view])(v);
  $('foot').textContent = S.view === 'intro' ? '' : (S.mode === 'adaptive' ? 'Questions written live from your answers' : 'Standard question set');
}
function renderIntro(v) {
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, 'Interview · 5 to 7 minutes'),
    h('h1', null, 'How do you see cars in India?'),
    h('p', null, 'This short interview is about the cars and car brands you know and what you look for in your next one.'),
    h('p', null, 'The questions change as you answer. Each reply shapes the next question. You can add a comment under any question to steer what comes next.'),
    h('p', { class: 'hint' }, 'At the end we ask for your email address, so we can match your answers to you. You choose separately whether we may contact you.'),
    h('div', { class: 'actions' }, h('button', { class: 'primary', id: 'startbtn', type: 'button', onclick: start }, 'Start'))
  ));
}
function renderLoading(v) {
  v.append(h('section', { class: 'card', 'aria-live': 'polite' },
    h('p', { class: 'kicker' }, 'Writing your next question'),
    h('div', { class: 'skel' }, h('i'), h('i'), h('i')),
    h('button', { class: 'link', id: 'slowbtn', type: 'button', hidden: true, onclick: () => S.ctl && S.ctl.abort() }, 'Taking long? Continue with the standard questions')
  ));
}
function renderQuestion(v) {
  const q = S.current, d = S.draft, syncs = [];
  const secName = SECTIONS[q.s != null ? q.s : S.lastS];
  const nextBtn = h('button', { class: 'primary', id: 'next', type: 'button', onclick: onNext });
  const after = BANK.filter(b => !S.covered.has(b.id) && !(q.covers || []).includes(b.id)).length;
  const upd = () => {
    syncs.forEach(f => f());
    const r = readAnswer(q, d); nextBtn.disabled = !r.ok;
    nextBtn.textContent = (!q.req && r.empty) ? 'Skip' : (after === 0 ? 'Finish' : 'Next');
  };
  let body;
  if (q.type === 'single' || q.type === 'multi') {
    const multi = q.type === 'multi';
    const opts = q.options.slice(); if (q.allowOther) opts.push('Other');
    const isSel = o => multi ? d.sel.includes(o) : d.sel === o;
    const list = h('div', { class: 'opts' + (multi ? ' multi' : ''), role: multi ? 'group' : 'radiogroup', 'aria-label': q.text });
    const otherIn = h('input', { class: 'field', id: 'q-other', type: 'text', placeholder: 'Please specify', maxlength: '120', hidden: true, oninput: e => { d.other = e.target.value; upd(); } });
    opts.forEach((o, i) => {
      const input = h('input', { type: multi ? 'checkbox' : 'radio', name: 'opt', id: 'opt-' + i, value: o });
      const row = h('label', { class: 'opt', for: 'opt-' + i }, input, h('span', { class: 'mark', 'aria-hidden': 'true' }), h('span', { class: 'txt' }, o));
      input.addEventListener('change', () => {
        if (!multi) d.sel = o;
        else if (d.sel.includes(o)) d.sel = d.sel.filter(x => x !== o);
        else {
          if (q.max && d.sel.length >= q.max && !EXCL.test(o)) { input.checked = false; return; }
          d.sel = EXCL.test(o) ? [o] : [...d.sel.filter(x => !EXCL.test(x)), o];
        }
        upd();
      });
      syncs.push(() => { const on = isSel(o); input.checked = on; row.classList.toggle('on', on); });
      list.append(row);
    });
    syncs.push(() => { otherIn.hidden = !isSel('Other'); });
    body = [list, otherIn];
  } else if (q.type === 'scale') {
    const picked = h('p', { class: 'picked' });
    const row = h('div', { class: 'scale', role: 'radiogroup', 'aria-label': q.text });
    const btns = [1, 2, 3, 4, 5].map(n => {
      const b = h('button', { type: 'button', class: 'sc', 'aria-label': n + ' – ' + q.labels[n - 1], onclick: () => { d.scale = n; upd(); } }, String(n));
      row.append(b); return b;
    });
    const na = q.naLabel ? h('button', { type: 'button', class: 'na', onclick: () => { d.scale = 'na'; upd(); } }, q.naLabel) : null;
    syncs.push(() => {
      btns.forEach((b, i) => { b.classList.toggle('on', d.scale === i + 1); b.setAttribute('aria-pressed', String(d.scale === i + 1)); });
      if (na) na.classList.toggle('on', d.scale === 'na');
      picked.textContent = typeof d.scale === 'number' ? q.labels[d.scale - 1] : (d.scale === 'na' ? q.naLabel : '');
    });
    body = [row, h('div', { class: 'ends' }, h('span', null, q.labels[0]), h('span', null, q.labels[4])), picked, na];
  } else if (q.type === 'grid') {
    const wrap = h('div', { class: 'grid' });
    q.rows.forEach(r => {
      const cells = h('div', { class: 'cells', role: 'radiogroup', 'aria-label': r });
      const bs = [1, 2, 3, 4, 5].map(n => { const b = h('button', { type: 'button', class: 'cell', 'aria-label': r + ': ' + n + ' – ' + q.labels[n - 1], onclick: () => { d.grid[r] = n; upd(); } }, String(n)); cells.append(b); return b; });
      const nb = h('button', { type: 'button', class: 'cell nacell', 'aria-label': r + ': ' + q.naLabel, onclick: () => { d.grid[r] = 'na'; upd(); } }, q.naLabel); cells.append(nb);
      syncs.push(() => { bs.forEach((b, i) => b.classList.toggle('on', d.grid[r] === i + 1)); nb.classList.toggle('on', d.grid[r] === 'na'); });
      wrap.append(h('div', { class: 'grow' }, h('p', { class: 'rl' }, r), cells));
    });
    body = [h('div', { class: 'ends' }, h('span', null, '1 = ' + q.labels[0]), h('span', null, '5 = ' + q.labels[4])), wrap];
  } else {
    const ta = h('textarea', { class: 'field', id: 'q-text', 'aria-label': q.text, rows: q.long ? '4' : '3', maxlength: '600', placeholder: 'Type your answer', oninput: e => { d.text = e.target.value; upd(); } });
    ta.value = d.text; body = [ta];
  }
  const noteTa = h('textarea', { class: 'field', id: 'q-note', rows: '2', maxlength: '400', oninput: e => { d.note = e.target.value; } });
  noteTa.value = d.note;
  const noteBox = h('div', { class: 'note', hidden: !d.note },
    h('label', { for: 'q-note' }, S.mode === 'adaptive' ? 'Anything to add? It is read before the next question is written.' : 'Anything to add? It is saved with your answers.'), noteTa);
  const noteBtn = h('button', { class: 'link', type: 'button', onclick: () => { noteBox.hidden = !noteBox.hidden; if (!noteBox.hidden) noteTa.focus(); } },
    S.mode === 'adaptive' ? 'Add a comment or steer the next question' : 'Add a comment');
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, String(S.answers.length + 1).padStart(2, '0') + ' · ' + secName),
    S.lead ? h('p', { class: 'lead' }, S.lead) : null,
    h('h2', { class: 'q' }, q.text),
    q.hint ? h('p', { class: 'hint' }, q.hint) : null,
    body,
    noteBtn, noteBox,
    S.notice ? h('p', { class: 'notice' }, S.notice) : null,
    (S.failures.length && S.mode === 'standard') ? h('details', { class: 'tech' }, h('summary', null, 'Technical details'), h('pre', { class: 'detail' }, techText())) : null,
    h('div', { class: 'actions' }, nextBtn)
  ));
  upd();
}
function renderContact(v) {
  const c = S.contact;
  const email = h('input', { class: 'field', id: 'c-email', type: 'email', inputmode: 'email', autocomplete: 'email', maxlength: '254', placeholder: 'name@example.com', 'aria-label': 'Email address' });
  email.value = c.email;
  const box = h('input', { type: 'checkbox', id: 'c-consent', name: 'consent' });
  box.checked = c.consent;
  const row = h('label', { class: 'opt', for: 'c-consent' }, box, h('span', { class: 'mark', 'aria-hidden': 'true' }),
    h('span', { class: 'txt' }, 'You may also contact me at this address about this research (optional).'));
  const save = h('button', { class: 'primary', id: 'c-save', type: 'button', onclick: () => {
    S.contact = { email: email.value.trim(), consent: box.checked }; S.contactSaved = true; S.completed = true; queueSave(); toEnd();
  } }, 'Finish');
  const err = h('p', { class: 'hint', id: 'c-hint' });
  const upd = () => {
    const e = email.value.trim(), ok = validEmail(e);
    save.disabled = !ok; row.classList.toggle('on', box.checked);
    err.textContent = e && !ok ? 'That email address does not look complete.' : '';
  };
  email.addEventListener('input', upd); box.addEventListener('change', upd);
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, 'Last step'),
    h('h1', null, 'Your email address'),
    h('p', null, 'Please enter your email to finish. It is stored separately from your answers and is never shown with them. We contact you only if you tick the box below.'),
    h('label', { class: 'q', for: 'c-email', style: 'font-size:1rem;font-weight:600' }, 'Email address (required)'), email,
    h('div', { class: 'opts multi', style: 'margin-top:12px' }, row), err,
    h('div', { class: 'actions' }, save)
  ));
  upd();
}
function renderEnd(v) {
  v.append(h('section', { class: 'card' },
    h('p', { class: 'kicker' }, 'Complete · ' + S.answers.length + ' questions'),
    h('h1', null, 'Thank you'),
    h('p', null, S.mode === 'adaptive' ? 'Your answers shaped which questions you saw. Here is what you told us.' : 'Here is what you told us.'),
    h('p', { class: 'hint', id: 'savestate' }, saveText()),
    S.contactSaved ? h('p', { class: 'hint' }, S.contact.consent ? 'We have your email and may contact you about this research.' : 'We have your email. We will not contact you.') : null,
    h('ul', { class: 'sum' }, S.answers.map(a => h('li', null, h('span', { class: 'c' }, a.question), h('span', { class: 'a' }, a.display), a.note ? h('span', { class: 'c' }, 'Your comment: ' + a.note) : null))),
    h('div', { class: 'actions' }, h('button', { class: 'ghost', type: 'button', onclick: () => { S.view = 'intro'; render(); } }, 'Start over'))
  ));
}

render();
})();
