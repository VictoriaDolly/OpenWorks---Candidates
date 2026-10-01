// Admin sign-in with Supabase magic links, using the Auth REST API directly (no SDK).
import { supabaseFetch, storage, SupabaseError } from '../js/shared.js';

const KEY = 'ow_admin_session';

const load = () => { try { return JSON.parse(storage.get(KEY) || 'null'); } catch { return null; } };
const save = s => storage.set(KEY, JSON.stringify(s));
export const clearSession = () => storage.remove(KEY);

// After clicking the email link, Supabase redirects to /admin/#access_token=…&refresh_token=…
// We store the session and remove the tokens from the address bar.
export function captureSessionFromUrl() {
  const hash = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error|error_code)=/.test(hash)) return null;
  const params = new URLSearchParams(hash);
  history.replaceState(null, '', location.pathname + location.search);
  if (params.get('error') || params.get('error_code')) {
    const code = params.get('error_code');
    return { error: code === 'otp_expired'
      ? 'That sign-in link has expired or was already used. Request a new one.'
      : (params.get('error_description') || 'Sign-in failed. Request a new link.').replace(/\+/g, ' ') };
  }
  const session = {
    access_token: params.get('access_token'),
    refresh_token: params.get('refresh_token'),
    expires_at: Math.floor(Date.now() / 1000) + Number(params.get('expires_in') || 3600),
  };
  save(session);
  return { session };
}

async function refresh(session) {
  const data = await supabaseFetch('auth/v1/token?grant_type=refresh_token', {
    method: 'POST', body: { refresh_token: session.refresh_token },
  });
  const next = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600),
    email: data.user?.email || session.email,
  };
  save(next);
  return next;
}

let refreshing = null;
// Returns a valid session (refreshing the access token when it's about to expire) or null.
export async function getSession() {
  const s = load();
  if (!s?.access_token) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  try {
    refreshing ||= refresh(s).finally(() => { refreshing = null; });
    return await refreshing;
  } catch (err) {
    if (err instanceof SupabaseError && err.status >= 400 && err.status < 500) clearSession();
    return null;
  }
}

export async function fetchUserEmail(session) {
  const user = await supabaseFetch('auth/v1/user', { token: session.access_token });
  const next = { ...session, email: user.email };
  save(next);
  return user.email;
}

export async function checkIsAdmin(session) {
  return Boolean(await supabaseFetch('rest/v1/rpc/is_admin', { method: 'POST', body: {}, token: session.access_token }));
}

export async function requestMagicLink(email) {
  const redirect = `${location.origin}/admin/`; // trailing slash matters for the redirect allow-list
  try {
    await supabaseFetch(`auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, {
      method: 'POST', body: { email, create_user: false },
    });
  } catch (err) {
    if (err.status === 429 || /rate limit/i.test(err.message)) throw new Error('Too many sign-in emails were requested. Wait a few minutes and try again.');
    if (/signup|not allowed|not found/i.test(err.message)) throw new Error('This email is not authorized for the admin.');
    throw err;
  }
}

export async function signOut() {
  const s = load();
  clearSession();
  if (s?.access_token) {
    try { await supabaseFetch('auth/v1/logout', { method: 'POST', token: s.access_token }); } catch { /* already gone */ }
  }
}
