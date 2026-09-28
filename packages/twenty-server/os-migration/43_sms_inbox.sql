-- SMS inbox reads for the CRM page: every thread with its person, and one thread's messages.
-- p_scope_email narrows to the threads of people the closer owns (person.closerEmail); admins pass null.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 43_sms_inbox.sql
set search_path to os, public;

create or replace function os.get_sms_threads(p_scope_email text default null, p_limit int default 200)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with t as (
    select t.*,
      p."nameFirstName" as person_first, p."nameLastName" as person_last, p."emailsPrimaryEmail" as person_email,
      p.closer as person_closer, lower(p."closerEmail") as person_closer_email, p.stage as person_stage, p."deletedAt" as person_deleted,
      (select count(*) from os.sms_messages m where m.thread_id = t.id) as message_count,
      (select count(*) from os.sms_messages m where m.thread_id = t.id and m.direction = 'in') as inbound_count,
      (select body from os.sms_messages m where m.thread_id = t.id order by m.at desc limit 1) as last_body,
      (select direction from os.sms_messages m where m.thread_id = t.id order by m.at desc limit 1) as last_direction,
      (select max(at) from os.sms_messages m where m.thread_id = t.id) as last_at
    from os.sms_threads t
    left join workspace_a1aip8pgko71t0v2lrw9rnizs.person p on p.id = t.person_id
    where p_scope_email is null or lower(p."closerEmail") = lower(p_scope_email)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'person_id', person_id, 'phone', phone, 'route', route, 'status', status, 'stop_reason', stop_reason,
    'name', coalesce(nullif(trim(coalesce(person_first, '') || ' ' || coalesce(person_last, '')), ''), full_name, phone),
    'email', coalesce(person_email, email), 'closer', person_closer, 'stage', person_stage, 'person_deleted', person_deleted is not null,
    'form_at', form_at, 'opener_at', opener_at, 'last_inbound_at', last_inbound_at, 'last_outbound_at', last_outbound_at,
    'handoff_reason', handoff_reason, 'interest', interest,
    'messages', message_count, 'inbound', inbound_count, 'last_body', last_body, 'last_direction', last_direction, 'last_at', coalesce(last_at, updated_at),
    'needs_attention', (status = 'handed_off' and last_direction = 'in')
  ) order by coalesce(last_at, updated_at) desc), '[]'::jsonb)
  from (select * from t order by coalesce(last_at, updated_at) desc limit p_limit) t;
$function$;

create or replace function os.get_sms_thread(p_thread_id uuid, p_scope_email text default null)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  select case when t.id is null then null else jsonb_build_object(
    'id', t.id, 'person_id', t.person_id, 'phone', t.phone, 'route', t.route, 'status', t.status, 'stop_reason', t.stop_reason,
    'name', coalesce(nullif(trim(coalesce(p."nameFirstName", '') || ' ' || coalesce(p."nameLastName", '')), ''), t.full_name, t.phone),
    'email', coalesce(p."emailsPrimaryEmail", t.email), 'closer', p.closer, 'stage', p.stage,
    'form_at', t.form_at, 'opener_at', t.opener_at, 'handoff_reason', t.handoff_reason, 'interest', t.interest, 'from_number', t.from_number,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'direction', m.direction, 'kind', m.kind, 'body', m.body, 'by_ai', m.by_ai, 'status', m.provider_status, 'at', m.at) order by m.at)
                          from os.sms_messages m where m.thread_id = t.id), '[]'::jsonb)
  ) end
  from os.sms_threads t
  left join workspace_a1aip8pgko71t0v2lrw9rnizs.person p on p.id = t.person_id
  where t.id = p_thread_id and (p_scope_email is null or lower(p."closerEmail") = lower(p_scope_email));
$function$;
