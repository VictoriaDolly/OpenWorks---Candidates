// Client feedback: the only thing clients can write.
// Data access goes through an "adapter" so the same UI works for the client (password-checked RPCs)
// and the admin (read-only, signed-in REST).
import { average, escapeHtml as e, browserId, storage, supabaseFetch } from './shared.js';
import { toast } from './board.js';

export class FeedbackModel {
  constructor(adapter) {
    this.adapter = adapter;
    this.notes = [];
    this.error = null;
    this.listeners = new Set();
  }
  get canWrite() { return typeof this.adapter.add === 'function'; }
  async load() {
    try { this.notes = (await this.adapter.list()) || []; this.error = null; }
    catch (err) { this.error = err; console.warn('Feedback load failed:', err.message); }
    this.emit();
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach(fn => fn()); }
  forCandidate(id) { return this.notes.filter(n => n.candidate_id === id); }
  avgFor = id => average(this.forCandidate(id).map(n => n.score));
  stageAvg(id, stage) { return average(this.forCandidate(id).filter(n => n.stage === stage).map(n => n.score)); }
  async add(note) {
    const saved = await this.adapter.add(note);
    this.notes.push(saved);
    this.emit();
  }
  async remove(id) {
    await this.adapter.remove(id);
    this.notes = this.notes.filter(n => n.id !== id);
    this.emit();
  }
}

// Client: every call carries the pipeline password hash; the database checks it before doing anything.
export function clientAdapter({ slug, hash }) {
  const bid = browserId();
  const rpc = (fn, body) => supabaseFetch(`rest/v1/rpc/${fn}`, { method: 'POST', body: { p_slug: slug, p_hash: hash, ...body } });
  return {
    list: () => rpc('list_feedback', { p_browser_id: bid }),
    add: async n => {
      const rows = await rpc('add_feedback', {
        p_candidate_id: n.candidate_id, p_stage: n.stage, p_author: n.author,
        p_body: n.body, p_score: n.score, p_browser_id: bid,
      });
      return Array.isArray(rows) ? rows[0] : rows;
    },
    remove: async id => {
      const ok = await rpc('delete_feedback', { p_id: id, p_browser_id: bid });
      if (!ok) throw new Error('Note could not be deleted.');
    },
  };
}

// ---------- UI ----------
// One note box per candidate: notes are saved with stage 'general' and shown in chronological order.
const FEEDBACK_STAGE = 'general';

export function mountFeedback(el, model, candidate, { t, locale = 'en' }) {
  const state = { draft: '' };

  const fmtDate = iso => {
    try { return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return ''; }
  };

  function render() {
    if (!el.isConnected) { unsubscribe(); return; }
    if (model.error) {
      el.innerHTML = `<section class="profile-section"><h3>${e(t('secFeedback'))}</h3><p class="muted">${e(t('fbLoadError'))}</p></section>`;
      return;
    }
    const name = storage.get('ow_fb_name') || '';
    const notes = model.forCandidate(candidate.id)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    el.innerHTML = `
      <section class="profile-section">
        <h3>${e(t('secFeedback'))}</h3>
        ${notes.length ? notes.map(n => `
          <div class="fb-note">
            <div class="fb-meta">
              <strong>${e(n.author || t('fbAnonymous'))}</strong>
              <span class="muted">${e(fmtDate(n.created_at))}</span>
              ${model.canWrite && n.mine ? `<button type="button" class="fb-delete" data-del="${e(n.id)}" title="${e(t('fbDelete'))}" aria-label="${e(t('fbDelete'))}">🗑</button>` : ''}
            </div>
            <p class="fb-text">${e(n.body)}</p>
          </div>`).join('') : `<p class="muted fb-empty">${e(t('fbEmpty'))}</p>`}
        ${model.canWrite ? `
          <form class="fb-form">
            <input class="input" name="author" maxlength="80" placeholder="${e(t('fbYourName'))}" value="${e(name)}" autocomplete="name">
            <textarea class="input" name="body" rows="4" maxlength="4000" placeholder="${e(t('fbPlaceholder'))}">${e(state.draft)}</textarea>
            <div class="fb-actions"><button type="submit" class="btn btn-primary">${e(t('fbSave'))}</button></div>
          </form>` : ''}
      </section>`;
  }

  el.addEventListener('input', ev => {
    if (!ev.target.closest('.fb-form')) return;
    if (ev.target.name === 'author') storage.set('ow_fb_name', ev.target.value);
    if (ev.target.name === 'body') state.draft = ev.target.value;
  });

  el.addEventListener('click', async ev => {
    const del = ev.target.closest('[data-del]');
    if (del) {
      if (!confirm(t('fbConfirmDelete'))) return;
      del.disabled = true;
      try { await model.remove(del.dataset.del); toast(t('fbDeleted')); }
      catch (err) { del.disabled = false; toast(t('fbError'), 'error'); console.warn(err); }
    }
  });

  el.addEventListener('submit', async ev => {
    const form = ev.target.closest('.fb-form');
    if (!form) return;
    ev.preventDefault();
    const author = form.author.value.trim();
    const body = form.body.value.trim();
    if (!author) { toast(t('fbNeedName'), 'error'); form.author.focus(); return; }
    if (!body) { toast(t('fbNeedBody'), 'error'); form.body.focus(); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = t('fbSaving');
    try {
      await model.add({ candidate_id: candidate.id, stage: FEEDBACK_STAGE, author, body, score: null });
      state.draft = '';
      toast(t('fbSaved'));
    } catch (err) {
      btn.disabled = false; btn.textContent = t('fbSave');
      toast(t('fbError'), 'error'); console.warn(err);
    }
  });

  const unsubscribe = model.subscribe(render);
  render();
  return { render, destroy: unsubscribe };
}
