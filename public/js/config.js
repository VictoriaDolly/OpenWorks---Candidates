// Public configuration. Everything here is visible to anyone who opens the site — that's expected.
// SUPABASE_ANON_KEY must be the *publishable* (anon) key. NEVER put the secret / service_role key here.
export const SUPABASE_URL = 'https://ciifambosbnoqqagtfpp.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_kDhtQvPtdFIEKqwT-kAZvw_waJQ9Xw5';
// Base URL used when building client links in the admin (no trailing slash). Empty = current site.
export const PUBLIC_SITE_URL = 'https://openworks-candidates.vercel.app';

export const isSupabaseConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const siteUrl = () => (PUBLIC_SITE_URL || location.origin).replace(/\/+$/, '');
