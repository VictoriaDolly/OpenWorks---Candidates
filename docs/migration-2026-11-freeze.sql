-- Run once in the Supabase SQL editor on an existing project (new projects get this from supabase-setup.sql).
-- "Freeze" a pipeline: while frozen_at is set, the client link behaves exactly like a link that
-- doesn't exist (no salt, no data, no feedback). Unfreezing restores it as it was.

alter table pipelines add column if not exists frozen_at timestamptz;

create or replace function pipeline_salt(p_slug text) returns text
language sql stable security definer set search_path = public as $$
  select salt from pipelines where slug = p_slug and published_at is not null and frozen_at is null;
$$;

create or replace function get_pipeline(p_slug text, p_hash text) returns jsonb
language sql stable security definer set search_path = public as $$
  select published_snapshot from pipelines
  where slug = p_slug and published_at is not null and frozen_at is null and password_hash = p_hash;
$$;

create or replace function pipeline_unlocked(p_slug text, p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from pipelines where slug = p_slug and published_at is not null and frozen_at is null and password_hash = p_hash);
$$;
