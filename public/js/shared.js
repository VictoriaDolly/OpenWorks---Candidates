import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ---------- Domain constants (stage names are data: always English) ----------
export const STATUSES = ['Submitted', 'Client Interviews', 'On-Hold', 'Offer', 'Rejected'];
export const TERMINAL_STATUS = 'Rejected';
export const RECOMMENDATIONS = ['Recommended to Advance', 'Advance with Reservations'];
export const SCORES = [1, 2, 3, 4];
export const SCORE_LABELS = { 1: 'Strong No', 2: 'No', 3: 'Yes', 4: 'Strong Yes' };
export const AVAILABILITY_FIELDS = ['motivation', 'noticePeriod', 'otherProcesses', 'vacationPlans', 'visaStatus', 'salaryExpectations'];

// Unknown / removed stages fall back to the first stage so a candidate never disappears.
export function normalizeStatus(status) {
  const s = String(status || '').trim().toLowerCase();
  return STATUSES.find(x => x.toLowerCase() === s) || STATUSES[0];
}

// List order: most advanced first, Rejected always last.
export function sortForList(candidates) {
  const rank = s => (s === TERMINAL_STATUS ? -1 : STATUSES.indexOf(s));
  return [...candidates].sort((a, b) =>
    rank(normalizeStatus(b.status)) - rank(normalizeStatus(a.status)) ||
    String(a.name || '').localeCompare(String(b.name || '')));
}

// ---------- Scores ----------
export function average(values) {
  const nums = values.filter(v => Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
// Label comes from the rounded value; .5 rounds down so a split vote never gets upgraded (3.5 → "Yes").
export const roundScore = avg => Math.min(4, Math.max(1, Math.ceil(avg - 0.5)));
export const formatAvg = avg => (Math.round(avg * 10) / 10).toFixed(1);

// ---------- Strings / ids ----------
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function randomToken(length = 4) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(length))].map(n => chars[n % chars.length]).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const hashPassword = (salt, password) => sha256Hex(`${salt}:${password}`);

export function slugify(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

// "Chineye (Chi) Nnorom" → "CN" (nicknames in parentheses are ignored)
export function initials(name) {
  const parts = String(name || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const first = parts[0][0], last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Only allow http(s)/mailto links; bare domains get https:// added. Anything else → ''.
export function safeUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (/^\/[^/\\]/.test(u)) return new URL(u, location.origin).href; // same-site path
  if (/^www\.|^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(u)) u = 'https://' + u;
  try {
    const parsed = new URL(u);
    return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

// ---------- Browser storage (never throws) ----------
export const storage = {
  get(key, area = localStorage) { try { return area.getItem(key); } catch { return null; } },
  set(key, value, area = localStorage) { try { area.setItem(key, value); } catch { /* ignore */ } },
  remove(key, area = localStorage) { try { area.removeItem(key); } catch { /* ignore */ } },
};

export function browserId() {
  let id = storage.get('ow_browser_id');
  if (!id) { id = uuid(); storage.set('ow_browser_id', id); }
  return id;
}

// ---------- Supabase REST (no SDK) ----------
// path is relative to SUPABASE_URL, e.g. "rest/v1/rpc/get_pipeline". token = user access token (admin only).
export async function supabaseFetch(path, { method = 'GET', body, token, headers = {}, raw = false } = {}) {
  const h = { apikey: SUPABASE_ANON_KEY, ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body !== undefined && !(body instanceof Blob) && !(body instanceof FormData)) {
    h['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${SUPABASE_URL.replace(/\/+$/, '')}/${path}`, { method, headers: h, body });
  } catch {
    throw new SupabaseError('Network error — check your connection and try again.', 0);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.msg || data.error_description || data.error)) || `Request failed (${res.status})`;
    throw new SupabaseError(String(msg), res.status, data);
  }
  return raw ? { data, res } : data;
}

export class SupabaseError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}
