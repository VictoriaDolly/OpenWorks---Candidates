// Shared rendering: board, list, candidate profile and the side drawer.
// Used by both the client dashboard and the admin. All data goes through escapeHtml.
import {
  STATUSES, TERMINAL_STATUS, AVAILABILITY_FIELDS, normalizeStatus, sortForList,
  escapeHtml as e, initials, safeUrl, roundScore, formatAvg,
} from './shared.js';

// ---------- Small pieces ----------
export function scorePill(avg, t, { withLabel = false } = {}) {
  if (avg == null) return '';
  const r = roundScore(avg);
  const text = withLabel ? `${formatAvg(avg)} · ${t('score_' + r)}` : formatAvg(avg);
  return `<span class="score-pill score-${r}" title="${e(t('avgScore'))}: ${e(formatAvg(avg))} · ${e(t('score_' + r))}">${e(text)}</span>`;
}

export function statusPill(status) {
  const s = normalizeStatus(status);
  return `<span class="status-pill${s === TERMINAL_STATUS ? ' is-terminal' : ''}">${e(s)}</span>`;
}

const avatar = name => `<span class="avatar" aria-hidden="true">${e(initials(name))}</span>`;

// ---------- Card ----------
export function cardHtml(c, { avg, t }) {
  const email = String(c.email || '').trim();
  const linkedin = safeUrl(c.linkedin);
  const rows = [
    c.location ? `<div class="card-row card-location">${e(c.location)}</div>` : '',
    email ? `<div class="card-row"><a href="mailto:${e(email)}" data-stop>${e(email)}</a></div>` : '',
    linkedin ? `<div class="card-row"><a href="${e(linkedin)}" target="_blank" rel="noopener" data-stop>LinkedIn ↗</a></div>` : '',
  ].join('');
  return `
    <article class="card" data-id="${e(c.id)}" tabindex="0" role="button" aria-label="${e(c.name)}">
      <div class="card-head">
        ${avatar(c.name)}
        <div class="card-name">${e(c.name)}</div>
        ${scorePill(avg, t)}
      </div>
      ${rows ? `<div class="card-body">${rows}</div>` : ''}
    </article>`;
}

// ---------- Board ----------
export function renderBoard(el, candidates, { avgFor = () => null, t, onOpen }) {
  const groups = Object.fromEntries(STATUSES.map(s => [s, []]));
  candidates.forEach(c => groups[normalizeStatus(c.status)].push(c));
  el.innerHTML = `<div class="board">${STATUSES.map(s => `
    <section class="column${s === TERMINAL_STATUS ? ' is-terminal' : ''}">
      <header class="column-head"><span class="status-pill${s === TERMINAL_STATUS ? ' is-terminal' : ''}">${e(s)}</span><span class="column-count">${groups[s].length}</span></header>
      <div class="column-body">
        ${groups[s].map(c => cardHtml(c, { avg: avgFor(c.id), t })).join('') || `<p class="column-empty">${e(t('emptyColumn'))}</p>`}
      </div>
    </section>`).join('')}</div>`;
  bindOpen(el, onOpen);
}

// ---------- List ----------
export function renderList(el, candidates, { avgFor = () => null, t, onOpen }) {
  const rows = sortForList(candidates).map(c => {
    const s = normalizeStatus(c.status);
    const avg = avgFor(c.id);
    return `
      <tr class="list-row${s === TERMINAL_STATUS ? ' is-terminal' : ''}" data-id="${e(c.id)}" tabindex="0" role="button">
        <td><div class="list-candidate">${avatar(c.name)}<span>${e(c.name)}</span></div></td>
        <td class="col-location">${e(c.location || '—')}</td>
        <td>${statusPill(s)}</td>
        <td class="col-avg">${avg == null ? '<span class="muted">—</span>' : scorePill(avg, t, { withLabel: true })}</td>
      </tr>`;
  }).join('');
  el.innerHTML = `
    <div class="list-wrap"><table class="list">
      <thead><tr>
        <th>${e(t('colCandidate'))}</th><th class="col-location">${e(t('colLocation'))}</th>
        <th>${e(t('colStatus'))}</th><th class="col-avg">${e(t('colAvg'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  bindOpen(el, onOpen);
}

function bindOpen(el, onOpen) {
  if (!onOpen) return;
  const handler = ev => {
    if (ev.target.closest('[data-stop]')) return; // links inside a card keep working
    const item = ev.target.closest('[data-id]');
    if (!item) return;
    if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    onOpen(item.dataset.id);
  };
  el.onclick = handler;
  el.onkeydown = handler;
}

// ---------- Profile (everything except feedback, which the caller mounts in #profile-feedback) ----------
export function profileHtml(c, { t }) {
  const sections = [];
  const section = (title, body, cls = '') => `<section class="profile-section ${cls}"><h3>${e(title)}</h3>${body}</section>`;

  const email = String(c.email || '').trim();
  const linkedin = safeUrl(c.linkedin);
  const chips = [
    email ? `<a class="chip" href="mailto:${e(email)}">✉ ${e(email)}</a>` : '',
    linkedin ? `<a class="chip" href="${e(linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : '',
  ].join('');
  if (chips) sections.push(section(t('secContact'), `<div class="chips">${chips}</div>`));

  const resumeUrl = safeUrl(c.resume?.url);
  if (resumeUrl) {
    const label = c.resume.label || t('resumeFile');
    sections.push(section(t('secResume'), `
      <a class="resume-box" href="${e(resumeUrl)}" target="_blank" rel="noopener">
        <span class="resume-icon" aria-hidden="true">📄</span>
        <span class="resume-label">${e(label)}</span>
        <span class="resume-open">${e(t('open'))}</span>
      </a>`));
  }

  const rec = String(c.overallRecommendation || '').trim();
  if (rec) {
    const tone = /reservation/i.test(rec) ? 'is-amber' : 'is-green';
    sections.push(section(t('secRecommendation'), `<span class="rec-badge ${tone}">✔️ ${e(rec)}</span>`));
  }

  const notes = (c.screeningNotes || []).map(n => String(n).trim()).filter(Boolean);
  const consider = String(c.toConsider || '').trim();
  if (notes.length || consider) {
    sections.push(section(t('secNotes'), `
      ${notes.length ? `<ul class="notes">${notes.map(n => `<li>${e(n)}</li>`).join('')}</ul>` : ''}
      ${consider ? `<p class="to-consider"><strong>${e(t('toConsider'))}</strong> ${e(consider)}</p>` : ''}`));
  }

  const av = c.availability || {};
  const avRows = AVAILABILITY_FIELDS.filter(k => String(av[k] || '').trim())
    .map(k => `<div class="av-row"><strong>${e(t('av_' + k))}:</strong> ${e(av[k])}</div>`).join('');
  if (avRows) sections.push(section(t('secAvailability'), `<div class="av">${avRows}</div>`));

  return `
    <div class="profile-head">
      ${avatar(c.name)}
      <div>
        <h2>${e(c.name)}</h2>
        <div class="profile-sub">${c.location ? `<span>${e(c.location)}</span>` : ''}${statusPill(c.status)}</div>
      </div>
    </div>
    <div class="profile-extra" id="profile-extra"></div>
    ${sections.join('')}
    <div id="profile-feedback"></div>`;
}

// ---------- Drawer ----------
let drawerOnClose = null;
export function openDrawer(html, { closeLabel = 'Close', onClose } = {}) {
  closeDrawer(true);
  drawerOnClose = onClose || null;
  const wrap = document.createElement('div');
  wrap.className = 'drawer-wrap';
  wrap.innerHTML = `
    <div class="drawer-overlay" data-close></div>
    <aside class="drawer" role="dialog" aria-modal="true">
      <button class="drawer-close" type="button" data-close aria-label="${e(closeLabel)}">✕</button>
      <div class="drawer-content">${html}</div>
    </aside>`;
  wrap.addEventListener('click', ev => { if (ev.target.closest('[data-close]')) closeDrawer(); });
  document.body.appendChild(wrap);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => wrap.classList.add('is-open'));
  wrap.querySelector('.drawer-close').focus({ preventScroll: true });
  return wrap.querySelector('.drawer-content');
}

export function closeDrawer(silent = false) {
  const wrap = document.querySelector('.drawer-wrap');
  if (!wrap) return;
  wrap.remove();
  document.body.classList.remove('no-scroll');
  const cb = drawerOnClose; drawerOnClose = null;
  if (!silent && cb) cb();
}

export const drawerContent = () => document.querySelector('.drawer-content');

document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeDrawer(); });

// ---------- Toasts ----------
export function toast(message, type = 'ok') {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.classList.add('is-leaving'), type === 'error' ? 5200 : 2800);
  setTimeout(() => el.remove(), type === 'error' ? 5600 : 3200);
}
