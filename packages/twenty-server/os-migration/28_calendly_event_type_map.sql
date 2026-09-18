-- Which Calendly event type is which kind of call. Edited from the Closers page ("Calendars");
-- the booking mirror reads it before falling back to the event name. Run once on the server:
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 28_calendly_event_type_map.sql
create table if not exists os.calendly_event_type_map (
  event_type_uri text primary key,
  booking_type text not null,
  updated_at timestamptz not null default now()
);

insert into os.calendly_event_type_map (event_type_uri, booking_type) values
  ('https://api.calendly.com/event_types/751b1b74-e879-424e-9d87-b57af1bcf827', 'DEMO'),
  ('https://api.calendly.com/event_types/126eb02a-2279-4f02-9574-14adf11e0fa1', 'AGENCY_DEMO'),
  ('https://api.calendly.com/event_types/fa14fa02-2853-4ffd-a314-773c664fecd1', 'DISCOVERY'),
  ('https://api.calendly.com/event_types/3dfa83c1-2699-4533-9a7d-759708e35ac7', 'DISCOVERY')
on conflict (event_type_uri) do nothing;

-- Every event type Calendly reports, with recent hosts and volume, and the mapping if one is set.
create or replace function os.get_calendly_event_types()
returns jsonb
language sql
security definer
set search_path to 'os', 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'uri', t.uri, 'name', btrim(t.name), 'active', t.active, 'duration', t.duration, 'kind', t.kind,
    'hosts', coalesce((select string_agg(distinct lower(b.host_email), ', ') from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days'), ''),
    'recent', (select count(*) from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days'),
    'booking_type', m.booking_type
  ) order by (select count(*) from os.calendly_bookings b where b.event_type_uri = t.uri and b.start_time > now() - interval '180 days') desc, t.name), '[]'::jsonb)
  from os.calendly_event_types t
  left join os.calendly_event_type_map m on m.event_type_uri = t.uri;
$$;

-- Sets or clears (null) the mapping for one event type.
create or replace function os.set_calendly_event_type(p_uri text, p_booking_type text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'os', 'public'
as $$
begin
  if p_uri is null or p_uri !~ '^https://api\.calendly\.com/event_types/[0-9a-f-]+$' then raise exception 'event type uri required'; end if;
  if p_booking_type is null or btrim(p_booking_type) = '' then
    delete from os.calendly_event_type_map where event_type_uri = p_uri;
  else
    if p_booking_type !~ '^[A-Z_]+$' then raise exception 'booking type must be a constant'; end if;
    insert into os.calendly_event_type_map (event_type_uri, booking_type, updated_at) values (p_uri, p_booking_type, now())
    on conflict (event_type_uri) do update set booking_type = excluded.booking_type, updated_at = now();
  end if;
  return jsonb_build_object('uri', p_uri, 'booking_type', p_booking_type);
end;
$$;
