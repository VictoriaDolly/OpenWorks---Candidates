// Interview feedback: the only thing clients can write.
// Data access goes through an "adapter" so the same UI works for the client (password-checked RPCs)
// and the admin (read-only, signed-in REST).
import { STATUSES, SCORES, average, escapeHtml as e, browserId, storage, supabaseFetch } from './shared.js';
import { scorePill, toast } from './board.js';

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
export function mountFeedback(el, model, candidate, { t, locale = 'en' }) {
  const state = { open: new Set(), drafts: {} };
  // Stages that already have notes start open.
  STATUSES.forEach(s => { if (model.forCandidate(candidate.id).some(n => n.stage === s)) state.open.add(s); });

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
    const notes = model.forCandidate(candidate.id);
    el.innerHTML = `
      <section class="profile-section">
        <h3>${e(t('secFeedback'))}</h3>
        ${STATUSES.map(stage => {
          const list = notes.filter(n => n.stage === stage).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
          const avg = model.stageAvg(candidate.id, stage);
          const draft = state.drafts[stage] || { body: '', score: null };
          return `
          <details class="fb-stage" data-stage="${e(stage)}"${state.open.has(stage) ? ' open' : ''}>
            <summary>
              <span class="fb-arrow" aria-hidden="true">▾</span>
              <span class="fb-stage-name">${e(stage)}</span>
              <span class="fb-count">${list.length ? e(list.length === 1 ? t('fbNotesOne') : t('fbNotesMany', { n: list.length })) : ''}</span>
              ${scorePill(avg, t, { withLabel: true })}
            </summary>
            <div class="fb-body">
              ${list.length ? list.map(n => `
                <div class="fb-note">
                  <div class="fb-meta">
                    <strong>${e(n.author || t('fbAnonymous'))}</strong>
                    <span class="muted">${e(fmtDate(n.created_at))}</span>
                    ${n.score ? `<span class="score-chip score-${n.score}">${n.score} · ${e(t('score_' + n.score))}</span>` : ''}
                    ${model.canWrite && n.mine ? `<button type="button" class="fb-delete" data-del="${e(n.id)}" title="${e(t('fbDelete'))}" aria-label="${e(t('fbDelete'))}">🗑</button>` : ''}
                  </div>
                  <p class="fb-text">${e(n.body)}</p>
                </div>`).join('') : `<p class="muted fb-empty">${e(t('fbEmpty'))}</p>`}
              ${model.canWrite ? `
                <form class="fb-form" data-stage="${e(stage)}">
                  <input class="input" name="author" maxlength="80" placeholder="${e(t('fbYourName'))}" value="${e(name)}" autocomplete="name">
                  <textarea class="input" name="body" rows="3" maxlength="4000" placeholder="${e(t('fbPlaceholder'))}">${e(draft.body)}</textarea>
                  <div class="fb-scores" role="group" aria-label="${e(t('fbScore'))}">
                    ${SCORES.map(s => `<button type="button" class="score-btn score-${s}${draft.score === s ? ' is-selected' : ''}" data-score="${s}" aria-pressed="${draft.score === s}">${s} · ${e(t('score_' + s))}</button>`).join('')}
                  </div>
                  <div class="fb-actions"><button type="submit" class="btn btn-primary">${e(t('fbSave'))}</button></div>
                </form>` : ''}
            </div>
          </details>`;
        }).join('')}
      </section>`;
  }

  el.addEventListener('toggle', ev => {
    const d = ev.target.closest?.('details.fb-stage');
    if (!d) return;
    d.open ? state.open.add(d.dataset.stage) : state.open.delete(d.dataset.stage);
  }, true);

  el.addEventListener('input', ev => {
    const form = ev.target.closest('.fb-form');
    if (!form) return;
    const stage = form.dataset.stage;
    if (ev.target.name === 'author') {
      storage.set('ow_fb_name', ev.target.value);
      el.querySelectorAll('.fb-form input[name="author"]').forEach(i => { if (i !== ev.target) i.value = ev.target.value; });
    }
    if (ev.target.name === 'body') (state.drafts[stage] ||= { body: '', score: null }).body = ev.target.value;
  });

  el.addEventListener('click', async ev => {
    const scoreBtn = ev.target.closest('.score-btn');
    if (scoreBtn) {
      const form = scoreBtn.closest('.fb-form');
      const draft = (state.drafts[form.dataset.stage] ||= { body: '', score: null });
      const s = Number(scoreBtn.dataset.score);
      draft.score = draft.score === s ? null : s; // click again to deselect
      form.querySelectorAll('.score-btn').forEach(b => {
        const on = Number(b.dataset.score) === draft.score;
        b.classList.toggle('is-selected', on); b.setAttribute('aria-pressed', on);
      });
      return;
    }
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
    const stage = form.dataset.stage;
    const author = form.author.value.trim();
    const body = form.body.value.trim();
    if (!author) { toast(t('fbNeedName'), 'error'); form.author.focus(); return; }
    if (!body) { toast(t('fbNeedBody'), 'error'); form.body.focus(); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = t('fbSaving');
    try {
      await model.add({ candidate_id: candidate.id, stage, author, body, score: state.drafts[stage]?.score ?? null });
      delete state.drafts[stage];
      state.open.add(stage);
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
