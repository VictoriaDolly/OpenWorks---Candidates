// Client dashboard: /?p=SLUG → password gate → read-only board/list + interview feedback.
import { isSupabaseConfigured } from './config.js';
import { escapeHtml as e, hashPassword, normalizeStatus, storage, supabaseFetch } from './shared.js';
import { t, getLang, setLang } from './i18n.js';
import { renderBoard, renderList, profileHtml, openDrawer, closeDrawer } from './board.js';
import { FeedbackModel, clientAdapter, mountFeedback } from './feedback.js';
import { demoApi } from './demo.js';

const app = document.getElementById('app');

// Rescue: a Supabase magic link that landed on the site root belongs to the admin.
if (/(^|[#&])(access_token|error_code)=/.test(location.hash) && !new URLSearchParams(location.search).get('p')) {
  location.replace('/admin/' + location.hash);
  throw new Error('redirecting to admin');
}

const slug = (new URLSearchParams(location.search).get('p') || '').trim();
const unlockKey = `ow_unlock_${slug}`;

// The database checks the password: we only ever receive data with the right hash.
const api = isSupabaseConfigured() ? {
  salt: s => supabaseFetch('rest/v1/rpc/pipeline_salt', { method: 'POST', body: { p_slug: s } }),
  pipeline: (s, hash) => supabaseFetch('rest/v1/rpc/get_pipeline', { method: 'POST', body: { p_slug: s, p_hash: hash } }),
} : demoApi;

const state = {
  salt: null,
  hash: null,
  pipeline: null,
  view: storage.get('ow_view') === 'list' ? 'list' : 'board',
  openId: null,
  feedback: null,
  screen: null, // function that re-renders the current screen (used when language changes)
};

// ---------- Shared bits ----------
const langToggle = () => `
  <div class="seg" role="group" aria-label="Language">
    <button type="button" data-lang="en" class="${getLang() === 'en' ? 'is-active' : ''}">EN</button>
    <button type="button" data-lang="es" class="${getLang() === 'es' ? 'is-active' : ''}">ES</button>
  </div>`;

function messageScreen(title, body) {
  state.screen = () => messageScreen(title, body);
  app.innerHTML = `
    <main class="screen">
      <div class="screen-card">
        <img class="screen-logo" src="/assets/logo-color.png" alt="OpenWorks">
        <h1>${e(t(title))}</h1>
        ${body ? `<p class="muted">${e(t(body))}</p>` : ''}
        <div class="screen-lang">${langToggle()}</div>
      </div>
    </main>`;
}

function gateScreen(error = '') {
  state.screen = () => gateScreen(error);
  app.innerHTML = `
    <main class="screen">
      <form class="screen-card gate" novalidate>
        <img class="screen-logo" src="/assets/logo-color.png" alt="OpenWorks">
        <h1>${e(t('gateTitle'))}</h1>
        <p class="muted">${e(t('gateBody'))}</p>
        <label class="sr-only" for="pw">${e(t('password'))}</label>
        <input class="input" id="pw" type="password" autocomplete="current-password" placeholder="${e(t('password'))}" required>
        ${error ? `<p class="form-error" role="alert">${e(t(error))}</p>` : ''}
        <button class="btn btn-primary btn-block" type="submit">${e(t('unlock'))}</button>
        <div class="screen-lang">${langToggle()}</div>
      </form>
    </main>`;
  const form = app.querySelector('form');
  const input = form.querySelector('#pw');
  input.focus();
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const pw = input.value.trim();
    if (!pw) return;
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = t('checking');
    try {
      const hash = await hashPassword(state.salt, pw);
      const pipeline = await api.pipeline(slug, hash);
      if (!pipeline) return gateScreen('wrongPassword');
      storage.set(unlockKey, hash, sessionStorage);
      showPipeline(hash, pipeline);
    } catch (err) {
      console.warn(err);
      gateScreen('loadError');
    }
  });
}

// ---------- Dashboard ----------
function showPipeline(hash, pipeline) {
  state.hash = hash;
  state.pipeline = pipeline;
  pipeline.candidates = (pipeline.candidates || []).map(c => ({ ...c, status: normalizeStatus(c.status) }));
  document.title = `${pipeline.clientName} · ${pipeline.roleTitle || 'Candidates'} · OpenWorks`;
  if (isSupabaseConfigured()) {
    state.feedback = new FeedbackModel(clientAdapter({ slug, hash }));
    state.feedback.subscribe(renderView); // averages on cards/list follow new notes
    state.feedback.load();
  }
  dashboardScreen();
}

function dashboardScreen() {
  state.screen = dashboardScreen;
  const p = state.pipeline;
  const n = p.candidates.length;
  app.innerHTML = `
    <header class="topbar">
      <span class="brand"><img src="/assets/mark-color.png" alt=""><span>OPENWORKS</span></span>
      <div class="topbar-controls">
        <div class="seg" role="group" aria-label="View">
          <button type="button" data-view="board" class="${state.view === 'board' ? 'is-active' : ''}">${e(t('board'))}</button>
          <button type="button" data-view="list" class="${state.view === 'list' ? 'is-active' : ''}">${e(t('list'))}</button>
        </div>
        ${langToggle()}
      </div>
      <div class="topbar-title">
        <strong>${e(p.clientName)}</strong>
        ${p.roleTitle ? `<span>${e(p.roleTitle)}</span>` : ''}
      </div>
    </header>
    <main class="page">
      <p class="page-meta muted">${e(n === 1 ? t('candidatesOne') : t('candidatesMany', { n }))}</p>
      <div id="view"></div>
    </main>`;
  renderView();
  if (state.openId) openProfile(state.openId);
}

function renderView() {
  const el = document.getElementById('view');
  if (!el) return;
  const p = state.pipeline;
  if (!p.candidates.length) { el.innerHTML = `<div class="empty">${e(t('emptyPipeline'))}</div>`; return; }
  const opts = { t, onOpen: openProfile, avgFor: id => state.feedback?.avgFor(id) ?? null };
  state.view === 'list' ? renderList(el, p.candidates, opts) : renderBoard(el, p.candidates, opts);
}

function openProfile(id) {
  const c = state.pipeline.candidates.find(x => x.id === id);
  if (!c) return;
  state.openId = id;
  const content = openDrawer(profileHtml(c, { t }), { closeLabel: t('close'), onClose: () => { state.openId = null; } });
  if (state.feedback) mountFeedback(content.querySelector('#profile-feedback'), state.feedback, c, { t, locale: getLang() });
}

// ---------- Global controls ----------
app.addEventListener('click', ev => {
  const langBtn = ev.target.closest('[data-lang]');
  if (langBtn && langBtn.dataset.lang !== getLang()) {
    setLang(langBtn.dataset.lang);
    const openId = state.openId;
    closeDrawer(true);
    state.openId = openId;
    state.screen?.();
    return;
  }
  const viewBtn = ev.target.closest('[data-view]');
  if (viewBtn && viewBtn.dataset.view !== state.view) {
    state.view = viewBtn.dataset.view;
    storage.set('ow_view', state.view);
    app.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === state.view));
    renderView();
  }
});

// ---------- Start ----------
async function start() {
  if (!slug) return messageScreen('noRefTitle', 'noRefBody');
  try {
    state.salt = await api.salt(slug);
    if (!state.salt) return messageScreen('notFoundTitle', 'notFoundBody');
    const saved = storage.get(unlockKey, sessionStorage);
    if (saved) {
      const pipeline = await api.pipeline(slug, saved);
      if (pipeline) return showPipeline(saved, pipeline);
      storage.remove(unlockKey, sessionStorage); // password was changed
    }
    gateScreen();
  } catch (err) {
    console.warn(err);
    messageScreen('notFoundTitle', 'loadError');
  }
}

start();
