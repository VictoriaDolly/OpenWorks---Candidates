// OpenWorks admin: pipelines, candidates, resumes, publishing and client feedback.
import { isSupabaseConfigured, siteUrl } from '../js/config.js';
import {
  STATUSES, RECOMMENDATIONS, AVAILABILITY_FIELDS, escapeHtml as e, hashPassword, slugify,
  randomToken, uuid, storage, safeUrl,
} from '../js/shared.js';
import { tEn as t } from '../js/i18n.js';
import { renderBoard, profileHtml, openDrawer, closeDrawer, toast } from '../js/board.js';
import { FeedbackModel, mountFeedback } from '../js/feedback.js';
import * as auth from './auth.js';
import * as store from './store.js';

const app = document.getElementById('app');
const state = { email: '', pipelines: [], current: null }; // current = { pipeline, candidates, feedback }

// ---------- Helpers ----------
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateTime = iso => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const clientUrl = slug => `${siteUrl()}/?p=${encodeURIComponent(slug)}`;
const pwKey = slug => `ow_pw_${slug}`;
const go = hash => { if (location.hash === hash) route(); else location.hash = hash; };
const main = () => document.getElementById('main');

const WORDS = ['amber', 'aspen', 'birch', 'brook', 'canyon', 'cedar', 'cliff', 'clover', 'coral', 'cove', 'delta', 'dune',
  'ember', 'fern', 'field', 'fjord', 'forest', 'glade', 'granite', 'harbor', 'hazel', 'heron', 'island', 'ivy', 'juniper',
  'lagoon', 'lake', 'laurel', 'maple', 'meadow', 'mesa', 'moss', 'oak', 'ocean', 'olive', 'orchid', 'pebble', 'pine',
  'prairie', 'quartz', 'raven', 'reef', 'ridge', 'river', 'robin', 'sage', 'sierra', 'slate', 'spruce', 'stone', 'summit',
  'sunset', 'thistle', 'tide', 'timber', 'valley', 'willow', 'wren', 'zephyr', 'atlas', 'beacon', 'comet', 'harvest'];
function generatePassword() {
  const n = crypto.getRandomValues(new Uint32Array(3));
  return `${WORDS[n[0] % WORDS.length]}-${WORDS[n[1] % WORDS.length]}-${100 + (n[2] % 900)}`;
}

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { prompt('Copy this:', text); }
}

function handleError(err, fallback = 'Something went wrong.') {
  console.error(err);
  if (err?.status === 401 || /jwt|session expired/i.test(err?.message || '')) {
    auth.clearSession();
    toast('Your session expired — please sign in again.', 'error');
    return loginView();
  }
  toast(err?.message || fallback, 'error');
}

// Wraps a button action: disables it while running and reports errors.
async function busy(btn, label, fn) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = label;
  try { return await fn(); }
  catch (err) { handleError(err); }
  finally { if (btn.isConnected) { btn.disabled = false; btn.textContent = old; } }
}

// ---------- Login ----------
function loginView(error = '') {
  closeDrawer(true);
  app.innerHTML = `
    <main class="screen">
      <form class="screen-card" novalidate>
        <img class="screen-logo" src="/assets/logo-color.png" alt="OpenWorks">
        <h1>Admin sign-in</h1>
        <p class="muted">We'll email you a one-time sign-in link.</p>
        <label class="sr-only" for="email">Email</label>
        <input class="input" id="email" type="email" autocomplete="email" placeholder="you@company.com" required>
        <p class="form-error" role="alert"${error ? '' : ' hidden'}>${e(error)}</p>
        <button class="btn btn-primary btn-block" type="submit">Send magic link</button>
        <p class="muted login-note">Open the link on this same device and browser.</p>
      </form>
    </main>`;
  const form = app.querySelector('form');
  const errEl = form.querySelector('.form-error');
  form.email.focus();
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const email = form.email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { errEl.hidden = false; errEl.textContent = 'Enter a valid email address.'; return; }
    const btn = form.querySelector('button');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await auth.requestMagicLink(email);
      form.innerHTML = `
        <img class="screen-logo" src="/assets/logo-color.png" alt="OpenWorks">
        <h1>Check your inbox</h1>
        <p class="muted">We sent a sign-in link to <strong>${e(email)}</strong>. Open it on this device to enter the admin.</p>
        <button class="btn-link" type="button" data-again>Use a different email</button>`;
      form.querySelector('[data-again]').onclick = () => loginView();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Send magic link';
      errEl.hidden = false; errEl.textContent = err.message;
    }
  });
}

// ---------- Shell ----------
function shell() {
  if (document.querySelector('.admin-shell')) return;
  app.innerHTML = `
    <div class="admin-shell">
      <aside class="sidebar">
        <a class="brand is-white side-brand" href="#/"><img src="/assets/mark-white.png" alt=""><span>OPENWORKS</span></a>
        <button class="side-toggle" type="button" aria-expanded="false">Menu</button>
        <nav class="side-menu">
          <a href="#/" data-nav="all">All Pipelines</a>
          <a href="#/new" class="side-new" data-nav="new">+ New Pipeline</a>
          <div class="side-label">Pipelines</div>
          <div class="side-pipelines"></div>
          <div class="side-foot">Signed in as ${e(state.email)} · <button type="button" data-signout>Sign out</button></div>
        </nav>
      </aside>
      <main class="admin-main" id="main"></main>
    </div>`;
  const sidebar = app.querySelector('.sidebar');
  sidebar.querySelector('.side-toggle').onclick = ev => {
    const open = sidebar.classList.toggle('is-open');
    ev.currentTarget.setAttribute('aria-expanded', open);
  };
  sidebar.querySelector('[data-signout]').onclick = async () => { await auth.signOut(); loginView(); };
  sidebar.addEventListener('click', ev => { if (ev.target.closest('a')) sidebar.classList.remove('is-open'); });
}

function renderSidebar(activeSlug = '', nav = '') {
  const list = document.querySelector('.side-pipelines');
  if (!list) return;
  list.innerHTML = state.pipelines.map(p => `
    <a href="#/p/${encodeURIComponent(p.slug)}" class="${p.slug === activeSlug ? 'is-active' : ''}">
      ${e(p.clientName)}<small>${e(p.roleTitle || p.slug)}</small>
    </a>`).join('') || '<span class="side-label" style="text-transform:none;letter-spacing:0">No pipelines yet</span>';
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('is-active', a.dataset.nav === nav));
}

async function refreshPipelines() {
  state.pipelines = await store.listPipelines();
}

// ---------- Router ----------
async function route() {
  closeDrawer(true);
  shell();
  const [section, slug, sub, id] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  try {
    if (section === 'new') return pipelineForm(null);
    if (section === 'p' && slug) {
      if (sub === 'edit') return pipelineForm(slug);
      if (sub === 'import') return importView(slug);
      if (sub === 'candidate') return candidateForm(slug, id === 'new' ? null : id);
      return detailView(slug);
    }
    return listView();
  } catch (err) {
    handleError(err, 'Could not load this page.');
    if (main()) main().innerHTML = `<div class="panel"><p>Could not load this page.</p><p class="muted">${e(err.message)}</p></div>`;
  }
}

async function loadPipeline(slug, { force = false } = {}) {
  if (!force && state.current?.pipeline.slug === slug) return state.current;
  const [pipeline, candidates] = await Promise.all([store.getPipeline(slug), store.listCandidates(slug)]);
  if (!pipeline) throw new Error('Pipeline not found. It may have been deleted.');
  const feedback = new FeedbackModel(store.feedbackAdapter(slug));
  state.current = { pipeline, candidates, feedback };
  feedback.load();
  return state.current;
}

// ---------- All pipelines ----------
async function listView() {
  main().innerHTML = '<p class="loading">Loading pipelines…</p>';
  await refreshPipelines();
  renderSidebar('', 'all');
  const rows = state.pipelines.map(p => `
    <tr>
      <td><strong><a href="#/p/${encodeURIComponent(p.slug)}">${e(p.clientName)}</a></strong><small>${e(p.slug)}</small></td>
      <td>${e(p.roleTitle || '—')}</td>
      <td>${p.candidateCount}</td>
      <td>${fmtDate(p.updatedAt)}${p.publishedAt ? '' : '<small>Not published</small>'}</td>
      <td><div class="actions">
        <button class="btn btn-small" data-copy="${e(p.slug)}">Copy Link</button>
        <a class="btn btn-small" href="#/p/${encodeURIComponent(p.slug)}">Open</a>
        <button class="btn btn-small btn-danger" data-delete="${e(p.slug)}">Delete</button>
      </div></td>
    </tr>`).join('');
  main().innerHTML = `
    <div class="admin-head">
      <div><h1>All Pipelines</h1><div class="sub">One pipeline per client and role.</div></div>
      <div class="admin-actions"><a class="btn btn-primary" href="#/new">+ New Pipeline</a></div>
    </div>
    ${state.pipelines.length ? `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Client</th><th>Role</th><th>Candidates</th><th>Updated</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : `<div class="empty">No pipelines yet. Create the first one with “+ New Pipeline”.</div>`}`;
  main().onclick = async ev => {
    const c = ev.target.closest('[data-copy]');
    if (c) return copy(clientUrl(c.dataset.copy), 'Link copied');
    const d = ev.target.closest('[data-delete]');
    if (d) {
      const p = state.pipelines.find(x => x.slug === d.dataset.delete);
      if (!confirm(`Delete “${p.clientName} — ${p.roleTitle}”?\n\nThis permanently removes its candidates, resumes and client feedback. The client link will stop working.`)) return;
      await busy(d, 'Deleting…', async () => {
        await store.deletePipeline(p.slug);
        if (state.current?.pipeline.slug === p.slug) state.current = null;
        toast('Pipeline deleted');
        await listView();
      });
    }
  };
}

// ---------- New / edit pipeline ----------
async function pipelineForm(slug) {
  const isNew = !slug;
  const p = isNew ? null : (await loadPipeline(slug, { force: true })).pipeline;
  if (!state.pipelines.length) await refreshPipelines();
  renderSidebar(slug || '', isNew ? 'new' : '');
  const suffix = randomToken(4);
  main().innerHTML = `
    <div class="admin-head">
      <div><h1>${isNew ? 'New Pipeline' : 'Edit Pipeline'}</h1><div class="sub">${isNew ? 'One client + one role per link.' : e(p.slug)}</div></div>
    </div>
    <form class="form" novalidate>
      <fieldset>
        <div class="grid-2">
          <label class="field"><span>Client Name *</span><input class="input" name="clientName" required maxlength="120" value="${e(p?.clientName || '')}"></label>
          <label class="field"><span>Role Title</span><input class="input" name="roleTitle" maxlength="120" value="${e(p?.roleTitle || '')}"></label>
        </div>
        <label class="field"><span>Link ID (slug)</span>
          <input class="input" name="slug" value="${e(p?.slug || '')}" readonly>
          <small>${isNew ? 'Generated from the client and role. It can’t be changed later.' : 'Can’t be changed.'}</small>
        </label>
        <label class="field"><span>${isNew ? 'Password *' : 'New password'}</span>
          <div class="input-row">
            <input class="input" name="password" autocomplete="off" spellcheck="false" placeholder="${isNew ? '' : 'Leave empty to keep the current password'}">
            <button class="btn" type="button" data-generate>Generate</button>
          </div>
          <small>Share it with the client together with the link. It’s shown only in this session; afterwards it can only be reset.</small>
        </label>
      </fieldset>
      <div class="form-actions">
        <a class="btn" href="${isNew ? '#/' : `#/p/${encodeURIComponent(slug)}`}">Cancel</a>
        <button class="btn btn-primary" type="submit">${isNew ? 'Create Pipeline' : 'Save Changes'}</button>
      </div>
    </form>`;
  const form = main().querySelector('form');
  const updateSlug = () => {
    if (!isNew) return;
    const base = slugify(`${form.clientName.value} ${form.roleTitle.value}`);
    form.slug.value = base ? `${base}-${suffix}` : '';
  };
  form.clientName.oninput = updateSlug;
  form.roleTitle.oninput = updateSlug;
  form.querySelector('[data-generate]').onclick = () => { form.password.value = generatePassword(); };
  if (isNew) form.password.value = generatePassword();
  form.clientName.focus();

  form.onsubmit = async ev => {
    ev.preventDefault();
    const clientName = form.clientName.value.trim();
    const roleTitle = form.roleTitle.value.trim();
    const password = form.password.value.trim();
    if (!clientName) { toast('Client Name is required.', 'error'); return form.clientName.focus(); }
    if (isNew && !password) { toast('Set a password (use Generate).', 'error'); return form.password.focus(); }
    if (password && password.length < 6) { toast('Use at least 6 characters for the password.', 'error'); return form.password.focus(); }
    await busy(form.querySelector('[type="submit"]'), 'Saving…', async () => {
      const salt = password ? randomToken(16) : null;
      const passwordHash = password ? await hashPassword(salt, password) : null;
      let saved;
      if (isNew) {
        saved = await store.createPipeline({ slug: form.slug.value, clientName, roleTitle, passwordHash, salt });
      } else {
        saved = await store.updatePipeline(slug, { clientName, roleTitle, passwordHash, salt });
        if (password) storage.remove(`ow_unlock_${slug}`, sessionStorage);
      }
      if (password) storage.set(pwKey(saved.slug), password, sessionStorage);
      state.current = null;
      await refreshPipelines();
      toast(isNew ? 'Pipeline created' : (password ? 'Saved — the new password works right away' : 'Saved'));
      go(`#/p/${encodeURIComponent(saved.slug)}`);
    });
  };
}

// ---------- Pipeline detail ----------
async function detailView(slug) {
  main().innerHTML = '<p class="loading">Loading pipeline…</p>';
  const cur = await loadPipeline(slug, { force: true });
  if (!state.pipelines.length) await refreshPipelines();
  renderSidebar(slug);
  renderDetail();
  cur.feedback.subscribe(() => { if (state.current === cur) renderDetailBoard(); });
}

function publishBadge() {
  const { pipeline, candidates } = state.current;
  if (!pipeline.publishedAt) return '<span class="badge badge-muted">Not published yet</span>';
  if (store.hasUnpublishedChanges(pipeline, candidates)) return `<span class="badge badge-warn">Unpublished changes</span>`;
  return `<span class="badge badge-ok">Published · ${e(fmtDateTime(pipeline.publishedAt))}</span>`;
}

function renderDetail() {
  const { pipeline: p } = state.current;
  const url = clientUrl(p.slug);
  const pw = storage.get(pwKey(p.slug), sessionStorage);
  const base = `#/p/${encodeURIComponent(p.slug)}`;
  main().innerHTML = `
    <div class="admin-head">
      <div>
        <h1>${e(p.clientName)}</h1>
        <div class="sub">${e(p.roleTitle || '')} <span id="publish-badge">${publishBadge()}</span></div>
      </div>
      <div class="admin-actions">
        <a class="btn" href="${base}/edit">Edit Pipeline</a>
        <button class="btn btn-primary" data-publish>Publish to Client Link</button>
        <a class="btn" href="${base}/import">Import from JSON</a>
        <a class="btn" href="${base}/candidate/new">+ Add Candidate</a>
      </div>
    </div>
    <div class="link-box">
      <div class="row"><span class="label">Link</span><a href="${e(url)}" target="_blank" rel="noopener">${e(url)}</a></div>
      <div class="row"><span class="label">Password</span>${pw ? `<code>${e(pw)}</code>` : '<span class="muted">hidden — reset via Edit Pipeline</span>'}</div>
      <div class="row">
        <button class="btn btn-small" data-copy-link>Copy Link</button>
        <button class="btn btn-small" data-copy-both>Copy Link + Password</button>
        ${p.publishedAt ? '' : '<span class="muted" style="font-size:13px">The link works after the first Publish.</span>'}
      </div>
    </div>
    <div id="admin-board"></div>`;
  renderDetailBoard();

  main().onclick = async ev => {
    if (ev.target.closest('[data-copy-link]')) return copy(url, 'Link copied');
    if (ev.target.closest('[data-copy-both]')) {
      const pwNow = storage.get(pwKey(p.slug), sessionStorage);
      if (!pwNow) return toast('The password is hidden. Reset it via Edit Pipeline to copy it.', 'error');
      return copy(`Candidates for ${p.roleTitle || p.clientName} — OpenWorks\nLink: ${url}\nPassword: ${pwNow}`, 'Link and password copied');
    }
    const pub = ev.target.closest('[data-publish]');
    if (pub) {
      await busy(pub, 'Publishing…', async () => {
        const cur = state.current;
        cur.pipeline = await store.publish(cur.pipeline, cur.candidates);
        toast(`Published — the client now sees ${cur.candidates.length} candidate${cur.candidates.length === 1 ? '' : 's'}`);
        renderDetail();
      });
    }
  };
}

function renderDetailBoard() {
  const el = document.getElementById('admin-board');
  if (!el) return;
  const { candidates, feedback } = state.current;
  const badge = document.getElementById('publish-badge');
  if (badge) badge.innerHTML = publishBadge();
  if (!candidates.length) {
    el.innerHTML = `<div class="empty">No candidates yet. Use “+ Add Candidate” or “Import from JSON”.</div>`;
    return;
  }
  renderBoard(el, candidates, { t, avgFor: id => feedback.avgFor(id), onOpen: openCandidate });
}

function openCandidate(id) {
  const cur = state.current;
  const c = cur.candidates.find(x => x.id === id);
  if (!c) return;
  const content = openDrawer(profileHtml(c, { t }), { closeLabel: 'Close' });
  content.querySelector('#profile-extra').innerHTML = `
    <div class="stage-select">
      <label for="stage"><strong>Stage</strong></label>
      <select class="input" id="stage">${STATUSES.map(s => `<option${s === c.status ? ' selected' : ''}>${e(s)}</option>`).join('')}</select>
      <a class="btn btn-small" href="#/p/${encodeURIComponent(c.pipelineSlug)}/candidate/${encodeURIComponent(c.id)}">Edit</a>
      <button class="btn btn-small btn-danger" type="button" data-del>Delete</button>
    </div>`;
  content.querySelector('#stage').onchange = async ev => {
    const select = ev.target;
    select.disabled = true;
    try {
      const saved = await store.setCandidateStatus(c.id, select.value);
      Object.assign(c, saved);
      toast(`Moved to ${saved.status} — Publish to update the client link`);
      renderDetailBoard();
      openCandidate(c.id);
    } catch (err) { handleError(err); select.value = c.status; }
    finally { select.disabled = false; }
  };
  content.querySelector('[data-del]').onclick = async ev => {
    if (!confirm(`Delete ${c.name}?\n\nThis removes the candidate, their resume file and client feedback. Publish afterwards to remove them from the client link.`)) return;
    await busy(ev.currentTarget, 'Deleting…', async () => {
      await store.deleteCandidate(c);
      cur.candidates = cur.candidates.filter(x => x.id !== c.id);
      closeDrawer(true);
      toast('Candidate deleted — Publish to update the client link');
      renderDetailBoard();
    });
  };
  mountFeedback(content.querySelector('#profile-feedback'), cur.feedback, c, { t, locale: 'en-US' });
}

// ---------- Candidate form ----------
async function candidateForm(slug, id) {
  const cur = await loadPipeline(slug);
  renderSidebar(slug);
  const existing = id ? cur.candidates.find(c => c.id === id) : null;
  if (id && !existing) throw new Error('Candidate not found.');
  const c = existing ? structuredClone(existing) : {
    id: uuid(), pipelineSlug: slug, name: '', location: '', email: '', linkedin: '', status: STATUSES[0],
    resume: null, overallRecommendation: RECOMMENDATIONS[0], screeningNotes: [], toConsider: '', availability: {},
  };
  const av = c.availability || {};
  const avLabels = { motivation: 'Motivation to change', noticePeriod: 'Notice period', otherProcesses: 'Other hiring processes',
    vacationPlans: 'Vacation / migration plans', visaStatus: 'Visa status', salaryExpectations: 'Salary expectations' };
  const recOptions = [...RECOMMENDATIONS, ...(c.overallRecommendation && !RECOMMENDATIONS.includes(c.overallRecommendation) ? [c.overallRecommendation] : [])];
  const back = `#/p/${encodeURIComponent(slug)}`;

  main().innerHTML = `
    <div class="admin-head">
      <div><h1>${existing ? 'Edit Candidate' : 'Add Candidate'}</h1><div class="sub">${e(cur.pipeline.clientName)} · ${e(cur.pipeline.roleTitle || '')}</div></div>
      <div class="admin-actions"><a class="btn" href="${back}/import">Import from JSON instead</a></div>
    </div>
    <form class="form" novalidate>
      <fieldset>
        <legend>Card (from the Resume)</legend>
        <div class="grid-2">
          <label class="field"><span>Name *</span><input class="input" name="name" required maxlength="120" value="${e(c.name)}" placeholder="Chineye (Chi) Nnorom"></label>
          <label class="field"><span>Location</span><input class="input" name="location" maxlength="120" value="${e(c.location)}" placeholder="Atlanta, Georgia"></label>
          <label class="field"><span>Email</span><input class="input" name="email" type="email" maxlength="160" value="${e(c.email)}"></label>
          <label class="field"><span>LinkedIn</span><input class="input" name="linkedin" maxlength="300" value="${e(c.linkedin)}" placeholder="https://www.linkedin.com/in/…"></label>
        </div>
        <label class="field"><span>Status</span>
          <select class="input" name="status">${STATUSES.map(s => `<option${s === c.status ? ' selected' : ''}>${e(s)}</option>`).join('')}</select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Resume</legend>
        <div class="resume-current" id="resume-current"></div>
        <div class="input-row">
          <label class="btn" style="flex:none">Upload PDF<input type="file" accept="application/pdf,.pdf" name="resumeFile" hidden></label>
          <input class="input" name="resumeUrl" placeholder="…or paste a link to the resume" value="${e(c.resume?.url || '')}">
        </div>
        <label class="field"><span>File name shown to the client</span><input class="input" name="resumeLabel" maxlength="120" value="${e(c.resume?.label || '')}" placeholder="Resume.pdf"></label>
      </fieldset>

      <fieldset>
        <legend>Candidate Highlights</legend>
        <label class="field"><span>Overall Recommendation</span>
          <select class="input" name="overallRecommendation">${recOptions.map(r => `<option${r === c.overallRecommendation ? ' selected' : ''}>${e(r)}</option>`).join('')}</select>
        </label>
        <div class="field"><span>Screening Notes (one bullet per line)</span>
          <div class="bullets" id="bullets"></div>
          <div><button class="btn btn-small" type="button" data-add-bullet>+ Add bullet</button></div>
          <small>Tip: pasting several lines into a bullet splits them into separate bullets.</small>
        </div>
        <label class="field"><span>To consider (optional)</span><textarea class="input" name="toConsider" rows="3" maxlength="3000">${e(c.toConsider)}</textarea></label>
      </fieldset>

      <fieldset>
        <legend>Availability &amp; Expectations</legend>
        <div class="grid-2">
          ${AVAILABILITY_FIELDS.map(k => `<label class="field"><span>${e(avLabels[k])}</span><input class="input" name="av_${k}" maxlength="500" value="${e(av[k] || '')}"></label>`).join('')}
        </div>
      </fieldset>

      <div class="form-actions">
        <a class="btn" href="${back}">Cancel</a>
        <button class="btn btn-primary" type="submit">${existing ? 'Save Candidate' : 'Add Candidate'}</button>
      </div>
    </form>`;

  const form = main().querySelector('form');

  // Resume preview
  const renderResume = () => {
    const url = safeUrl(form.resumeUrl.value);
    document.getElementById('resume-current').innerHTML = url
      ? `📄 <a href="${e(url)}" target="_blank" rel="noopener">${e(form.resumeLabel.value || 'Resume')} ↗</a>`
      : '<span class="muted">No resume yet — upload the PDF or paste a link.</span>';
  };
  form.resumeUrl.oninput = renderResume;
  form.resumeLabel.oninput = renderResume;
  renderResume();
  form.resumeFile.onchange = async () => {
    const file = form.resumeFile.files[0];
    if (!file) return;
    const label = form.querySelector('label.btn');
    label.style.opacity = '.6';
    document.getElementById('resume-current').innerHTML = '<span class="muted">Uploading…</span>';
    try {
      const up = await store.uploadResume(slug, c.id, file);
      form.resumeUrl.value = up.url;
      form.resumeLabel.value = up.label;
      toast('Resume uploaded');
    } catch (err) { handleError(err, 'Upload failed.'); }
    finally { label.style.opacity = ''; form.resumeFile.value = ''; renderResume(); }
  };

  // Screening-note bullets
  const bullets = document.getElementById('bullets');
  const addBullet = (value = '', focus = false, after = null) => {
    const row = document.createElement('div');
    row.className = 'bullet-row';
    row.innerHTML = `<input class="input" maxlength="600"><button class="icon-btn" type="button" title="Remove bullet" aria-label="Remove bullet">✕</button>`;
    const input = row.querySelector('input');
    input.value = value;
    after ? after.after(row) : bullets.appendChild(row);
    if (focus) input.focus();
    return row;
  };
  (c.screeningNotes.length ? c.screeningNotes : ['']).forEach(n => addBullet(n));
  form.querySelector('[data-add-bullet]').onclick = () => addBullet('', true);
  bullets.addEventListener('click', ev => {
    const x = ev.target.closest('.icon-btn');
    if (!x) return;
    x.closest('.bullet-row').remove();
    if (!bullets.children.length) addBullet('');
  });
  bullets.addEventListener('paste', ev => {
    const input = ev.target.closest('input');
    const pasted = ev.clipboardData?.getData('text') || '';
    const lines = pasted.split(/\r?\n/).map(l => l.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
    if (!input || lines.length < 2) return;
    ev.preventDefault();
    let row = input.closest('.bullet-row');
    const startEmpty = !input.value.trim();
    lines.forEach((line, i) => {
      if (i === 0 && startEmpty) { input.value = line; return; }
      row = addBullet(line, false, row);
    });
  });
  bullets.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && ev.target.matches('input')) { ev.preventDefault(); addBullet('', true, ev.target.closest('.bullet-row')); }
  });

  form.name.focus();
  form.onsubmit = async ev => {
    ev.preventDefault();
    const name = form.name.value.trim();
    if (!name) { toast('Name is required.', 'error'); return form.name.focus(); }
    const email = form.email.value.trim();
    if (email && !/^\S+@\S+\.\S+$/.test(email)) { toast('That email doesn’t look right.', 'error'); return form.email.focus(); }
    const linkedinRaw = form.linkedin.value.trim();
    const linkedin = linkedinRaw ? safeUrl(linkedinRaw) : '';
    if (linkedinRaw && !linkedin) { toast('The LinkedIn link isn’t a valid URL.', 'error'); return form.linkedin.focus(); }
    const resumeRaw = form.resumeUrl.value.trim();
    const resumeUrl = resumeRaw ? safeUrl(resumeRaw) : '';
    if (resumeRaw && !resumeUrl) { toast('The resume link isn’t a valid URL.', 'error'); return form.resumeUrl.focus(); }
    if (!resumeUrl && !confirm('This candidate has no resume yet. Save anyway?')) return;

    const data = {
      ...c, name, email, linkedin,
      location: form.location.value.trim(),
      status: form.status.value,
      resume: resumeUrl ? { url: resumeUrl, label: form.resumeLabel.value.trim() || 'Resume' } : null,
      overallRecommendation: form.overallRecommendation.value,
      screeningNotes: [...bullets.querySelectorAll('input')].map(i => i.value.trim()).filter(Boolean),
      toConsider: form.toConsider.value.trim(),
      availability: Object.fromEntries(AVAILABILITY_FIELDS.map(k => [k, form[`av_${k}`].value.trim()])),
    };
    await busy(form.querySelector('[type="submit"]'), 'Saving…', async () => {
      const saved = await store.saveCandidate(data, { isNew: !existing });
      // Replaced an uploaded resume → remove the old file.
      if (existing?.resume?.url && existing.resume.url !== saved.resume?.url) store.removeResumeByUrl(existing.resume.url).catch(() => {});
      if (existing) Object.assign(existing, saved); else cur.candidates.push(saved);
      toast(`${saved.name} saved — Publish to update the client link`);
      go(back);
    });
  };
}

// ---------- Import from JSON ----------
async function importView(slug) {
  const cur = await loadPipeline(slug);
  renderSidebar(slug);
  const back = `#/p/${encodeURIComponent(slug)}`;
  main().innerHTML = `
    <div class="admin-head">
      <div><h1>Import from JSON</h1><div class="sub">${e(cur.pipeline.clientName)} · ${e(cur.pipeline.roleTitle || '')}</div></div>
    </div>
    <div class="form">
      <div class="panel">
        <p style="margin-top:0">Paste the JSON from the <strong>OpenWorks Import Assistant</strong> — one candidate or a list. A candidate with the same name in this pipeline is <strong>updated</strong>; otherwise a new one is <strong>created</strong>.</p>
        <p class="muted" style="margin-bottom:0">Upload the Resume PDF afterwards from the candidate’s Edit form.</p>
      </div>
      <textarea class="input code-area" id="json" spellcheck="false" placeholder='[{ "name": "…", "location": "…", "screeningNotes": ["…"] }]'></textarea>
      <div class="form-actions">
        <a class="btn" href="${back}">Cancel</a>
        <button class="btn btn-primary" type="button" data-import>Import</button>
      </div>
    </div>`;
  const area = document.getElementById('json');
  area.focus();
  main().querySelector('[data-import]').onclick = async ev => {
    let items;
    try { items = store.parseImport(area.value); }
    catch (err) { return toast(err.message, 'error'); }
    await busy(ev.currentTarget, 'Importing…', async () => {
      const { created, updated } = await store.importCandidates(slug, items, cur.candidates);
      toast(`Import done: ${created} created, ${updated} updated — Publish to update the client link`);
      go(back);
    });
  };
}

// ---------- Start ----------
async function start() {
  if (!isSupabaseConfigured()) {
    app.innerHTML = `
      <main class="screen"><div class="screen-card">
        <img class="screen-logo" src="/assets/logo-color.png" alt="OpenWorks">
        <h1>Supabase isn’t connected yet</h1>
        <p class="muted">Add SUPABASE_URL and SUPABASE_ANON_KEY in <code>js/config.js</code>.</p>
      </div></main>`;
    return;
  }
  const captured = auth.captureSessionFromUrl();
  if (captured?.error) return loginView(captured.error);
  const session = await auth.getSession();
  if (!session) return loginView();
  try {
    state.email = session.email || await auth.fetchUserEmail(session);
    if (!(await auth.checkIsAdmin(session))) {
      await auth.signOut();
      return loginView(`${state.email} is not authorized for the admin.`);
    }
  } catch (err) {
    auth.clearSession();
    return loginView(err.status === 401 ? 'Your session expired — please sign in again.' : err.message);
  }
  window.addEventListener('hashchange', route);
  route();
}

start();
