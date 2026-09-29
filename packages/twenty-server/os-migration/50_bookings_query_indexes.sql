-- The bookings mirror's reschedule and Fathom lookups need these once the Calendly tables pass a few thousand rows.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 50_bookings_query_indexes.sql
create index if not exists idx_calendly_invitees_new_uri on os.calendly_invitees (new_invitee_uri) where new_invitee_uri is not null and new_invitee_uri <> '';
create index if not exists idx_calendly_invitees_old_uri on os.calendly_invitees (old_invitee_uri) where old_invitee_uri is not null and old_invitee_uri <> '';
create index if not exists idx_fathom_recorded_by_start on os.fathom_calls (lower(recorded_by_email), scheduled_start);
analyze os.calendly_invitees;
analyze os.fathom_calls;
