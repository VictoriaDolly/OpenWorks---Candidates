// DEV ONLY — in-browser Supabase emulator used to test the site before a real project exists.
// Served by tools/serve.ps1 at /__dev/mock-supabase.js; never deployed (Vercel only publishes public/).
// Intercepts fetch() calls to https://mock.supabase.co and mimics the REST/RPC/Auth/Storage behaviour
// (including the RLS rules) of docs/supabase-setup.sql. Data persists in localStorage "mock_db".
const ADMIN = 'admin@example.com';
const OTHER = 'other@example.com'; // a real user who is NOT in the admins table
const TOKENS = { 'mock-admin-token': ADMIN, 'mock-other-token': OTHER };
const STAGES = ['Submitted', 'Client Interviews', 'On-Hold', 'Offer', 'Rejected'];

const load = () => JSON.parse(localStorage.getItem('mock_db') || '{"pipelines":[],"candidates":[],"feedback":[]}');
const save = db => localStorage.setItem('mock_db', JSON.stringify(db));
const json = (data, status = 200) => new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const realFetch = window.__realFetch || window.fetch.bind(window);
window.__realFetch = realFetch;
window.__mockLog = [];

window.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (url.host !== 'mock.supabase.co') return realFetch(input, init);
  const method = (init.method || 'GET').toUpperCase();
  const h = init.headers || {};
  const email = TOKENS[(h.Authorization || '').replace('Bearer ', '')];
  const isAdmin = email === ADMIN;
  let body = null;
  if (typeof init.body === 'string') body = JSON.parse(init.body || 'null');
  const path = url.pathname.replace(/^\//, '');
  window.__mockLog.push(`${method} ${path}${url.search}`);
  if (!h.apikey) return json({ message: 'No API key found in request' }, 401);
  const db = load();
  const now = new Date().toISOString();
  const touch = slug => { const p = db.pipelines.find(x => x.slug === slug); if (p) p.updated_at = now; };

  // ---- Auth ----
  if (path === 'auth/v1/otp') return [ADMIN, OTHER].includes(body.email) ? json({}) : json({ msg: 'Signups not allowed for otp' }, 422);
  if (path === 'auth/v1/user') return email ? json({ email }) : json({ msg: 'invalid JWT' }, 401);
  if (path === 'auth/v1/logout') return json(undefined, 204);

  // ---- RPC ----
  if (path.startsWith('rest/v1/rpc/')) {
    const fn = path.slice('rest/v1/rpc/'.length);
    if (fn === 'is_admin') return json(isAdmin);
    const p = db.pipelines.find(x => x.slug === body.p_slug && x.published_at);
    const ok = p && p.password_hash === body.p_hash;
    const view = f => ({ id: f.id, candidate_id: f.candidate_id, stage: f.stage, author: f.author, body: f.body, score: f.score, created_at: f.created_at, mine: !!f.browser_id && f.browser_id === body.p_browser_id });
    if (fn === 'pipeline_salt') return json(p ? p.salt : null);
    if (fn === 'get_pipeline') return json(ok ? p.published_snapshot : null);
    if (!ok) return json({ message: 'Not authorized' }, 403);
    if (fn === 'list_feedback') return json(db.feedback.filter(f => f.pipeline_slug === p.slug).map(view));
    if (fn === 'add_feedback') {
      if (!STAGES.includes(body.p_stage)) return json({ message: 'Invalid stage' }, 400);
      if (!p.published_snapshot.candidates.some(c => c.id === body.p_candidate_id)) return json({ message: 'Unknown candidate' }, 400);
      const f = { id: crypto.randomUUID(), pipeline_slug: p.slug, candidate_id: body.p_candidate_id, stage: body.p_stage, author: body.p_author, body: body.p_body, score: body.p_score, browser_id: body.p_browser_id, created_at: now };
      db.feedback.push(f); save(db);
      return json([view(f)]);
    }
    if (fn === 'delete_feedback') {
      const n = db.feedback.length;
      db.feedback = db.feedback.filter(f => !(f.id === body.p_id && f.pipeline_slug === p.slug && f.browser_id && f.browser_id === body.p_browser_id));
      save(db);
      return json(db.feedback.length < n);
    }
    return json({ message: `mock: unknown rpc ${fn}` }, 404);
  }

  // ---- Tables (RLS: only admins see or change anything) ----
  if (path.startsWith('rest/v1/')) {
    const table = path.slice('rest/v1/'.length);
    if (!db[table]) return json({ message: `relation ${table} does not exist` }, 404);
    if (!isAdmin) return method === 'GET' ? json([]) : json({ message: 'new row violates row-level security policy' }, 403);
    const filters = [...url.searchParams].filter(([, v]) => v.startsWith('eq.')).map(([k, v]) => [k, v.slice(3)]);
    const match = r => filters.every(([k, v]) => String(r[k]) === v);
    if (method === 'GET') {
      const rows = db[table].filter(match);
      const order = url.searchParams.get('order');
      if (order) { const [col, dir] = order.split('.'); rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1)); }
      return json(rows);
    }
    if (method === 'POST') {
      const r = { created_at: now, updated_at: now, ...(table !== 'pipelines' ? { id: crypto.randomUUID() } : {}), ...body };
      if (table === 'pipelines' && db.pipelines.some(x => x.slug === r.slug)) return json({ message: 'duplicate key value violates unique constraint' }, 409);
      db[table].push(r);
      if (table === 'candidates') touch(r.pipeline_slug);
      save(db);
      return json([r], 201);
    }
    if (method === 'PATCH') {
      const hit = db[table].filter(match);
      hit.forEach(r => { Object.assign(r, body, { updated_at: now }); if (table === 'candidates') touch(r.pipeline_slug); });
      save(db);
      return json(hit);
    }
    if (method === 'DELETE') {
      const hit = db[table].filter(match);
      db[table] = db[table].filter(r => !match(r));
      if (table === 'pipelines') hit.forEach(p => { db.candidates = db.candidates.filter(c => c.pipeline_slug !== p.slug); db.feedback = db.feedback.filter(f => f.pipeline_slug !== p.slug); });
      if (table === 'candidates') hit.forEach(c => touch(c.pipeline_slug));
      save(db);
      return json(undefined, 204);
    }
  }

  // ---- Storage ----
  if (path.startsWith('storage/v1/')) {
    if (!isAdmin) return json({ message: 'new row violates row-level security policy' }, 403);
    if (path.startsWith('storage/v1/object/list/')) return json([]);
    return json({ Key: path });
  }
  return json({ message: `mock: unknown path ${path}` }, 404);
};

export const MOCK = { ADMIN, OTHER };
