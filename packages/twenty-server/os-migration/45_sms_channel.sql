-- Texts live in Twenty's own message model: one connected account and one message channel of type SMS
-- for the Twilio number, so texts show in the contact's Emails inbox next to email threads.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 45_sms_channel.sql
set search_path to os, public;

alter table os.sms_threads add column if not exists message_thread_id uuid;
alter table os.sms_messages add column if not exists message_id uuid;

-- The account is owned by Jamal's login; the channel shares everything with the workspace.
insert into core."connectedAccount" (id, "workspaceId", handle, provider, "userWorkspaceId", name, visibility, "handleAliases", scopes)
select '5a5c0000-0000-4000-8000-00000000c0de', 'a984b071-b213-4117-9f6e-106129143ee8', '+447782239664', 'app', 'ab7f2c1a-3a76-434b-9de8-909930d16131', 'Melanie (SMS)', 'workspace', '{+16282138598}', '{}'
where not exists (select 1 from core."connectedAccount" where id = '5a5c0000-0000-4000-8000-00000000c0de');

insert into core."messageChannel" (id, "workspaceId", visibility, handle, type, "isContactAutoCreationEnabled", "contactAutoCreationPolicy", "messageFolderImportPolicy", "excludeNonProfessionalEmails", "excludeGroupEmails", "pendingGroupEmailsAction", "isSyncEnabled", "syncStatus", "syncStage", "throttleFailureCount", "connectedAccountId", "displayName")
select '5a5c0000-0000-4000-8000-00000000c0df', 'a984b071-b213-4117-9f6e-106129143ee8', 'SHARE_EVERYTHING', '+447782239664', 'SMS', false, 'NONE', 'ALL_FOLDERS', false, false, 'NONE', false, 'NOT_SYNCED', 'PENDING_CONFIGURATION', 0, '5a5c0000-0000-4000-8000-00000000c0de', 'Melanie (SMS)'
where not exists (select 1 from core."messageChannel" where id = '5a5c0000-0000-4000-8000-00000000c0df');

-- The timeline line for a message no longer assumes it was an email.
update core."timelineActivityType" set label = 'sent or received a message'
where "workspaceId" = 'a984b071-b213-4117-9f6e-106129143ee8' and name = 'messageLinked' and label = 'sent or received an email';
