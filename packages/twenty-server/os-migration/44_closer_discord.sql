-- Each closer's Discord channel lives on the closer row, so the "new call booked" card needs no
-- rebuild when a closer joins: the workflow asks the server which channel and name the host maps to.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 44_closer_discord.sql
set search_path to os, public;

alter table os.closers add column if not exists discord_webhook text;

-- get_closers / upsert_closer expose it so the Closers page can edit it.
create or replace function os.get_closers()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'email', login_email, 'fathom_email', fathom_email,
    'calendly_host_email', calendly_host_email, 'commission_rate', commission_rate,
    'commissioned', commissioned, 'tracked', tracked, 'active', active, 'discord_webhook', discord_webhook
  ) order by sort_order, name), '[]'::jsonb) from os.closers;
$function$;

create or replace function os.set_closer_discord(p_closer_id text, p_webhook text)
returns void language sql security definer set search_path to 'os', 'public' as $function$
  update os.closers set discord_webhook = nullif(btrim(p_webhook), '') where id = p_closer_id;
$function$;
