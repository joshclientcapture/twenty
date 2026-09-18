-- Adds the booking URL to the event type listing used by the Closers page "Calendars" section.
alter table os.calendly_event_types add column if not exists scheduling_url text;

create or replace function os.get_calendly_event_types()
returns jsonb
language sql
security definer
set search_path to 'os', 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'uri', t.uri, 'name', btrim(t.name), 'active', t.active, 'duration', t.duration, 'kind', t.kind,
    'url', t.scheduling_url,
    'hosts', coalesce((select string_agg(distinct lower(b.host_email), ', ') from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days'), ''),
    'recent', (select count(*) from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days'),
    'booking_type', m.booking_type
  ) order by (select count(*) from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days') desc, t.name), '[]'::jsonb)
  from os.calendly_event_types t
  left join os.calendly_event_type_map m on m.event_type_uri = t.uri;
$$;
