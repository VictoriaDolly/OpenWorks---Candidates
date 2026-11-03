-- Run once in the Supabase SQL editor on an existing project (new projects get this from supabase-setup.sql).
-- 1) "Additional Information" field on candidates.
-- 2) Client feedback is now a single note box saved with stage 'general'.

alter table candidates add column if not exists additional_info text;

create or replace function add_feedback(p_slug text, p_hash text, p_candidate_id text, p_stage text,
  p_author text, p_body text, p_score int, p_browser_id text)
returns table (id uuid, candidate_id text, stage text, author text, body text, score int, created_at timestamptz, mine boolean)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r feedback;
begin
  if not pipeline_unlocked(p_slug, p_hash) then raise exception 'Not authorized' using errcode = '42501'; end if;
  if p_stage not in ('general', 'Submitted', 'Client Interviews', 'On-Hold', 'Offer', 'Rejected') then
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
