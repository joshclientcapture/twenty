import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import { DataSource } from 'typeorm';

import { TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';

type BookingType =
  | 'DEMO' | 'DISCOVERY' | 'AGENCY_DEMO' | 'WEBINAR' | 'SETUP_CALL' | 'ONBOARDING' | 'DIAGNOSTICS' | 'FEEDBACK' | 'NEXT_STEPS' | 'OTHER';
type BookingStatus = 'UPCOMING' | 'IN_PROGRESS' | 'SHOWED' | 'NO_SHOW' | 'COMPLETED' | 'CANCELLED' | 'RESCHEDULED';

type BookingSourceRow = {
  uri: string;
  event_name: string | null;
  event_type_uri: string | null;
  status: string | null;
  start_time: string;
  booked_at: string | null;
  end_time: string | null;
  join_url: string | null;
  host_email: string | null;
  host_name: string | null;
  closer_id: string | null;
  closer_name: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  invitee_first_name: string | null;
  invitee_timezone: string | null;
  reschedule_url: string | null;
  cancel_url: string | null;
  rescheduled: boolean;
  cancel_reason: string | null;
  recording_url: string | null;
};

type MetadataField = { id: string; name: string; type: string };
type MetadataObject = { id: string; nameSingular: string; fieldsList: MetadataField[] };
type ObjectsQueryResult = { objects: { edges: { node: MetadataObject }[] } };

const BOOKING_TYPE_OPTIONS: { value: BookingType; label: string; color: string }[] = [
  { value: 'DEMO', label: 'Demo', color: 'blue' },
  { value: 'DISCOVERY', label: 'Discovery', color: 'purple' },
  { value: 'AGENCY_DEMO', label: 'Agency demo', color: 'turquoise' },
  { value: 'WEBINAR', label: 'Webinar', color: 'pink' },
  { value: 'SETUP_CALL', label: 'Set-up call', color: 'green' },
  { value: 'ONBOARDING', label: 'Onboarding', color: 'sky' },
  { value: 'DIAGNOSTICS', label: 'Diagnostics', color: 'yellow' },
  { value: 'FEEDBACK', label: 'Feedback', color: 'orange' },
  { value: 'NEXT_STEPS', label: 'Next steps', color: 'gray' },
  { value: 'OTHER', label: 'Other', color: 'gray' },
];

const BOOKING_STATUS_OPTIONS: { value: BookingStatus; label: string; color: string }[] = [
  { value: 'UPCOMING', label: 'Upcoming', color: 'blue' },
  { value: 'IN_PROGRESS', label: 'In progress', color: 'purple' },
  { value: 'SHOWED', label: 'Showed', color: 'green' },
  { value: 'NO_SHOW', label: 'No show', color: 'red' },
  { value: 'COMPLETED', label: 'Completed', color: 'gray' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'gray' },
  { value: 'RESCHEDULED', label: 'Rescheduled', color: 'orange' },
];

const RECORD_BATCH_SIZE = 100;
const NAME_MATCH_WINDOW_MS = 60 * 60 * 1000;
const normaliseName = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, '').trim().split(/\s+/).filter(Boolean).join(' ');

// Event types mapped on the Closers page ("Calendars", os.calendly_event_type_map) win: names change
// when hosts are pooled or calendars renamed, the id does not. Everything else goes by name.
const BOOKING_TYPE_VALUES = new Set<string>(BOOKING_TYPE_OPTIONS.map((option) => option.value));
const bookingTypeFor = (eventName: string | null, eventTypeUri: string | null, mapped: Map<string, string>): BookingType => {
  const pinned = eventTypeUri ? mapped.get(eventTypeUri) : undefined;
  if (pinned && BOOKING_TYPE_VALUES.has(pinned)) return pinned as BookingType;
  const name = (eventName ?? '').toLowerCase();
  if (name.includes('next steps')) return 'NEXT_STEPS';
  if (name.includes('agency demo')) return 'AGENCY_DEMO';
  if (name.includes('live demo') || name.includes('webinar')) return 'WEBINAR';
  if (name.includes('demo')) return 'DEMO';
  if (name.includes('discovery')) return 'DISCOVERY';
  if (name.includes('set up') || name.includes('setup')) return 'SETUP_CALL';
  if (name.includes('onboarding')) return 'ONBOARDING';
  if (name.includes('diagnostic')) return 'DIAGNOSTICS';
  if (name.includes('feedback')) return 'FEEDBACK';
  return 'OTHER';
};

// Only sales calls get a show / no-show verdict; support calls have no recording to judge them by
// and a webinar seat is judged by the webinar's own attendance events.
const SUPPORT_TYPES = new Set<BookingType>(['SETUP_CALL', 'ONBOARDING', 'DIAGNOSTICS', 'FEEDBACK']);
const WEBINAR_ATTENDANCE_EVENTS = ['entered', 'reached_offer', 'offer_click', 'trial_click', 'paid'];
const WEBINAR_ATTENDANCE_BEFORE_MS = 60 * 60 * 1000;
const WEBINAR_ATTENDANCE_AFTER_MS = 4 * 60 * 60 * 1000;

// A person who books the same calendar with the same host several times in a burst blocks the
// host's day with copies. Only the slot they booked last is mirrored; the rest are logged, and a
// host cancelling them on Calendly with this reason keeps them out for good.
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
const DUPLICATE_CANCEL_REASON = 'Duplicate booking';
const findDuplicateBookings = (rows: BookingSourceRow[]) => {
  const duplicates = new Set<string>();
  const groups = new Map<string, BookingSourceRow[]>();
  for (const row of rows) {
    if (row.status === 'canceled' || !row.invitee_email || !row.booked_at) continue;
    const key = `${row.invitee_email}|${row.event_type_uri ?? row.event_name}|${(row.host_email ?? '').toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const byBooked = [...group].sort((a, b) => new Date(a.booked_at!).getTime() - new Date(b.booked_at!).getTime());
    for (let index = 0; index < byBooked.length - 1; index += 1) {
      const gap = new Date(byBooked[index + 1].booked_at!).getTime() - new Date(byBooked[index].booked_at!).getTime();
      if (gap <= DUPLICATE_WINDOW_MS) duplicates.add(byBooked[index].uri);
    }
  }
  return duplicates;
};

// Same rule as os.closer_call_rows (the closer dashboard) for bookings whose host is not a closer:
// in progress until 30 minutes after the scheduled end, then the outcome by booking type.
const GRACE_MS = 30 * 60 * 1000;
const DEFAULT_CALL_MS = 30 * 60 * 1000;
const fallbackStatusFor = (row: BookingSourceRow, type: BookingType, now: number, webinarAttendance: Map<string, number[]>): BookingStatus => {
  if (row.status === 'canceled') return 'CANCELLED';
  if (row.rescheduled) return 'RESCHEDULED';
  if (row.recording_url) return 'SHOWED';
  const start = new Date(row.start_time).getTime();
  const end = row.end_time ? new Date(row.end_time).getTime() : start + DEFAULT_CALL_MS;
  if (end + GRACE_MS > now) return start > now ? 'UPCOMING' : 'IN_PROGRESS';
  if (type === 'WEBINAR') {
    const attended = (webinarAttendance.get((row.invitee_email ?? '').toLowerCase()) ?? [])
      .some((at) => at >= start - WEBINAR_ATTENDANCE_BEFORE_MS && at <= start + WEBINAR_ATTENDANCE_AFTER_MS);
    return attended ? 'SHOWED' : 'NO_SHOW';
  }
  if (SUPPORT_TYPES.has(type)) return 'COMPLETED';
  return 'NO_SHOW';
};

// The closer dashboard's verdict per call: recording within 15 minutes, attributed trial, manual
// overrides from the closer page. Bookings mirror it so a no-show here means a no-show there.
type CloserCallRow = { call_key: string; status: string; trialed: boolean; recording: string | null; overridden: boolean };
const DASHBOARD_STATUS: Record<string, BookingStatus> = {
  showed: 'SHOWED', no_show: 'NO_SHOW', in_progress: 'IN_PROGRESS', upcoming: 'UPCOMING', cancelled: 'CANCELLED', rescheduled: 'RESCHEDULED',
};

// Mirrors Calendly bookings (with the closer, the Fathom recording and the outcome) into a Booking
// object in the Twenty workspace, so calls can be seen on a calendar and drive workflows.
@Injectable()
export class OsBookingsService {
  private readonly logger = new Logger(OsBookingsService.name);
  private fieldIds: Record<string, string> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  async sync(windowDays: number) {
    if (!this.twentyApi.isConfigured()) return { skipped: 'no OS_TWENTY_API_KEY' };
    await this.ensureMetadata();

    const allRows: BookingSourceRow[] = await this.dataSource.query(
      `with closers as (
         select id, name, lower(calendly_host_email) as host_email, lower(fathom_email) as fathom_email
         from os.closers where coalesce(calendly_host_email, '') <> ''
       ),
       invitees as (
         select booking_uri, max(name) as name, max(lower(email)) as email, bool_or(coalesce(rescheduled, false)) as rescheduled, max(cancel_reason) as cancel_reason,
                max(first_name) as first_name, max(timezone) as timezone, max(reschedule_url) as reschedule_url, max(cancel_url) as cancel_url
         from os.calendly_invitees group by booking_uri
       )
       select b.uri, b.name as event_name, b.event_type_uri, b.status, b.start_time, b.end_time, b.booked_at, b.join_url, b.host_email, b.host_name,
              c.id as closer_id, c.name as closer_name,
              i.name as invitee_name, i.email as invitee_email, coalesce(i.rescheduled, false) as rescheduled, i.cancel_reason,
              i.first_name as invitee_first_name, i.timezone as invitee_timezone, i.reschedule_url, i.cancel_url,
              f.recording_url
       from os.calendly_bookings b
       left join closers c on c.host_email = lower(b.host_email)
       left join invitees i on i.booking_uri = b.uri
       left join lateral (
         select coalesce(f.share_url, f.fathom_url) as recording_url
         from os.fathom_calls f
         where c.fathom_email is not null and lower(f.recorded_by_email) = c.fathom_email and f.scheduled_start = b.start_time
         order by f.recording_id limit 1
       ) f on true
       where b.start_time >= now() - ($1::int * interval '1 day')
       order by b.start_time`,
      [windowDays],
    );

    const mappedTypes = new Map<string, string>(
      (await this.dataSource.query('select event_type_uri, booking_type from os.calendly_event_type_map') as { event_type_uri: string; booking_type: string }[])
        .map((row) => [row.event_type_uri, row.booking_type]),
    );
    // Sales calendars come from the Closers page mapping; support calendars are recognised by name.
    // Everything else (30-minute meetings, recruitment, one-offs) stays out of the CRM.
    const duplicateUris = findDuplicateBookings(allRows);
    if (duplicateUris.size) this.logger.warn(`${duplicateUris.size} duplicate bookings (same invitee, calendar and host within ${DUPLICATE_WINDOW_MS / 60000} minutes) left out of the CRM`);
    const isKept = (row: BookingSourceRow) =>
      bookingTypeFor(row.event_name, row.event_type_uri, mappedTypes) !== 'OTHER'
      && !(row.status === 'canceled' && (row.cancel_reason ?? '').startsWith(DUPLICATE_CANCEL_REASON))
      && !duplicateUris.has(row.uri);
    const keptRows = allRows.filter(isKept);
    const staleUris = allRows.filter((row) => !isKept(row)).map((row) => row.uri);
    const closerIds: { id: string }[] = await this.dataSource.query("select id from os.closers where coalesce(calendly_host_email, '') <> ''");
    const fromDate = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
    const verdictByUri = new Map<string, CloserCallRow>();
    for (const { id } of closerIds) {
      const verdicts: CloserCallRow[] = await this.dataSource.query(
        "select call_key, status, trialed, recording, overridden from os.closer_call_rows($1, $2::date, null) where kind = 'appt'",
        [id, fromDate],
      );
      for (const verdict of verdicts) verdictByUri.set(verdict.call_key, verdict);
    }

    const webinarAttendance = new Map<string, number[]>();
    const attendanceRows: { email: string; occurred_at: string }[] = await this.dataSource.query(
      `select lower(email) as email, occurred_at from os.webinar_events
       where event = any($1) and email is not null and occurred_at >= now() - ($2::int * interval '1 day')`,
      [WEBINAR_ATTENDANCE_EVENTS, windowDays + 1],
    );
    for (const row of attendanceRows) webinarAttendance.set(row.email, [...(webinarAttendance.get(row.email) ?? []), new Date(row.occurred_at).getTime()]);

    // Full map, so a booking made from a merged person's second address still links.
    const personIdByEmail = await this.twentyApi.peopleByEmail();
    const rows = keptRows;
    const personIdByName = await this.matchRecentLeadsByName(rows, personIdByEmail);
    const now = Date.now();
    const records = rows.map((row) => {
      const verdict = verdictByUri.get(row.uri);
      const type = bookingTypeFor(row.event_name, row.event_type_uri, mappedTypes);
      // The closer dashboard's verdict is about sales calls; a closer's own set-up call is still support.
      const status = (!SUPPORT_TYPES.has(type) && verdict && DASHBOARD_STATUS[verdict.status]) || fallbackStatusFor(row, type, now, webinarAttendance);
      const recordingUrl = verdict?.recording ?? row.recording_url;
      const typeLabel = BOOKING_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
      const who = row.invitee_name || row.invitee_email || 'Unknown';
      return {
        name: `${who} · ${typeLabel}`,
        calendlyUri: row.uri,
        startsAt: row.start_time,
        endsAt: row.end_time,
        bookedAt: row.booked_at,
        bookingType: type,
        status,
        trialed: verdict?.trialed ?? false,
        overridden: verdict?.overridden ?? false,
        closer: row.closer_name ?? row.host_name ?? '',
        closerId: row.closer_id ?? '',
        inviteeName: row.invitee_name ?? '',
        inviteeEmail: row.invitee_email ?? '',
        inviteeFirstName: row.invitee_first_name ?? (row.invitee_name ?? '').split(/s+/)[0] ?? '',
        inviteeTimezone: row.invitee_timezone ?? '',
        closerEmail: (row.host_email ?? '').toLowerCase(),
        rescheduleLink: row.reschedule_url ? { primaryLinkUrl: row.reschedule_url, primaryLinkLabel: 'Reschedule', secondaryLinks: [] } : null,
        cancelLink: row.cancel_url ? { primaryLinkUrl: row.cancel_url, primaryLinkLabel: 'Cancel', secondaryLinks: [] } : null,
        eventName: row.event_name ?? '',
        recording: recordingUrl ? { primaryLinkUrl: recordingUrl, primaryLinkLabel: 'Fathom recording', secondaryLinks: [] } : null,
        joinLink: row.join_url ? { primaryLinkUrl: row.join_url, primaryLinkLabel: 'Join', secondaryLinks: [] } : null,
        personId: row.invitee_email ? personIdByEmail.get(row.invitee_email) ?? personIdByName.get(row.uri) ?? null : null,
      };
    });

    let written = 0;
    for (let offset = 0; offset < records.length; offset += RECORD_BATCH_SIZE) {
      const batch = records.slice(offset, offset + RECORD_BATCH_SIZE);
      await this.twentyApi.records(
        `mutation UpsertBookings($data: [BookingCreateInput!]!) { createBookings(data: $data, upsert: true) { id } }`,
        { data: batch },
      );
      written += batch.length;
    }
    // Bookings mirrored earlier from calendars that are no longer kept are removed.
    let removed = 0;
    for (let offset = 0; offset < staleUris.length; offset += RECORD_BATCH_SIZE) {
      const uris = staleUris.slice(offset, offset + RECORD_BATCH_SIZE);
      const result = await this.twentyApi.records<{ deleteBookings: { id: string }[] }>(
        `mutation DropUnmappedBookings($uris: [String!]) { deleteBookings(filter: { calendlyUri: { in: $uris } }) { id } }`,
        { uris },
      );
      removed += result.deleteBookings.length;
    }
    return { bookings: written, linkedToPeople: records.filter((record) => record.personId).length, removed, windowDays };
  }

  // A lead who books with a different address than the one they typed in the form minutes earlier
  // is matched by normalised name when the Person was created within an hour before the booking;
  // the Calendly address is then added to the Person so later runs match by email.
  private async matchRecentLeadsByName(rows: BookingSourceRow[], personIdByEmail: Map<string, string>): Promise<Map<string, string>> {
    const matches = new Map<string, string>();
    const unmatched = rows.filter((row) => row.invitee_email && row.invitee_name && row.booked_at && !personIdByEmail.has(row.invitee_email));
    if (unmatched.length === 0) return matches;
    const since = new Date(Math.min(...unmatched.map((row) => new Date(row.booked_at as string).getTime())) - NAME_MATCH_WINDOW_MS).toISOString();
    const result = await this.twentyApi.records<{ people: { edges: { node: { id: string; createdAt: string; name: { firstName: string; lastName: string }; emails: { primaryEmail: string | null; additionalEmails: string[] | null } } }[] } }>(
      `query RecentPeople($since: DateTime!) { people(filter: { createdAt: { gte: $since } }, first: 200) { edges { node { id createdAt name { firstName lastName } emails { primaryEmail additionalEmails } } } } }`,
      { since },
    );
    const recent = result.people.edges.map((edge) => edge.node);
    for (const row of unmatched) {
      const bookedAt = new Date(row.booked_at as string).getTime();
      const wanted = normaliseName(row.invitee_name as string);
      if (!wanted) continue;
      const candidates = recent.filter((person) => {
        const createdAt = new Date(person.createdAt).getTime();
        return normaliseName(`${person.name.firstName} ${person.name.lastName}`) === wanted && createdAt <= bookedAt + 5 * 60 * 1000 && createdAt >= bookedAt - NAME_MATCH_WINDOW_MS;
      });
      if (candidates.length !== 1) continue;
      const person = candidates[0];
      const email = (row.invitee_email as string).toLowerCase();
      const additionalEmails = [...new Set([...(person.emails.additionalEmails ?? []), email])];
      await this.twentyApi.records(
        `mutation LinkBookingEmail($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`,
        { id: person.id, data: { emails: { primaryEmail: person.emails.primaryEmail, additionalEmails } } },
      );
      personIdByEmail.set(email, person.id);
      matches.set(row.uri, person.id);
      this.logger.log(`booking ${row.uri} linked by name to person ${person.id} (${email} added)`);
    }
    return matches;
  }

  // Creates the Booking object, its fields and the calendar view once; later runs only read.
  private async ensureMetadata() {
    if (this.fieldIds) return;
    const objects = await this.listObjects();
    let booking = objects.find((object) => object.nameSingular === 'booking');
    const person = objects.find((object) => object.nameSingular === 'person');
    if (!person) throw new Error('person object not found');

    if (!booking) {
      const created = await this.twentyApi.metadata<{ createOneObject: MetadataObject }>(
        `mutation CreateBookingObject($input: CreateOneObjectInput!) { createOneObject(input: $input) { id nameSingular fieldsList { id name type } } }`,
        {
          input: {
            object: {
              nameSingular: 'booking',
              namePlural: 'bookings',
              labelSingular: 'Booking',
              labelPlural: 'Bookings',
              icon: 'IconCalendarEvent',
              description: 'Calendly bookings synced from the OS with the closer, outcome and Fathom recording',
              isLabelSyncedWithName: false,
            },
          },
        },
      );
      booking = created.createOneObject;
      this.logger.log(`created booking object ${booking.id}`);
    }

    const existing = new Set(booking.fieldsList.map((field) => field.name));
    this.logger.log(`booking fields present: ${existing.size}`);
    const wanted: { name: string; label: string; type: string; icon: string; extra?: Record<string, unknown> }[] = [
      { name: 'calendlyUri', label: 'Calendly URI', type: 'TEXT', icon: 'IconLink', extra: { isUnique: true } },
      { name: 'startsAt', label: 'Starts at', type: 'DATE_TIME', icon: 'IconCalendarClock' },
      { name: 'endsAt', label: 'Ends at', type: 'DATE_TIME', icon: 'IconCalendarClock' },
      { name: 'bookedAt', label: 'Booked at', type: 'DATE_TIME', icon: 'IconCalendarPlus' },
      // `type` is a reserved metadata keyword.
      { name: 'bookingType', label: 'Type', type: 'SELECT', icon: 'IconTag', extra: { options: BOOKING_TYPE_OPTIONS.map((option, position) => ({ ...option, id: randomUUID(), position })) } },
      { name: 'status', label: 'Status', type: 'SELECT', icon: 'IconProgressCheck', extra: { options: BOOKING_STATUS_OPTIONS.map((option, position) => ({ ...option, id: randomUUID(), position })) } },
      { name: 'closer', label: 'Closer', type: 'TEXT', icon: 'IconUser' },
      { name: 'closerId', label: 'Closer id', type: 'TEXT', icon: 'IconId' },
      { name: 'inviteeName', label: 'Invitee', type: 'TEXT', icon: 'IconUserCircle' },
      { name: 'inviteeEmail', label: 'Invitee email', type: 'TEXT', icon: 'IconMail' },
      { name: 'inviteeFirstName', label: 'Invitee first name', type: 'TEXT', icon: 'IconUserCircle' },
      { name: 'inviteeTimezone', label: 'Invitee timezone', type: 'TEXT', icon: 'IconWorld' },
      { name: 'closerEmail', label: 'Closer email', type: 'TEXT', icon: 'IconMail' },
      { name: 'rescheduleLink', label: 'Reschedule link', type: 'LINKS', icon: 'IconCalendarRepeat' },
      { name: 'cancelLink', label: 'Cancel link', type: 'LINKS', icon: 'IconCalendarX' },
      { name: 'eventName', label: 'Calendly event', type: 'TEXT', icon: 'IconCalendar' },
      { name: 'recording', label: 'Recording', type: 'LINKS', icon: 'IconVideo' },
      { name: 'trialed', label: 'Trialed after call', type: 'BOOLEAN', icon: 'IconRocket', extra: { defaultValue: false } },
      { name: 'overridden', label: 'Manually overridden', type: 'BOOLEAN', icon: 'IconHandStop', extra: { defaultValue: false } },
      { name: 'joinLink', label: 'Join link', type: 'LINKS', icon: 'IconVideo' },
      {
        name: 'person', label: 'Person', type: 'RELATION', icon: 'IconUser',
        extra: { relationCreationPayload: { targetObjectMetadataId: person.id, targetFieldLabel: 'Bookings', targetFieldIcon: 'IconCalendarEvent', type: 'MANY_TO_ONE' } },
      },
    ];
    for (const field of wanted) {
      if (existing.has(field.name)) continue;
      await this.twentyApi.metadata(
        `mutation CreateBookingField($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id name } }`,
        { input: { field: { objectMetadataId: booking.id, name: field.name, label: field.label, type: field.type, icon: field.icon, ...(field.extra ?? {}) } } },
      );
      this.logger.log(`created booking field ${field.name}`);
    }

    const refreshed = (await this.listObjects()).find((object) => object.nameSingular === 'booking');
    if (!refreshed) throw new Error('booking object vanished after setup');
    const fieldIds = Object.fromEntries(refreshed.fieldsList.map((field) => [field.name, field.id]));
    await this.twentyApi.ensureSelectOptions('booking', 'status', BOOKING_STATUS_OPTIONS);
    await this.ensureCalendarView(refreshed.id, fieldIds);
    this.fieldIds = fieldIds;
  }

  private async ensureCalendarView(objectMetadataId: string, fieldIds: Record<string, string>) {
    const { getViews } = await this.twentyApi.metadata<{ getViews: { id: string; name: string; type: string }[] }>(
      `query BookingViews($objectMetadataId: String) { getViews(objectMetadataId: $objectMetadataId) { id name type } }`,
      { objectMetadataId },
    );
    if (getViews.some((view) => view.type === 'CALENDAR')) return;
    await this.twentyApi.metadata(
      `mutation CreateBookingCalendarView($input: CreateViewInput!) { createView(input: $input) { id } }`,
      {
        input: {
          name: 'Calendar',
          objectMetadataId,
          type: 'CALENDAR',
          icon: 'IconCalendar',
          calendarLayout: 'WEEK',
          calendarFieldMetadataId: fieldIds.startsAt,
          calendarEndFieldMetadataId: fieldIds.endsAt,
        },
      },
    );
    this.logger.log('created booking calendar view');
  }

  private async listObjects(): Promise<MetadataObject[]> {
    const result = await this.twentyApi.metadata<ObjectsQueryResult>(
      `query OsObjects { objects(paging: { first: 1000 }) { edges { node { id nameSingular fieldsList { id name type } } } } }`,
    );
    return result.objects.edges.map((edge) => edge.node);
  }
}
