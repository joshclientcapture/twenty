import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import { DataSource } from 'typeorm';

import { TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';

type BookingType =
  | 'DEMO' | 'DISCOVERY' | 'AGENCY_DEMO' | 'WEBINAR' | 'SETUP_CALL' | 'ONBOARDING' | 'DIAGNOSTICS' | 'FEEDBACK' | 'NEXT_STEPS' | 'OTHER';
type BookingStatus = 'UPCOMING' | 'SHOWED' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED';

type BookingSourceRow = {
  uri: string;
  event_name: string | null;
  status: string | null;
  start_time: string;
  end_time: string | null;
  join_url: string | null;
  host_email: string | null;
  host_name: string | null;
  closer_id: string | null;
  closer_name: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  rescheduled: boolean;
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
  { value: 'SHOWED', label: 'Showed', color: 'green' },
  { value: 'NO_SHOW', label: 'No show', color: 'red' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'gray' },
  { value: 'RESCHEDULED', label: 'Rescheduled', color: 'orange' },
];

const RECORD_BATCH_SIZE = 100;

const bookingTypeFor = (eventName: string | null): BookingType => {
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

const bookingStatusFor = (row: BookingSourceRow, now: number): BookingStatus => {
  if (row.rescheduled) return 'RESCHEDULED';
  if (row.status === 'canceled') return 'CANCELLED';
  if (new Date(row.start_time).getTime() >= now) return 'UPCOMING';
  return row.recording_url ? 'SHOWED' : 'NO_SHOW';
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

    const rows: BookingSourceRow[] = await this.dataSource.query(
      `with closers as (
         select id, name, lower(calendly_host_email) as host_email, lower(fathom_email) as fathom_email
         from os.closers where coalesce(calendly_host_email, '') <> ''
       ),
       invitees as (
         select booking_uri, max(name) as name, max(lower(email)) as email, bool_or(coalesce(rescheduled, false)) as rescheduled
         from os.calendly_invitees group by booking_uri
       )
       select b.uri, b.name as event_name, b.status, b.start_time, b.end_time, b.join_url, b.host_email, b.host_name,
              c.id as closer_id, c.name as closer_name,
              i.name as invitee_name, i.email as invitee_email, coalesce(i.rescheduled, false) as rescheduled,
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

    const personIdByEmail = await this.lookupPeople([...new Set(rows.map((row) => row.invitee_email).filter((email): email is string => !!email))]);
    const now = Date.now();
    const records = rows.map((row) => {
      const type = bookingTypeFor(row.event_name);
      const typeLabel = BOOKING_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
      const who = row.invitee_name || row.invitee_email || 'Unknown';
      return {
        name: `${who} · ${typeLabel}`,
        calendlyUri: row.uri,
        startsAt: row.start_time,
        endsAt: row.end_time,
        bookingType: type,
        status: bookingStatusFor(row, now),
        closer: row.closer_name ?? row.host_name ?? '',
        closerId: row.closer_id ?? '',
        inviteeName: row.invitee_name ?? '',
        inviteeEmail: row.invitee_email ?? '',
        eventName: row.event_name ?? '',
        recording: row.recording_url ? { primaryLinkUrl: row.recording_url, primaryLinkLabel: 'Fathom recording', secondaryLinks: [] } : null,
        joinLink: row.join_url ? { primaryLinkUrl: row.join_url, primaryLinkLabel: 'Join', secondaryLinks: [] } : null,
        personId: row.invitee_email ? personIdByEmail.get(row.invitee_email) ?? null : null,
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
    return { bookings: written, linkedToPeople: records.filter((record) => record.personId).length, windowDays };
  }

  private async lookupPeople(emails: string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (let offset = 0; offset < emails.length; offset += RECORD_BATCH_SIZE) {
      const batch = emails.slice(offset, offset + RECORD_BATCH_SIZE);
      const result = await this.twentyApi.records<{ people: { edges: { node: { id: string; emails: { primaryEmail: string | null } } }[] } }>(
        `query PeopleByEmail($emails: [String!]) {
           people(filter: { emails: { primaryEmail: { in: $emails } } }, first: ${RECORD_BATCH_SIZE}) { edges { node { id emails { primaryEmail } } } }
         }`,
        { emails: batch },
      );
      for (const { node } of result.people.edges) {
        if (node.emails.primaryEmail) found.set(node.emails.primaryEmail.toLowerCase(), node.id);
      }
    }
    return found;
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
    const wanted: { name: string; label: string; type: string; icon: string; extra?: Record<string, unknown> }[] = [
      { name: 'calendlyUri', label: 'Calendly URI', type: 'TEXT', icon: 'IconLink', extra: { isUnique: true } },
      { name: 'startsAt', label: 'Starts at', type: 'DATE_TIME', icon: 'IconCalendarClock' },
      { name: 'endsAt', label: 'Ends at', type: 'DATE_TIME', icon: 'IconCalendarClock' },
      // `type` is a reserved metadata keyword.
      { name: 'bookingType', label: 'Type', type: 'SELECT', icon: 'IconTag', extra: { options: BOOKING_TYPE_OPTIONS.map((option, position) => ({ ...option, id: randomUUID(), position })) } },
      { name: 'status', label: 'Status', type: 'SELECT', icon: 'IconProgressCheck', extra: { options: BOOKING_STATUS_OPTIONS.map((option, position) => ({ ...option, id: randomUUID(), position })) } },
      { name: 'closer', label: 'Closer', type: 'TEXT', icon: 'IconUser' },
      { name: 'closerId', label: 'Closer id', type: 'TEXT', icon: 'IconId' },
      { name: 'inviteeName', label: 'Invitee', type: 'TEXT', icon: 'IconUserCircle' },
      { name: 'inviteeEmail', label: 'Invitee email', type: 'TEXT', icon: 'IconMail' },
      { name: 'eventName', label: 'Calendly event', type: 'TEXT', icon: 'IconCalendar' },
      { name: 'recording', label: 'Recording', type: 'LINKS', icon: 'IconVideo' },
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
