-- =====================================================================
-- OpenWorks Candidates — Supabase setup
-- Paste this whole file ONCE in Supabase → SQL Editor → New query → Run.
-- Admin email is set below (add more later with: insert into admins (email) values ('x@y.com');)
-- =====================================================================

-- ============ ADMINS ============
create table admins (
  email text primary key,
  added_at timestamptz default now()
);
insert into admins (email) values (lower('danvicmed@gmail.com'));

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(auth.jwt() ->> 'email'));
$$;

-- ============ PIPELINES ============
create table pipelines (
  slug text primary key,
  client_name text not null,
  role_title text,
  password_hash text not null,
  salt text not null,
  published_snapshot jsonb,
  published_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ CANDIDATES ============
create table candidates (
  id uuid primary key default gen_random_uuid(),
  pipeline_slug text not null references pipelines(slug) on delete cascade,
  name text not null,
  location text,
  email text,
  linkedin text,
  status text,
  resume jsonb default '{}',
  overall_recommendation text,
  screening_notes jsonb default '[]',
  to_consider text,
  availability jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index candidates_pipeline_idx on candidates (pipeline_slug);

-- ============ FEEDBACK ============
create table feedback (
  id uuid primary key default gen_random_uuid(),
  pipeline_slug text not null references pipelines(slug) on delete cascade,
  candidate_id text not null,
  stage text not null,
  author text check (char_length(author) <= 80),
  body text not null check (char_length(body) between 1 and 4000),
  score int check (score between 1 and 4),
  browser_id text,
  created_at timestamptz default now()
);
create index feedback_pipeline_idx on feedback (pipeline_slug);

-- ============ "UPDATED" DATES ============
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function touch_pipeline_from_candidate() returns trigger language plpgsql as $$
begin
  update pipelines set updated_at = now() where slug = coalesce(new.pipeline_slug, old.pipeline_slug);
  return null;
end $$;

create trigger pipelines_touch before update on pipelines for each row execute function touch_updated_at();
create trigger candidates_touch before update on candidates for each row execute function touch_updated_at();
create trigger candidates_touch_pipeline after insert or update or delete on candidates
  for each row execute function touch_pipeline_from_candidate();

-- ============ SECURITY (RLS) ============
-- Tables are closed by default. Only admins touch them directly.
-- Clients never read tables: they go through the functions below, which check the password first.
alter table admins enable row level security;
alter table pipelines enable row level security;
alter table candidates enable row level security;
alter table feedback enable row level security;

create policy "admins read admins" on admins for select to authenticated using (is_admin());
create policy "admins full pipelines" on pipelines for all to authenticated using (is_admin()) with check (is_admin());
create policy "admins full candidates" on candidates for all to authenticated using (is_admin()) with check (is_admin());
create policy "admins read feedback" on feedback for select to authenticated using (is_admin());
create policy "admins delete feedback" on feedback for delete to authenticated using (is_admin());

-- ============ CLIENT FUNCTIONS (password checked inside the database) ============
-- Salt is not secret: the browser needs it to hash the password the client types.
create or replace function pipeline_salt(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select salt from pipelines where slug = p_slug and published_at is not null;
$$;

-- Returns the published snapshot only when the password hash matches (otherwise null).
create or replace function get_pipeline(p_slug text, p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select published_snapshot from pipelines
  where slug = p_slug and published_at is not null and password_hash = p_hash;
$$;

create or replace function pipeline_unlocked(p_slug text, p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pipelines where slug = p_slug and published_at is not null and password_hash = p_hash);
$$;

-- Notes for a pipeline. "mine" tells the browser which notes it may delete (browser ids stay private).
create or replace function list_feedback(p_slug text, p_hash text, p_browser_id text)
returns table (id uuid, candidate_id text, stage text, author text, body text, score int, created_at timestamptz, mine boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not pipeline_unlocked(p_slug, p_hash) then raise exception 'Not authorized' using errcode = '42501'; end if;
  return query
    select f.id, f.candidate_id, f.stage, f.author, f.body, f.score, f.created_at,
           (f.browser_id is not null and f.browser_id = p_browser_id)
    from feedback f where f.pipeline_slug = p_slug order by f.created_at;
end $$;

create or replace function add_feedback(p_slug text, p_hash text, p_candidate_id text, p_stage text,
  p_author text, p_body text, p_score int, p_browser_id text)
returns table (id uuid, candidate_id text, stage text, author text, body text, score int, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r feedback;
begin
  if not pipeline_unlocked(p_slug, p_hash) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_stage not in ('Submitted', 'Client Interviews', 'On-Hold', 'Offer', 'Rejected') then
    raise exception 'Invalid stage';
  end if;
  if not exists (
    select 1 from pipelines p, jsonb_array_elements(p.published_snapshot -> 'candidates') c
    where p.slug = p_slug and c ->> 'id' = p_candidate_id
  ) then raise exception 'Unknown candidate'; end if;
  insert into feedback (pipeline_slug, candidate_id, stage, author, body, score, browser_id)
  values (p_slug, p_candidate_id, p_stage, nullif(trim(p_author), ''), trim(p_body), p_score, p_browser_id)
  returning * into r;
  return query select r.id, r.candidate_id, r.stage, r.author, r.body, r.score, r.created_at, true;
end $$;

-- Deletes a note only if it was written from the same browser.
create or replace function delete_feedback(p_slug text, p_hash text, p_id uuid, p_browser_id text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not pipeline_unlocked(p_slug, p_hash) then raise exception 'Not authorized' using errcode = '42501'; end if;
  delete from feedback f
  where f.id = p_id and f.pipeline_slug = p_slug and f.browser_id is not null and f.browser_id = p_browser_id;
  return found;
end $$;

revoke execute on function pipeline_salt(text), get_pipeline(text, text), pipeline_unlocked(text, text),
  list_feedback(text, text, text), add_feedback(text, text, text, text, text, text, int, text),
  delete_feedback(text, text, uuid, text) from public;
grant execute on function pipeline_salt(text), get_pipeline(text, text),
  list_feedback(text, text, text), add_feedback(text, text, text, text, text, text, int, text),
  delete_feedback(text, text, uuid, text) to anon, authenticated;

-- ============ STORAGE FOR RESUMES ============
-- Public bucket: a resume opens with its link (links contain a random id, so they can't be guessed).
-- Only admins can upload, replace or delete. PDF only, max 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', true, 10485760, array['application/pdf']);

create policy "admins manage resumes" on storage.objects for all to authenticated
  using (bucket_id = 'resumes' and public.is_admin())
  with check (bucket_id = 'resumes' and public.is_admin());
