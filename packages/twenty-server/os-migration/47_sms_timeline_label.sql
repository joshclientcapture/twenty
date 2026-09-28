-- Texts get their own timeline line: a second activity type for messages on the SMS channel, and a
-- relabel pass that moves the automatically created "message" entries onto it.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 47_sms_timeline_label.sql
set search_path to os, public;

-- No action: the type is never emitted by a rule (the relabel below assigns it), and the base emit slot
-- (workspace, action, object, relation) must stay unique for typed rows.
insert into core."timelineActivityType" ("workspaceId", "universalIdentifier", "applicationId", name, label, action, icon, "isActive")
select 'a984b071-b213-4117-9f6e-106129143ee8', '5a5c0000-0000-4000-8000-00000000c0e0', "applicationId", 'smsLinked', 'sent or received a text', null, 'IconMessage', true
from core."timelineActivityType" where "workspaceId" = 'a984b071-b213-4117-9f6e-106129143ee8' and name = 'messageLinked'
and not exists (select 1 from core."timelineActivityType" where "workspaceId" = 'a984b071-b213-4117-9f6e-106129143ee8' and name = 'smsLinked');

-- Entries for messages on the SMS channel are moved to the text type; safe to run every minute.
create or replace function os.relabel_sms_timeline()
returns integer language plpgsql security definer set search_path to 'os', 'public' as $function$
declare n int; t record;
begin
  select id, name, label, action, icon, "universalIdentifier" into t from core."timelineActivityType"
  where "workspaceId" = 'a984b071-b213-4117-9f6e-106129143ee8' and name = 'smsLinked';
  if t.id is null then return 0; end if;
  update workspace_a1aip8pgko71t0v2lrw9rnizs."timelineActivity" a
  set "timelineActivityTypeId" = t.id,
      "timelineActivityTypeSnapshot" = jsonb_build_object('id', t.id, 'name', t.name, 'label', t.label, 'action', 'linked', 'icon', t.icon, 'universalIdentifier', t."universalIdentifier")
  where a."timelineActivityTypeSnapshot"->>'name' = 'messageLinked'
    and a."linkedRecordId" in (select "messageId" from workspace_a1aip8pgko71t0v2lrw9rnizs."messageChannelMessageAssociation" where "messageChannelId" = '5a5c0000-0000-4000-8000-00000000c0df');
  get diagnostics n = row_count;
  return n;
end $function$;

select os.relabel_sms_timeline();

-- The person page tab that holds both channels.
update core."pageLayoutTab" set title = 'Messages' where id = 'eb76f23e-e2f9-42a5-9ae0-80f3fcc318ff' and title = 'Emails';
update core."pageLayoutWidget" set title = 'Messages' where "pageLayoutTabId" = 'eb76f23e-e2f9-42a5-9ae0-80f3fcc318ff' and title = 'Emails';
