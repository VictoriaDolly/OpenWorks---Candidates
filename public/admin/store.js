// Admin data layer: pipelines, candidates, resumes, feedback and publishing (Supabase REST, signed in).
import { SUPABASE_URL } from '../js/config.js';
import { supabaseFetch, normalizeStatus, RECOMMENDATIONS, AVAILABILITY_FIELDS, uuid } from '../js/shared.js';
import { getSession } from './auth.js';

async function req(path, opts = {}) {
  const s = await getSession();
  if (!s) throw new Error('Your session expired — please sign in again.');
  return supabaseFetch(path, { ...opts, token: s.access_token });
}
const enc = encodeURIComponent;
const RETURN = { Prefer: 'return=representation' };

// ---------- Mapping DB rows ⇄ app objects ----------
const toPipeline = r => ({
  slug: r.slug, clientName: r.client_name, roleTitle: r.role_title || '',
  publishedSnapshot: r.published_snapshot, publishedAt: r.published_at,
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const toCandidate = r => ({
  id: r.id, pipelineSlug: r.pipeline_slug, name: r.name, location: r.location || '',
  email: r.email || '', linkedin: r.linkedin || '', status: normalizeStatus(r.status),
  resume: r.resume && r.resume.url ? { url: r.resume.url, label: r.resume.label || '' } : null,
  overallRecommendation: r.overall_recommendation || '',
  screeningNotes: Array.isArray(r.screening_notes) ? r.screening_notes : [],
  toConsider: r.to_consider || '',
  availability: r.availability || {},
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const candidateRow = c => ({
  pipeline_slug: c.pipelineSlug, name: c.name.trim(), location: c.location || null,
  email: c.email || null, linkedin: c.linkedin || null, status: normalizeStatus(c.status),
  resume: c.resume?.url ? { url: c.resume.url, label: c.resume.label || '' } : {},
  overall_recommendation: c.overallRecommendation || null,
  screening_notes: (c.screeningNotes || []).map(s => String(s).trim()).filter(Boolean),
  to_consider: c.toConsider || null,
  availability: cleanAvailability(c.availability),
});

function cleanAvailability(av = {}) {
  const out = {};
  AVAILABILITY_FIELDS.forEach(k => { const v = String(av[k] ?? '').trim(); if (v) out[k] = v; });
  return out;
}

// ---------- Pipelines ----------
export async function listPipelines() {
  const [rows, cands] = await Promise.all([
    req('rest/v1/pipelines?select=slug,client_name,role_title,published_at,created_at,updated_at&order=updated_at.desc'),
    req('rest/v1/candidates?select=pipeline_slug'),
  ]);
  const counts = {};
  cands.forEach(c => { counts[c.pipeline_slug] = (counts[c.pipeline_slug] || 0) + 1; });
  return rows.map(r => ({ ...toPipeline(r), candidateCount: counts[r.slug] || 0 }));
}

export async function getPipeline(slug) {
  const rows = await req(`rest/v1/pipelines?slug=eq.${enc(slug)}&select=*`);
  return rows[0] ? toPipeline(rows[0]) : null;
}

export async function createPipeline({ slug, clientName, roleTitle, passwordHash, salt }) {
  const rows = await req('rest/v1/pipelines', {
    method: 'POST', headers: RETURN,
    body: { slug, client_name: clientName, role_title: roleTitle || null, password_hash: passwordHash, salt },
  });
  return toPipeline(rows[0]);
}

export async function updatePipeline(slug, { clientName, roleTitle, passwordHash, salt }) {
  const body = { client_name: clientName, role_title: roleTitle || null };
  if (passwordHash) Object.assign(body, { password_hash: passwordHash, salt });
  const rows = await req(`rest/v1/pipelines?slug=eq.${enc(slug)}`, { method: 'PATCH', headers: RETURN, body });
  return toPipeline(rows[0]);
}

export async function deletePipeline(slug) {
  await removeResumeFolder(slug).catch(err => console.warn('Resume cleanup failed:', err.message));
  await req(`rest/v1/pipelines?slug=eq.${enc(slug)}`, { method: 'DELETE' }); // candidates + feedback cascade
}

// ---------- Candidates ----------
export async function listCandidates(slug) {
  const rows = await req(`rest/v1/candidates?pipeline_slug=eq.${enc(slug)}&select=*&order=created_at.asc`);
  return rows.map(toCandidate);
}

export async function saveCandidate(c, { isNew }) {
  const row = candidateRow(c);
  const rows = isNew
    ? await req('rest/v1/candidates', { method: 'POST', headers: RETURN, body: { id: c.id || uuid(), ...row } })
    : await req(`rest/v1/candidates?id=eq.${enc(c.id)}`, { method: 'PATCH', headers: RETURN, body: row });
  return toCandidate(rows[0]);
}

export async function setCandidateStatus(id, status) {
  const rows = await req(`rest/v1/candidates?id=eq.${enc(id)}`, { method: 'PATCH', headers: RETURN, body: { status: normalizeStatus(status) } });
  return toCandidate(rows[0]);
}

export async function deleteCandidate(c) {
  await req(`rest/v1/candidates?id=eq.${enc(c.id)}`, { method: 'DELETE' });
  await req(`rest/v1/feedback?pipeline_slug=eq.${enc(c.pipelineSlug)}&candidate_id=eq.${enc(c.id)}`, { method: 'DELETE' }).catch(() => {});
  if (c.resume?.url) await removeResumeByUrl(c.resume.url).catch(() => {});
}

// ---------- Resumes (Storage bucket "resumes") ----------
const PUBLIC_PREFIX = () => `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/resumes/`;

export async function uploadResume(slug, candidateId, file) {
  if (file.type && file.type !== 'application/pdf') throw new Error('Please choose a PDF file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('The PDF is larger than 10 MB.');
  const safeName = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${slug}/${candidateId}-${Date.now()}-${safeName}`;
  await req(`storage/v1/object/resumes/${path.split('/').map(enc).join('/')}`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
  });
  return { url: PUBLIC_PREFIX() + path.split('/').map(enc).join('/'), label: file.name };
}

const pathFromUrl = url => (url && url.startsWith(PUBLIC_PREFIX()) ? decodeURIComponent(url.slice(PUBLIC_PREFIX().length)) : null);

export async function removeResumeByUrl(url) {
  const path = pathFromUrl(url);
  if (path) await req('storage/v1/object/resumes', { method: 'DELETE', body: { prefixes: [path] } });
}

async function removeResumeFolder(slug) {
  const items = await req('storage/v1/object/list/resumes', { method: 'POST', body: { prefix: `${slug}/`, limit: 1000 } });
  const paths = (items || []).filter(i => i.id).map(i => `${slug}/${i.name}`);
  if (paths.length) await req('storage/v1/object/resumes', { method: 'DELETE', body: { prefixes: paths } });
}

// ---------- Feedback (read-only in the admin) ----------
export function feedbackAdapter(slug) {
  return {
    list: () => req(`rest/v1/feedback?pipeline_slug=eq.${enc(slug)}&select=id,candidate_id,stage,author,body,score,created_at&order=created_at.asc`),
  };
}

// ---------- Publishing ----------
// The snapshot is exactly what the client can see: no timestamps, no internal fields.
export function buildSnapshot(pipeline, candidates) {
  return {
    slug: pipeline.slug,
    clientName: pipeline.clientName,
    roleTitle: pipeline.roleTitle || '',
    candidates: candidates.map(c => ({
      id: c.id, name: c.name, location: c.location || '', email: c.email || '', linkedin: c.linkedin || '',
      status: normalizeStatus(c.status),
      resume: c.resume?.url ? { url: c.resume.url, label: c.resume.label || '' } : null,
      overallRecommendation: c.overallRecommendation || '',
      screeningNotes: c.screeningNotes || [],
      toConsider: c.toConsider || '',
      availability: cleanAvailability(c.availability),
    })),
  };
}

export async function publish(pipeline, candidates) {
  const snapshot = buildSnapshot(pipeline, candidates);
  const rows = await req(`rest/v1/pipelines?slug=eq.${enc(pipeline.slug)}`, {
    method: 'PATCH', headers: RETURN,
    body: { published_snapshot: snapshot, published_at: new Date().toISOString() },
  });
  return toPipeline(rows[0]);
}

// Key-order-independent JSON (Postgres jsonb reorders keys) to detect unpublished changes.
export function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const hasUnpublishedChanges = (pipeline, candidates) =>
  !pipeline.publishedSnapshot || stableStringify(buildSnapshot(pipeline, candidates)) !== stableStringify(pipeline.publishedSnapshot);

// ---------- Import from JSON ----------
const ALIASES = {
  name: ['name', 'fullName', 'full_name', 'candidateName', 'candidate_name', 'candidate'],
  location: ['location', 'city', 'cityState', 'city_state'],
  email: ['email', 'emailAddress', 'email_address', 'mail'],
  linkedin: ['linkedin', 'linkedIn', 'linkedinUrl', 'linkedin_url', 'linkedInUrl', 'linkedin_profile'],
  status: ['status', 'stage'],
  resume: ['resume', 'cv', 'resumeUrl', 'resume_url', 'cvUrl', 'cv_url', 'resumeLink', 'resume_link'],
  overallRecommendation: ['overallRecommendation', 'overall_recommendation', 'recommendation', 'overall'],
  screeningNotes: ['screeningNotes', 'screening_notes', 'notes', 'screeningInterviewNotes', 'screening_interview_notes', 'highlights', 'bullets'],
  toConsider: ['toConsider', 'to_consider', 'considerations', 'concerns', 'cons'],
  availability: ['availability', 'availabilityAndExpectations', 'availability_and_expectations', 'availabilityExpectations', 'expectations'],
};
const AV_ALIASES = {
  motivation: ['motivation', 'motivationToChange', 'motivation_to_change', 'reasonForChange'],
  noticePeriod: ['noticePeriod', 'notice_period', 'notice', 'availabilityToStart', 'startDate'],
  otherProcesses: ['otherProcesses', 'other_processes', 'otherHiringProcesses', 'other_hiring_processes'],
  vacationPlans: ['vacationPlans', 'vacation_plans', 'vacation', 'migrationPlans', 'vacationMigrationPlans', 'vacation_migration_plans'],
  visaStatus: ['visaStatus', 'visa_status', 'visa'],
  salaryExpectations: ['salaryExpectations', 'salary_expectations', 'salary', 'expectedSalary', 'compensation'],
};
const pick = (obj, keys) => {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== '') return obj[k];
  return undefined;
};
const text = v => (v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v)).trim();

export function parseImport(raw) {
  let s = String(raw || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let data;
  try { data = JSON.parse(s); } catch {
    const start = s.search(/[[{]/), end = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
    if (start < 0 || end < start) throw new Error("That doesn't look like JSON. Paste the JSON from the Import Assistant.");
    try { data = JSON.parse(s.slice(start, end + 1)); } catch (err) { throw new Error(`The JSON has an error: ${err.message}`); }
  }
  const items = Array.isArray(data) ? data : Array.isArray(data?.candidates) ? data.candidates : [data];
  return items.map((item, i) => {
    const c = normalizeImported(item);
    if (!c.name) throw new Error(`Candidate #${i + 1} has no name.`);
    return c;
  });
}

function normalizeImported(o) {
  const out = {};
  out.name = text(pick(o, ALIASES.name));
  out.location = text(pick(o, ALIASES.location));
  out.email = text(pick(o, ALIASES.email));
  out.linkedin = text(pick(o, ALIASES.linkedin));
  out.status = normalizeStatus(pick(o, ALIASES.status)); // invalid → first stage
  const r = pick(o, ALIASES.resume);
  out.resume = typeof r === 'string' ? (r.trim() ? { url: r.trim(), label: 'Resume' } : null)
    : r && (r.url || r.link) ? { url: String(r.url || r.link), label: String(r.label || r.name || 'Resume') } : null;
  const rec = text(pick(o, ALIASES.overallRecommendation)).replace(/^✔️?\s*/, '');
  out.overallRecommendation = RECOMMENDATIONS.find(x => x.toLowerCase() === rec.toLowerCase())
    || (/reservation/i.test(rec) ? RECOMMENDATIONS[1] : /recommend|advance/i.test(rec) ? RECOMMENDATIONS[0] : rec);
  const notes = pick(o, ALIASES.screeningNotes);
  out.screeningNotes = (Array.isArray(notes) ? notes : String(notes || '').split(/\r?\n/))
    .map(n => String(n).replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
  out.toConsider = text(pick(o, ALIASES.toConsider)).replace(/^to consider:\s*/i, '');
  const avSrc = { ...o, ...(typeof pick(o, ALIASES.availability) === 'object' ? pick(o, ALIASES.availability) : {}) };
  out.availability = {};
  AVAILABILITY_FIELDS.forEach(k => { const v = text(pick(avSrc, AV_ALIASES[k])); if (v) out.availability[k] = v; });
  out._has = Object.fromEntries(Object.keys(ALIASES).map(k => [k, pick(o, ALIASES[k]) !== undefined]));
  return out;
}

// Same name (case/space-insensitive) in this pipeline → update; otherwise create.
export async function importCandidates(slug, imported, existing) {
  const key = n => String(n || '').toLowerCase().replace(/\s+/g, ' ').trim();
  let created = 0, updated = 0;
  for (const item of imported) {
    const { _has, ...data } = item;
    const match = existing.find(c => key(c.name) === key(data.name));
    if (match) {
      // Only overwrite the fields present in the JSON; keep an uploaded resume unless the JSON brings one.
      const merged = { ...match };
      Object.keys(ALIASES).forEach(k => { if (_has[k] && k !== 'name' && k !== 'availability') merged[k] = data[k]; });
      merged.availability = { ...match.availability, ...data.availability }; // field by field
      if (!_has.resume || !data.resume) merged.resume = match.resume;
      const saved = await saveCandidate(merged, { isNew: false });
      Object.assign(match, saved);
      updated++;
    } else {
      const saved = await saveCandidate({ ...data, id: uuid(), pipelineSlug: slug }, { isNew: true });
      existing.push(saved);
      created++;
    }
  }
  return { created, updated };
}
