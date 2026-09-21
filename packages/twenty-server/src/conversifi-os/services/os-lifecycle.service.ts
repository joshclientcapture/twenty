import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { companyNameFor, domainOf } from 'src/conversifi-os/services/os-contacts-import.service';
import { selectOptions, TwentyApiService, type WantedField } from 'src/conversifi-os/services/twenty-api.service';

export type LifecycleStage =
  | 'LEAD' | 'BOOKED' | 'SHOWED' | 'NO_SHOW' | 'SIGNED_UP' | 'TRIAL' | 'TRIAL_ENDED' | 'PAYING' | 'CHURNED' | 'DFY_CLIENT' | 'NOT_INTERESTED';

export const STAGE_OPTIONS: { value: LifecycleStage; label: string; color: string }[] = [
  { value: 'LEAD', label: 'Lead', color: 'gray' },
  { value: 'BOOKED', label: 'Call booked', color: 'blue' },
  { value: 'SHOWED', label: 'Showed', color: 'sky' },
  { value: 'NO_SHOW', label: 'No show', color: 'red' },
  { value: 'SIGNED_UP', label: 'Signed up', color: 'yellow' },
  { value: 'TRIAL', label: 'Trial', color: 'orange' },
  { value: 'TRIAL_ENDED', label: 'Trial ended (never paid)', color: 'red' },
  { value: 'PAYING', label: 'Paying', color: 'green' },
  { value: 'CHURNED', label: 'Churned', color: 'purple' },
  { value: 'DFY_CLIENT', label: 'DFY client', color: 'turquoise' },
  { value: 'NOT_INTERESTED', label: 'Not interested', color: 'gray' },
];

const BOOKING_STATUS_OPTIONS = [
  { value: 'UPCOMING', label: 'Upcoming', color: 'blue' },
  { value: 'IN_PROGRESS', label: 'In progress', color: 'purple' },
  { value: 'SHOWED', label: 'Showed', color: 'green' },
  { value: 'NO_SHOW', label: 'No show', color: 'red' },
  { value: 'COMPLETED', label: 'Completed', color: 'gray' },
  { value: 'CANCELLED', label: 'Cancelled', color: 'gray' },
  { value: 'RESCHEDULED', label: 'Rescheduled', color: 'orange' },
];
const BOOKING_TYPE_OPTIONS = [
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

// Fields the sequences and the closer pages read; the intake workflows write the dated ones too.
export const LIFECYCLE_FIELDS: WantedField[] = [
  { name: 'stage', label: 'Stage', type: 'SELECT', icon: 'IconProgress', extra: { options: selectOptions(STAGE_OPTIONS) } },
  { name: 'notInterested', label: 'Not interested', type: 'BOOLEAN', icon: 'IconHandStop', extra: { defaultValue: false } },
  { name: 'doNotEmail', label: 'Do not email', type: 'BOOLEAN', icon: 'IconMailOff', extra: { defaultValue: false } },
  { name: 'signedUpAt', label: 'Signed up at', type: 'DATE_TIME', icon: 'IconUserPlus' },
  { name: 'trialStartedAt', label: 'Trial started at', type: 'DATE_TIME', icon: 'IconRocket' },
  { name: 'payingSince', label: 'Paying since', type: 'DATE_TIME', icon: 'IconCoin' },
  { name: 'churnedAt', label: 'Churned at', type: 'DATE_TIME', icon: 'IconUserOff' },
  { name: 'trialEndedAt', label: 'Trial ended at (never paid)', type: 'DATE_TIME', icon: 'IconHourglassOff' },
  { name: 'latestFormAt', label: 'Latest form at', type: 'DATE_TIME', icon: 'IconForms' },
  { name: 'lastBookingAt', label: 'Last call at', type: 'DATE_TIME', icon: 'IconCalendarEvent' },
  { name: 'lastBookingStatus', label: 'Last call outcome', type: 'SELECT', icon: 'IconProgressCheck', extra: { options: selectOptions(BOOKING_STATUS_OPTIONS) } },
  { name: 'lastBookingType', label: 'Last call type', type: 'SELECT', icon: 'IconTag', extra: { options: selectOptions(BOOKING_TYPE_OPTIONS) } },
  { name: 'nextBookingAt', label: 'Next call at', type: 'DATE_TIME', icon: 'IconCalendarClock' },
  { name: 'webinarOfferLink', label: 'Webinar offer link', type: 'TEXT', icon: 'IconLink' },
  // Latest of: became a lead, form, booking made, signup, trial, payment, churn. The People list sorts on it.
  { name: 'lastActivityAt', label: 'Last activity', type: 'DATE_TIME', icon: 'IconActivity' },
];

type PersonRow = {
  id: string;
  createdAt: string;
  latestFormAt: string | null;
  lastActivityAt: string | null;
  emails: { primaryEmail: string | null; additionalEmails: string[] | null };
  companyId: string | null;
  closer: string | null;
  ghlTags: string[] | null;
  notInterested: boolean | null;
  stage: string | null;
  signedUpAt: string | null;
  trialStartedAt: string | null;
  payingSince: string | null;
  churnedAt: string | null;
  trialEndedAt: string | null;
  lastBookingAt: string | null;
  lastBookingStatus: string | null;
  lastBookingType: string | null;
  nextBookingAt: string | null;
};

type BookingRow = { personId: string | null; startsAt: string; bookedAt: string | null; status: string; bookingType: string; closer: string | null };
const SALES_BOOKING_TYPES = new Set<string>(['DISCOVERY', 'DEMO', 'AGENCY_DEMO', 'NEXT_STEPS']);

type StripeFacts = { email: string; signed_up_at: string | null; trial_started_at: string | null; paying_since: string | null; churned_at: string | null; trial_ended_at: string | null; last_event_at: string | null; has_live_subscription: boolean };

const PAGE = 200;
const BATCH = 100;

export const stageFor = (person: Pick<PersonRow, 'notInterested' | 'ghlTags' | 'stage' | 'payingSince' | 'churnedAt' | 'trialEndedAt' | 'trialStartedAt' | 'signedUpAt' | 'nextBookingAt' | 'lastBookingStatus'>): LifecycleStage => {
  if (person.notInterested) return 'NOT_INTERESTED';
  if ((person.ghlTags ?? []).includes('DFY_CLIENT') || person.stage === 'DFY_CLIENT') return 'DFY_CLIENT';
  if (person.payingSince && (!person.churnedAt || person.payingSince > person.churnedAt)) return 'PAYING';
  if (person.churnedAt) return 'CHURNED';
  // A cancelled trial that never paid is not customer churn; it gets its own state and nurture.
  if (person.trialEndedAt) return 'TRIAL_ENDED';
  if (person.trialStartedAt) return 'TRIAL';
  if (person.signedUpAt) return 'SIGNED_UP';
  if (person.nextBookingAt || person.lastBookingStatus === 'UPCOMING' || person.lastBookingStatus === 'IN_PROGRESS') return 'BOOKED';
  if (person.lastBookingStatus === 'SHOWED') return 'SHOWED';
  if (person.lastBookingStatus === 'NO_SHOW') return 'NO_SHOW';
  return 'LEAD';
};

// Keeps every Person's lifecycle in step with the OS data the custom pages show: Stripe dates, the
// latest and next call from the Bookings mirror, the company from the email domain, and a single
// derived stage. Only changed people are written, so workflows on person updates fire once per change.
@Injectable()
export class OsLifecycleService {
  private readonly logger = new Logger(OsLifecycleService.name);
  private fieldsReady = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  async ensureFields() {
    if (this.fieldsReady) return;
    await this.twentyApi.ensureFields('person', LIFECYCLE_FIELDS);
    await this.twentyApi.ensureSelectOptions('person', 'stage', selectOptions(STAGE_OPTIONS));
    await this.twentyApi.ensureSelectOptions('person', 'lastBookingStatus', selectOptions(BOOKING_STATUS_OPTIONS));
    this.fieldsReady = true;
  }

  async sync() {
    if (!this.twentyApi.isConfigured()) return { skipped: 'no OS_TWENTY_API_KEY' };
    await this.ensureFields();
    const [people, bookings, stripe] = await Promise.all([this.allPeople(), this.allBookings(), this.stripeFacts()]);
    const now = new Date().toISOString();

    const bookingsByPerson = new Map<string, BookingRow[]>();
    for (const booking of bookings) {
      if (!booking.personId) continue;
      const list = bookingsByPerson.get(booking.personId) ?? [];
      list.push(booking);
      bookingsByPerson.set(booking.personId, list);
    }

    const wantedDomains = new Set<string>();
    for (const person of people) {
      if (person.companyId) continue;
      const domain = [person.emails.primaryEmail, ...(person.emails.additionalEmails ?? [])].filter((email): email is string => !!email).map((email) => domainOf(null, email.toLowerCase())).find((value) => !!value);
      if (domain) wantedDomains.add(domain);
    }
    const companyIdByDomain = await this.upsertCompanies([...wantedDomains]);

    const patches: Record<string, unknown>[] = [];
    let companiesLinked = 0;
    for (const person of people) {
      const emails = [person.emails.primaryEmail, ...(person.emails.additionalEmails ?? [])].filter((email): email is string => !!email).map((email) => email.toLowerCase());
      const facts = emails.map((email) => stripe.get(email)).filter((fact): fact is StripeFacts => !!fact);
      const earliest = (pick: (fact: StripeFacts) => string | null) => facts.map(pick).filter((value): value is string => !!value).sort()[0] ?? null;
      const latest = (pick: (fact: StripeFacts) => string | null) => facts.map(pick).filter((value): value is string => !!value).sort().reverse()[0] ?? null;

      const own = (bookingsByPerson.get(person.id) ?? []).filter((booking) => booking.status !== 'CANCELLED' && booking.status !== 'RESCHEDULED');
      const past = own.filter((booking) => booking.startsAt <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
      const future = own.filter((booking) => booking.startsAt > now && (booking.status === 'UPCOMING' || booking.status === 'IN_PROGRESS')).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      const lastBooking = past[0] ?? null;
      // Only sales calls move the stage: a set-up call or a webinar seat says nothing about the pipeline.
      const lastSalesBooking = past.find((booking) => SALES_BOOKING_TYPES.has(booking.bookingType)) ?? null;
      const nextSalesBooking = future.find((booking) => SALES_BOOKING_TYPES.has(booking.bookingType)) ?? null;
      const salesBookingStatus = own.length ? (lastSalesBooking?.status ?? null) : (SALES_BOOKING_TYPES.has(person.lastBookingType ?? '') ? person.lastBookingStatus : null);

      // An address Stripe only knows from a payment or the customers table carries no subscription
      // dates, so the end dates it does not have must not wipe what intake or the GHL import set.
      const stripeKnowsSubscription = facts.some((fact) => fact.trial_started_at !== null || fact.paying_since !== null);
      const desired: Partial<PersonRow> = {
        signedUpAt: earliest((fact) => fact.signed_up_at) ?? person.signedUpAt,
        trialStartedAt: earliest((fact) => fact.trial_started_at) ?? person.trialStartedAt,
        // Once Stripe knows the subscription, its paying date is the truth, absent included: a trial that
        // never paid must not keep a paying date the GHL tag or an intake event guessed.
        payingSince: stripeKnowsSubscription ? earliest((fact) => fact.paying_since) : person.payingSince,
        // Stripe is the authority once the address is known to it; only a live subscription clears churn.
        churnedAt: stripeKnowsSubscription ? (facts.some((fact) => fact.has_live_subscription) ? null : latest((fact) => fact.churned_at)) : person.churnedAt,
        trialEndedAt: stripeKnowsSubscription ? (facts.some((fact) => fact.paying_since) ? null : latest((fact) => fact.trial_ended_at)) : person.trialEndedAt,
        lastBookingAt: lastBooking?.startsAt ?? person.lastBookingAt,
        lastBookingStatus: lastBooking?.status ?? person.lastBookingStatus,
        lastBookingType: lastBooking?.bookingType ?? person.lastBookingType,
        nextBookingAt: future[0]?.startsAt ?? null,
        closer: person.closer || (lastBooking ?? future[0])?.closer || person.closer,
      };
      desired.stage = stageFor({ ...person, ...desired, lastBookingStatus: salesBookingStatus, nextBookingAt: nextSalesBooking?.startsAt ?? null });
      desired.lastActivityAt = [
        person.createdAt, person.lastActivityAt, person.latestFormAt, desired.signedUpAt, desired.trialStartedAt, desired.payingSince, desired.churnedAt, desired.trialEndedAt,
        latest((fact) => fact.last_event_at),
        ...(bookingsByPerson.get(person.id) ?? []).map((booking) => booking.bookedAt),
      ].filter((value): value is string => !!value).sort().reverse()[0] ?? person.createdAt;

      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(desired)) {
        const current = (person as Record<string, unknown>)[key] ?? null;
        if (sameInstant(current, value ?? null, DATED_FIELDS.has(key) ? DAY_MS : 1000)) continue;
        patch[key] = value ?? null;
      }
      if (!person.companyId) {
        const domain = emails.map((email) => domainOf(null, email)).find((value) => !!value) ?? null;
        const companyId = domain ? companyIdByDomain.get(domain) : null;
        if (companyId) {
          patch.companyId = companyId;
          companiesLinked++;
        }
      }
      if (Object.keys(patch).length === 0) continue;
      patches.push({ id: person.id, ...patch });
    }

    let written = 0;
    for (let offset = 0; offset < patches.length; offset += BATCH) {
      const batch = patches.slice(offset, offset + BATCH);
      await this.twentyApi.records(
        `mutation LifecycleUpsert($data: [PersonCreateInput!]!) { createPeople(data: $data, upsert: true) { id } }`,
        { data: batch },
      );
      written += batch.length;
    }
    this.logger.log(`lifecycle: ${people.length} people, ${written} updated, ${companiesLinked} companies linked`);
    return { people: people.length, updated: written, companiesLinked };
  }

  private async allPeople(): Promise<PersonRow[]> {
    const rows: PersonRow[] = [];
    let after: string | null = null;
    for (;;) {
      const result: { people: { edges: { node: PersonRow; cursor: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await this.twentyApi.records(
        `query LifecyclePeople($after: String) {
           people(first: ${PAGE}, after: $after) {
             edges { cursor node { id createdAt latestFormAt lastActivityAt emails { primaryEmail additionalEmails } companyId closer ghlTags notInterested stage signedUpAt trialStartedAt payingSince churnedAt trialEndedAt lastBookingAt lastBookingStatus lastBookingType nextBookingAt } }
             pageInfo { hasNextPage endCursor }
           }
         }`,
        { after },
      );
      rows.push(...result.people.edges.map((edge) => edge.node));
      if (!result.people.pageInfo.hasNextPage) return rows;
      after = result.people.pageInfo.endCursor;
    }
  }

  private async allBookings(): Promise<BookingRow[]> {
    const rows: BookingRow[] = [];
    let after: string | null = null;
    for (;;) {
      const result: { bookings: { edges: { node: BookingRow }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await this.twentyApi.records(
        `query LifecycleBookings($after: String) {
           bookings(first: ${PAGE}, after: $after, filter: { personId: { is: NOT_NULL } }) {
             edges { node { personId startsAt bookedAt status bookingType closer } }
             pageInfo { hasNextPage endCursor }
           }
         }`,
        { after },
      );
      rows.push(...result.bookings.edges.map((edge) => edge.node));
      if (!result.bookings.pageInfo.hasNextPage) return rows;
      after = result.bookings.pageInfo.endCursor;
    }
  }

  // One row per address Stripe or the app knows: first signup, first trial, first paid, and the
  // churn date when nothing is active any more.
  private async stripeFacts(): Promise<Map<string, StripeFacts>> {
    const rows: StripeFacts[] = await this.dataSource.query(`
      with emails as (
        select lower(customer_email) as email from os.stripe_subscriptions where customer_email is not null
        union select lower(stripe_email) from os.conversifi_customers where stripe_email is not null
        union select lower(auth_email) from os.conversifi_customers where auth_email is not null
        union select lower(email) from os.stripe_payments where email is not null
      ),
      subs as (
        select lower(customer_email) as email, status, created, trial_start, canceled_at, ended_at
        from os.stripe_subscriptions where customer_email is not null
      ),
      customers as (
        select lower(coalesce(stripe_email, auth_email)) as email, min(signup_at) as signup_at, min(trial_ends_at) as trial_ends_at
        from os.conversifi_customers group by 1
      ),
      payments as (
        select lower(email) as email, min(created) as first_paid, max(created) as last_paid
        from os.stripe_payments where paid and coalesce(amount_cents, 0) > 0 and lower(coalesce(status, '')) = 'succeeded' and email is not null group by 1
      )
      select e.email,
             least(cu.signup_at, (select min(created) from subs s where s.email = e.email)) as signed_up_at,
             (select min(trial_start) from subs s where s.email = e.email) as trial_started_at,
             -- Paying needs a subscription behind it: a one-off payment (set-up fee, DFY invoice) is not a plan.
             case when exists (select 1 from subs s where s.email = e.email and s.status not in ('trialing', 'incomplete', 'incomplete_expired'))
                  then least(p.first_paid, (select min(created) from subs s where s.email = e.email and s.status in ('active', 'past_due'))) end as paying_since,
             exists (select 1 from subs s where s.email = e.email and s.status in ('active', 'past_due', 'trialing')) as has_live_subscription,
             case when exists (select 1 from subs s where s.email = e.email and s.status in ('active', 'trialing', 'past_due')) then null
                  when p.first_paid is null and not exists (select 1 from subs s where s.email = e.email and s.status in ('active', 'past_due')) then null
                  else (select max(coalesce(s.ended_at, s.canceled_at)) from subs s where s.email = e.email and s.status in ('canceled', 'incomplete_expired', 'unpaid')) end as churned_at,
             case when exists (select 1 from subs s where s.email = e.email and s.status in ('active', 'trialing', 'past_due')) then null
                  when p.first_paid is not null or exists (select 1 from subs s where s.email = e.email and s.status in ('active', 'past_due')) then null
                  else (select max(coalesce(s.ended_at, s.canceled_at)) from subs s where s.email = e.email and s.status in ('canceled', 'incomplete_expired', 'unpaid')) end as trial_ended_at,
             greatest((select max(greatest(s.created, s.trial_start, s.canceled_at, s.ended_at)) from subs s where s.email = e.email), p.last_paid) as last_event_at
      from emails e
      left join customers cu on cu.email = e.email
      left join payments p on p.email = e.email
    `);
    const facts = new Map<string, StripeFacts>();
    for (const row of rows) {
      facts.set(row.email, {
        email: row.email,
        signed_up_at: toIso(row.signed_up_at),
        trial_started_at: toIso(row.trial_started_at),
        paying_since: toIso(row.paying_since),
        churned_at: toIso(row.churned_at),
        trial_ended_at: toIso(row.trial_ended_at),
        last_event_at: toIso(row.last_event_at),
        has_live_subscription: Boolean(row.has_live_subscription),
      });
    }
    return facts;
  }

  private async upsertCompanies(domains: string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    for (let offset = 0; offset < domains.length; offset += BATCH) {
      const batch = domains.slice(offset, offset + BATCH);
      const result = await this.twentyApi.records<{ createCompanies: { id: string; domainName: { primaryLinkUrl: string } }[] }>(
        `mutation LifecycleUpsertCompanies($data: [CompanyCreateInput!]!) { createCompanies(data: $data, upsert: true) { id domainName { primaryLinkUrl } } }`,
        { data: batch.map((domain) => ({ name: companyNameFor(null, domain), domainName: { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: '' } })) },
      );
      for (const company of result.createCompanies) ids.set(company.domainName.primaryLinkUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase(), company.id);
    }
    return ids;
  }
}

const toIso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// Twenty returns timestamps with millisecond precision; Postgres values may carry microseconds.
const DAY_MS = 86400000;
// The intake sets these in real time and Stripe reports them minutes to hours later; both are the same event.
const DATED_FIELDS = new Set(['signedUpAt', 'trialStartedAt', 'payingSince', 'churnedAt', 'trialEndedAt']);
const sameInstant = (a: unknown, b: unknown, toleranceMs: number) => {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d\d-\d\dT/.test(a) && /^\d{4}-\d\d-\d\dT/.test(b)) {
    return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < toleranceMs;
  }
  return a === b;
};
