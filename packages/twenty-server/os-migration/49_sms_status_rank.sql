-- Delivery statuses from Twilio arrive out of order; the handler keeps the furthest one.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 49_sms_status_rank.sql
create or replace function os.sms_status_rank(p_status text)
returns integer language sql immutable as $function$
  select case lower(coalesce(p_status, ''))
    when 'accepted' then 1 when 'queued' then 1 when 'scheduled' then 1 when 'sending' then 2 when 'sent' then 3
    when 'delivered' then 4 when 'read' then 5 when 'undelivered' then 4 when 'failed' then 4 when 'canceled' then 4
    else 0 end;
$function$;

-- Raven's opener follow-up was left at queued by the race; Twilio confirms both delivered.
update os.sms_messages set provider_status = 'delivered' where provider_sid = 'SMb099ca16d1c5ccaf2031170c7dd3d0b0' and provider_status = 'queued';
