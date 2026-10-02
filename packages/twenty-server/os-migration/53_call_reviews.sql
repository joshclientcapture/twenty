-- Call tracker reads for the CRM page: the list of reviewed calls and one call's full review.
-- p_scope_email narrows to the closer's own calls (os.closers login -> fathom email); admins pass null.
-- Run AFTER POST /os/calls/setup has created the callReview object.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 53_call_reviews.sql
set search_path to os, public;

create or replace function os.call_review_in_scope(p_closer_email text, p_person_id uuid, p_scope_email text)
returns boolean language sql stable as $function$
  select p_scope_email is null
    or exists (select 1 from os.closers c where lower(c.login_email) = lower(p_scope_email) and lower(coalesce(c.fathom_email, '')) = lower(coalesce(p_closer_email, '')))
    or exists (select 1 from workspace_a1aip8pgko71t0v2lrw9rnizs.person p where p.id = p_person_id and lower(p."closerEmail") = lower(p_scope_email));
$function$;

create or replace function os.get_call_reviews(p_scope_email text default null, p_days int default 90, p_limit int default 500)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name, 'call_date', r."callDate", 'started_at', r."startedAt", 'duration_minutes', r."durationMinutes",
    'closer_email', r."closerEmail", 'closer_name', r."closerName", 'prospect_name', r."prospectName", 'prospect_email', r."prospectEmail",
    'call_type', r."callType", 'outcome', r.outcome, 'status', r.status,
    'overall_score', r."overallScore", 'verdict', r.verdict, 'recording_url', r."recordingPrimaryLinkUrl",
    'person_id', r."personId", 'person_stage', p.stage,
    'person_name', nullif(trim(coalesce(p."nameFirstName", '') || ' ' || coalesce(p."nameLastName", '')), '')
  ) order by r."startedAt" desc nulls last), '[]'::jsonb)
  from (
    select * from workspace_a1aip8pgko71t0v2lrw9rnizs."callReview" r
    where r."deletedAt" is null
      and (p_days is null or r."startedAt" >= now() - make_interval(days => p_days))
      and os.call_review_in_scope(r."closerEmail", r."personId", p_scope_email)
    order by r."startedAt" desc nulls last limit p_limit
  ) r
  left join workspace_a1aip8pgko71t0v2lrw9rnizs.person p on p.id = r."personId";
$function$;

create or replace function os.get_call_review(p_id uuid, p_scope_email text default null)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'name', r.name, 'call_date', r."callDate", 'started_at', r."startedAt", 'duration_minutes', r."durationMinutes",
    'closer_email', r."closerEmail", 'closer_name', r."closerName", 'prospect_name', r."prospectName", 'prospect_email', r."prospectEmail",
    'call_type', r."callType", 'outcome', r.outcome, 'status', r.status,
    'overall_score', r."overallScore", 'verdict', r.verdict, 'summary', r.summary, 'scores', r.scores, 'key_moments', r."keyMoments",
    'report', r.report, 'deductions', r.deductions, 'confidence', r.confidence,
    'transcript', r.transcript, 'recording_url', r."recordingPrimaryLinkUrl", 'fathom_recording_id', r."fathomRecordingId",
    'person_id', r."personId", 'person_stage', p.stage,
    'person_name', nullif(trim(coalesce(p."nameFirstName", '') || ' ' || coalesce(p."nameLastName", '')), '')
  ) end
  from workspace_a1aip8pgko71t0v2lrw9rnizs."callReview" r
  left join workspace_a1aip8pgko71t0v2lrw9rnizs.person p on p.id = r."personId"
  where r.id = p_id and r."deletedAt" is null and os.call_review_in_scope(r."closerEmail", r."personId", p_scope_email);
$function$;
