import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { OsBookingsService } from 'src/conversifi-os/services/os-bookings.service';
import { OsContactsImportService } from 'src/conversifi-os/services/os-contacts-import.service';
import { OsLifecycleService } from 'src/conversifi-os/services/os-lifecycle.service';
import { OsUpsertService } from 'src/conversifi-os/services/os-upsert.service';

export type OsSyncStep =
  | 'stripe-payments'
  | 'stripe-subs'
  | 'stripe-geo'
  | 'geocode'
  | 'fathom'
  | 'calendly'
  | 'unipile'
  | 'prod'
  | 'ledger'
  | 'trial-forward'
  | 'people'
  | 'bookings';

export const OS_SYNC_STEPS: OsSyncStep[] = [
  'stripe-payments',
  'stripe-subs',
  'stripe-geo',
  'geocode',
  'fathom',
  'calendly',
  'unipile',
  'prod',
  'ledger',
  'trial-forward',
  'bookings',
  'people',
];

// The 15 minute cron in the OS project ran only these three, with a 3 day Calendly window.
// Bookings run before people so the lifecycle pass sees the latest call outcomes.
export const OS_FAST_STEPS: OsSyncStep[] = ['fathom', 'stripe-subs', 'calendly', 'bookings', 'people'];

type StepResult = { step: OsSyncStep; ok: boolean; detail?: unknown; skipped?: string; error?: string };

const PROD_SUPABASE_REF = 'zaubkfldwvzpmuqbpthe';
const PROD_WORKSPACE_ID = 'e08ecac3-4c44-4731-b96e-1026430e9ef7';
const THERAPON_CALENDLY_HOST = 'https://api.calendly.com/users/aa7a3f42-1964-48e6-aa9b-89f2cf18cb70';
const TRIAL_FORWARD_DEST = 'https://comet-serve.com/5629499538000004/webhook/01m1fpc8ads5qfkxzgq8dn854v';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = () => new Date().toISOString();
const unixToIso = (value: number | null | undefined) => (value ? new Date(value * 1000).toISOString() : null);

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

@Injectable()
export class OsSyncService {
  private readonly logger = new Logger(OsSyncService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly upsert: OsUpsertService,
    private readonly bookings: OsBookingsService,
    private readonly contacts: OsContactsImportService,
    private readonly lifecycle: OsLifecycleService,
  ) {}

  async runSteps(steps: OsSyncStep[], calendlyWindowDays?: number): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of steps) results.push(await this.runStep(step, calendlyWindowDays));
    return results;
  }

  async runStep(step: OsSyncStep, calendlyWindowDays = 60): Promise<StepResult> {
    try {
      switch (step) {
        case 'stripe-payments': return await this.wrap(step, () => this.stripePayments());
        case 'stripe-subs': return await this.wrap(step, () => this.stripeSubscriptions());
        case 'stripe-geo': return await this.wrap(step, () => this.stripeGeo());
        case 'geocode': return await this.wrap(step, () => this.geocodeCustomers());
        case 'fathom': return await this.wrap(step, () => this.fathom());
        case 'calendly': return await this.wrap(step, () => this.calendly(calendlyWindowDays));
        case 'unipile': return await this.wrap(step, () => this.unipile());
        case 'prod': return await this.wrap(step, () => this.syncProd());
        case 'ledger': return await this.wrap(step, () => this.refreshLedger());
        case 'trial-forward': return await this.wrap(step, () => this.trialForward());
        // Fast runs refresh recent and upcoming calls; full runs re-mirror the whole history.
        // New trials, payers and bookers become People without waiting for a GHL re-export.
        case 'people': return await this.wrap(step, async () => ({ contacts: await this.contacts.run({ onlyNew: true }), lifecycle: await this.lifecycle.sync() }));
        case 'bookings': return await this.wrap(step, () => this.bookings.sync(calendlyWindowDays <= 3 ? 45 : 400));
        default: return { step, ok: false, error: `unknown step ${step}` };
      }
    } catch (error) {
      this.logger.error(`os sync ${step} failed: ${(error as Error).message}`);
      return { step, ok: false, error: (error as Error).message };
    }
  }

  // A step that throws must become a failed result here: a rejection that escapes the runner skips
  // the run summary, and a sync that fails without a log line stays broken until someone notices.
  private async wrap(step: OsSyncStep, fn: () => Promise<unknown>): Promise<StepResult> {
    try {
      const detail = await fn();
      if (detail && typeof detail === 'object' && 'skipped' in detail) {
        return { step, ok: true, skipped: String((detail as { skipped: string }).skipped) };
      }
      return { step, ok: true, detail };
    } catch (error) {
      this.logger.error(`os sync step ${step} failed: ${(error as Error).message}`);
      return { step, ok: false, error: (error as Error).message };
    }
  }

  private stripeKey() {
    return env('OS_STRIPE_KEY');
  }

  private async stripeGet(key: string, url: string) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`stripe ${response.status}: ${await response.text()}`);
    return response.json();
  }

  private async stripePayments(maxPages = 30) {
    const key = this.stripeKey();
    if (!key) return { skipped: 'no stripe key' };
    let total = 0;
    let pages = 0;
    let hasMore = true;
    let last: string | null = null;
    while (pages < maxPages && hasMore) {
      let url = 'https://api.stripe.com/v1/charges?limit=100';
      if (last) url += `&starting_after=${last}`;
      const data = await this.stripeGet(key, url);
      const rows = (data.data ?? []).map((charge: any) => ({
        id: charge.id,
        customer_id: typeof charge.customer === 'string' ? charge.customer : charge.customer?.id ?? null,
        amount_cents: charge.amount,
        amount_refunded_cents: charge.amount_refunded,
        currency: charge.currency,
        created: new Date(charge.created * 1000).toISOString(),
        status: charge.status,
        paid: charge.paid,
        refunded: charge.refunded,
        invoice: typeof charge.invoice === 'string' ? charge.invoice : charge.invoice?.id ?? null,
        email: charge.billing_details?.email ?? charge.receipt_email ?? null,
        payer_name: charge.billing_details?.name ?? null,
        description: charge.description,
        synced_at: nowIso(),
      }));
      if (rows.length) {
        await this.upsert.rows('stripe_payments', rows, ['id']);
        total += rows.length;
        last = rows[rows.length - 1].id;
      }
      hasMore = !!data.has_more;
      pages++;
    }
    return { upserted: total, pages, has_more: hasMore };
  }

  private async stripeSubscriptions(maxPages = 30) {
    const key = this.stripeKey();
    if (!key) return { skipped: 'no stripe key' };
    const productNames: Record<string, string> = {};
    try {
      let cursor: string | null = null;
      let productPages = 0;
      do {
        let url = 'https://api.stripe.com/v1/products?limit=100';
        if (cursor) url += `&starting_after=${cursor}`;
        const data = await this.stripeGet(key, url);
        for (const product of data.data ?? []) productNames[product.id] = product.name;
        cursor = data.has_more && data.data?.length ? data.data[data.data.length - 1].id : null;
        productPages++;
      } while (cursor && productPages < 5);
    } catch {
      // Product names are cosmetic; the plan falls back to the price nickname or product id.
    }

    let total = 0;
    let pages = 0;
    let hasMore = true;
    let last: string | null = null;
    while (pages < maxPages && hasMore) {
      let url = 'https://api.stripe.com/v1/subscriptions?limit=100&status=all&expand[]=data.customer';
      if (last) url += `&starting_after=${last}`;
      const data = await this.stripeGet(key, url);
      const rows = (data.data ?? []).map((subscription: any) => {
        const customer = typeof subscription.customer === 'object' && subscription.customer ? subscription.customer : null;
        const items = subscription.items?.data ?? [];
        const item = items[0] ?? null;
        const price = item?.price ?? null;
        const productId = typeof price?.product === 'string' ? price.product : price?.product?.id;
        const planName = (items.length > 1 ? 'Multiple' : productNames[productId] ?? price?.nickname ?? productId) ?? null;
        const currentPeriodEnd = item?.current_period_end ?? subscription.current_period_end ?? null;
        let amount: number | null = null;
        for (const lineItem of items) {
          const unit = lineItem?.price?.unit_amount;
          if (unit != null) amount = (amount ?? 0) + unit * (lineItem.quantity ?? 1);
        }
        return {
          id: subscription.id,
          customer_id: customer?.id ?? (typeof subscription.customer === 'string' ? subscription.customer : null),
          customer_email: customer?.email ?? null,
          customer_name: customer?.name ?? null,
          status: subscription.status,
          created: unixToIso(subscription.created),
          trial_start: unixToIso(subscription.trial_start),
          trial_end: unixToIso(subscription.trial_end),
          current_period_end: unixToIso(currentPeriodEnd),
          plan: planName,
          amount_cents: amount,
          interval: price?.recurring?.interval ?? null,
          cancel_at: unixToIso(subscription.cancel_at),
          cancel_at_period_end: !!subscription.cancel_at_period_end,
          canceled_at: unixToIso(subscription.canceled_at),
          ended_at: unixToIso(subscription.ended_at),
          synced_at: nowIso(),
        };
      });
      if (rows.length) {
        await this.upsert.rows('stripe_subscriptions', rows, ['id']);
        total += rows.length;
        last = rows[rows.length - 1].id;
      }
      hasMore = !!data.has_more;
      pages++;
    }
    return { upserted: total, pages, products: Object.keys(productNames).length };
  }

  private async stripeGeo(maxPages = 40) {
    const key = this.stripeKey();
    if (!key) return { skipped: 'no stripe key' };
    const geo = new Map<string, Record<string, unknown>>();
    let pages = 0;
    let hasMore = true;
    let last: string | null = null;
    let seen = 0;
    while (pages < maxPages && hasMore) {
      let url = 'https://api.stripe.com/v1/charges?limit=100';
      if (last) url += `&starting_after=${last}`;
      const data = await this.stripeGet(key, url);
      for (const charge of data.data ?? []) {
        seen++;
        const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id ?? null;
        if (!customerId || geo.has(customerId)) continue;
        const address = charge.billing_details?.address ?? {};
        const billingCountry = address.country ?? null;
        const cardCountry = charge.payment_method_details?.card?.country ?? null;
        const country = billingCountry ?? cardCountry;
        if (!country) continue;
        geo.set(customerId, {
          customer_id: customerId,
          country: String(country).toUpperCase(),
          state: address.state ?? null,
          city: address.city ?? null,
          postal: address.postal_code ?? null,
          source: billingCountry ? 'billing' : 'card',
          synced_at: nowIso(),
        });
      }
      if ((data.data ?? []).length) last = data.data[data.data.length - 1].id;
      hasMore = !!data.has_more;
      pages++;
    }
    const rows = [...geo.values()];
    await this.upsert.rows('stripe_customer_geo', rows, ['customer_id']);
    return { charges_seen: seen, customers_located: rows.length, pages };
  }

  private zipPath(country: string, postal: string): string | null {
    const upperCountry = country.toUpperCase();
    const upperPostal = String(postal).trim().toUpperCase();
    if (upperCountry === 'US') {
      const zip = upperPostal.slice(0, 5).replace(/[^0-9]/g, '');
      return zip.length === 5 ? `us/${zip}` : null;
    }
    if (upperCountry === 'CA') {
      const forwardSortationArea = upperPostal.replace(/\s+/g, '').slice(0, 3);
      return /^[A-Z][0-9][A-Z]$/.test(forwardSortationArea) ? `ca/${forwardSortationArea}` : null;
    }
    if (upperCountry === 'GB') {
      const outwardCode = upperPostal.split(/\s+/)[0];
      return /^[A-Z]{1,2}[0-9][A-Z0-9]?$/.test(outwardCode) ? `gb/${outwardCode}` : null;
    }
    return null;
  }

  private async geocodeCustomers() {
    const rows: { customer_id: string; country: string; postal: string }[] = await this.dataSource.query(
      `select customer_id, country, postal from os.stripe_customer_geo
       where country in ('US','CA','GB') and lat is null and postal is not null limit 500`,
    );
    let done = 0;
    let failed = 0;
    for (const row of rows) {
      const path = this.zipPath(row.country, row.postal);
      if (!path) { failed++; continue; }
      try {
        const response = await fetch(`https://api.zippopotam.us/${path}`);
        if (!response.ok) { failed++; continue; }
        const data = await response.json();
        const place = (data.places ?? [])[0];
        if (!place) { failed++; continue; }
        await this.dataSource.query(
          `update os.stripe_customer_geo set lat=$1, lng=$2, city=coalesce($3, city), geo_source='zip' where customer_id=$4`,
          [Number(place.latitude), Number(place.longitude), place['place name'] ?? null, row.customer_id],
        );
        done++;
      } catch {
        failed++;
      }
      await sleep(120);
    }
    return { geocoded: done, failed, checked: rows.length };
  }

  private async fathom(maxPages = 3) {
    const key = env('OS_FATHOM_KEY');
    if (!key) return { skipped: 'no fathom key' };
    let cursor: string | null = null;
    let total = 0;
    let pages = 0;
    let rateLimited = false;
    while (pages < maxPages) {
      let url = 'https://api.fathom.ai/external/v1/meetings?limit=50';
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, { headers: { 'X-Api-Key': key } });
      if (response.status === 429) { rateLimited = true; break; }
      if (!response.ok) throw new Error(`fathom meetings ${response.status}: ${await response.text()}`);
      const data = await response.json();
      const rows = (data.items ?? [])
        .map((meeting: any) => {
          const external = (meeting.calendar_invitees ?? []).find((invitee: any) => invitee.is_external);
          const recordedBy = meeting.recorded_by ?? {};
          return {
            recording_id: meeting.recording_id,
            title: meeting.title ?? meeting.meeting_title,
            fathom_url: meeting.url,
            share_url: meeting.share_url,
            meeting_url: meeting.meeting_url,
            scheduled_start: meeting.scheduled_start_time,
            recording_start: meeting.recording_start_time,
            recording_end: meeting.recording_end_time,
            fathom_created_at: meeting.created_at,
            prospect_name: external?.name ?? null,
            prospect_email: external?.email ?? null,
            prospect_domain: external?.email_domain ?? null,
            recorded_by_name: recordedBy?.name ?? null,
            recorded_by_email: recordedBy?.email ?? null,
            has_external: !!external,
            raw: JSON.stringify(meeting),
            synced_at: nowIso(),
          };
        })
        .filter((row: any) => row.recording_id != null);
      if (rows.length) {
        await this.upsert.rows('fathom_calls', rows, ['recording_id'], { raw: 'jsonb' });
        total += rows.length;
      }
      cursor = data.next_cursor ?? null;
      pages++;
      if (!cursor) break;
      await sleep(700);
    }
    return { upserted: total, pages, done: cursor == null, rate_limited: rateLimited };
  }

  // Every member of the Calendly organisation is a host (set-up calls with Melanie, live demos with
  // Alex, and the closers), so nothing booked on a kept calendar is missed. Closers get their user
  // URI cached on the closer row; OS_CALENDLY_HOST_URIS adds hosts outside the organisation.
  private async calendlyHosts(token: string, organization: string): Promise<string[]> {
    const CAL = 'https://api.calendly.com';
    const headers = { Authorization: `Bearer ${token}` };
    const closers: { id: string; calendly_host_email: string; calendly_user_uri: string | null }[] = await this.dataSource.query(
      `select id, lower(calendly_host_email) as calendly_host_email, calendly_user_uri
       from os.closers where active and coalesce(calendly_host_email, '') <> ''`,
    );
    const hosts = new Set<string>();
    const unresolved = closers.filter((closer) => !closer.calendly_user_uri);
    const byEmail = new Map<string, string>();
    {
      let url: string | null = `${CAL}/organization_memberships?organization=${encodeURIComponent(organization)}&count=100`;
      while (url) {
        const response: Response = await fetch(url, { headers });
        if (!response.ok) break;
        const data: any = await response.json();
        for (const membership of data.collection ?? []) {
          if (membership.user?.email && membership.user?.uri) byEmail.set(String(membership.user.email).toLowerCase(), membership.user.uri);
        }
        url = data.pagination?.next_page ?? null;
      }
      for (const uri of byEmail.values()) hosts.add(uri);
      for (const closer of unresolved) {
        const uri = byEmail.get(closer.calendly_host_email);
        if (!uri) {
          this.logger.warn(`calendly: no organisation member matches closer ${closer.id} (${closer.calendly_host_email})`);
          continue;
        }
        closer.calendly_user_uri = uri;
        await this.dataSource.query(`update os.closers set calendly_user_uri = $1, updated_at = now() where id = $2`, [uri, closer.id]);
      }
    }
    for (const closer of closers) if (closer.calendly_user_uri) hosts.add(closer.calendly_user_uri);
    for (const host of (env('OS_CALENDLY_HOST_URIS') ?? '').split(',')) if (host.trim()) hosts.add(host.trim());
    if (hosts.size === 0) hosts.add(THERAPON_CALENDLY_HOST);
    return [...hosts];
  }

  private async calendly(windowDays: number) {
    const token = env('OS_CALENDLY_TOKEN');
    if (!token) return { skipped: 'no calendly token' };
    const meResponse = await fetch('https://api.calendly.com/users/me', { headers: { Authorization: `Bearer ${token}` } });
    if (!meResponse.ok) throw new Error(`calendly users/me ${meResponse.status}: ${await meResponse.text()}`);
    const organization: string = (await meResponse.json()).resource.current_organization;
    const results = [];
    for (const host of await this.calendlyHosts(token, organization)) {
      results.push(await this.calendlyHost(token, organization, host, windowDays));
    }
    return results;
  }

  private async calendlyHost(token: string, organization: string, hostUserUri: string, windowDays: number) {
    const CAL = 'https://api.calendly.com';
    const headers = { Authorization: `Bearer ${token}` };
    // A host we have never synced gets a full year back, so a newly added closer's history fills in.
    const [{ count }] = await this.dataSource.query(`select count(*)::int as count from os.calendly_bookings where host_user_uri = $1`, [hostUserUri]);
    const effectiveWindowDays = count === 0 ? 365 : windowDays;
    const minStart = new Date(Date.now() - effectiveWindowDays * 86400000).toISOString();

    try {
      const hostResponse = await fetch(hostUserUri, { headers });
      if (hostResponse.ok) {
        const user = (await hostResponse.json()).resource;
        await this.upsert.rows('calendly_users', [{
          uri: user.uri, name: user.name, email: user.email, created_at: user.created_at, updated_at: user.updated_at, synced_at: nowIso(),
        }], ['uri']);
      }
    } catch {
      // The user record is informational only.
    }

    try {
      await this.dataSource.query('alter table os.calendly_event_types add column if not exists scheduling_url text');
      const eventTypesResponse = await fetch(`${CAL}/event_types?user=${encodeURIComponent(hostUserUri)}&count=100`, { headers });
      if (eventTypesResponse.ok) {
        const eventTypes = (await eventTypesResponse.json()).collection ?? [];
        const rows = eventTypes.map((eventType: any) => ({
          uri: eventType.uri, name: eventType.name, slug: eventType.slug, active: eventType.active, scheduling_url: eventType.scheduling_url ?? null,
          duration: eventType.duration, kind: eventType.kind, synced_at: nowIso(),
        }));
        await this.upsert.rows('calendly_event_types', rows, ['uri']);
      }
    } catch {
      // Event types are informational only.
    }

    let url: string | null =
      `${CAL}/scheduled_events?user=${encodeURIComponent(hostUserUri)}&organization=${encodeURIComponent(organization)}` +
      `&min_start_time=${encodeURIComponent(minStart)}&count=100&sort=start_time:asc`;
    let bookings = 0;
    let pages = 0;
    const bookingUris: string[] = [];
    while (url) {
      const response: Response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`calendly scheduled_events ${response.status}: ${await response.text()}`);
      const data: any = await response.json();
      const rows = (data.collection ?? []).map((event: any) => {
        const membership = (event.event_memberships ?? [])[0] ?? {};
        bookingUris.push(event.uri);
        return {
          uri: event.uri,
          calendar_external_id: event.calendar_event?.external_id ?? null,
          name: event.name,
          status: event.status,
          start_time: event.start_time,
          end_time: event.end_time,
          booked_at: event.created_at,
          updated_at: event.updated_at,
          event_type_uri: event.event_type,
          host_user_uri: membership.user ?? null,
          host_email: membership.user_email ?? null,
          host_name: membership.user_name ?? null,
          location_type: event.location?.type ?? null,
          join_url: event.location?.join_url ?? null,
          invitees_active: event.invitees_counter?.active ?? null,
          invitees_total: event.invitees_counter?.total ?? null,
          synced_at: nowIso(),
        };
      });
      if (rows.length) {
        await this.upsert.rows('calendly_bookings', rows, ['uri']);
        bookings += rows.length;
      }
      pages++;
      url = data.pagination?.next_page ?? null;
    }

    let inviteesUpserted = 0;
    if (bookingUris.length) {
      await this.dataSource.query(`
        alter table os.calendly_invitees add column if not exists first_name text, add column if not exists timezone text,
          add column if not exists reschedule_url text, add column if not exists cancel_url text,
          add column if not exists old_invitee_uri text, add column if not exists new_invitee_uri text`);
      // Upcoming bookings synced before the timezone/reschedule columns existed are fetched again once.
      const existing: { booking_uri: string }[] = await this.dataSource.query(
        `select distinct i.booking_uri from os.calendly_invitees i join os.calendly_bookings b on b.uri = i.booking_uri
         where i.booking_uri = any($1) and not (b.start_time > now() and i.timezone is null)
           and not (coalesce(i.rescheduled, false) and i.new_invitee_uri is null)`,
        [bookingUris],
      );
      const have = new Set(existing.map((row) => row.booking_uri));
      const missing = bookingUris.filter((uri) => !have.has(uri)).slice(0, 200);
      for (const bookingUri of missing) {
        try {
          const response = await fetch(`${bookingUri}/invitees?count=100`, { headers });
          if (!response.ok) continue;
          const items = (await response.json()).collection ?? [];
          const rows = items.map((invitee: any) => ({
            uri: invitee.uri,
            booking_uri: bookingUri,
            name: invitee.name,
            email: invitee.email,
            status: invitee.status,
            booked_at: invitee.created_at ?? null,
            canceled: invitee.status === 'canceled',
            cancel_reason: invitee.cancellation?.reason ?? null,
            rescheduled: invitee.rescheduled ?? false,
            // Empty string means Calendly was asked and had no link, so the row is not fetched again.
            old_invitee_uri: invitee.old_invitee ?? '',
            new_invitee_uri: invitee.new_invitee ?? '',
            questions_answers: JSON.stringify(invitee.questions_and_answers ?? null),
            first_name: invitee.first_name ?? null,
            timezone: invitee.timezone ?? null,
            reschedule_url: invitee.reschedule_url ?? null,
            cancel_url: invitee.cancel_url ?? null,
            tracking: JSON.stringify(invitee.tracking ?? null),
            synced_at: nowIso(),
          }));
          if (rows.length) {
            await this.upsert.rows('calendly_invitees', rows, ['uri'], { questions_answers: 'jsonb', tracking: 'jsonb' });
            inviteesUpserted += rows.length;
          }
        } catch {
          // Skip this booking; the next sync retries anything still missing.
        }
      }
    }

    await this.dataSource.query(
      `insert into os.calendly_sync_log (host_user_uri, window_start, bookings_upserted, invitees_upserted, status)
       values ($1, $2, $3, $4, 'ok')`,
      [hostUserUri, minStart, bookings, inviteesUpserted],
    );
    return { host: hostUserUri, bookings_upserted: bookings, invitees_upserted: inviteesUpserted, pages };
  }

  private async unipile() {
    const key = env('OS_UNIPILE_KEY');
    const dsnRaw = env('OS_UNIPILE_DSN');
    if (!key || !dsnRaw) return { skipped: 'no unipile key or dsn' };
    const dsn = dsnRaw.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const base = `https://${dsn}`;
    const items: any[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      let url = `${base}/api/v1/accounts?limit=100`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      const response = await fetch(url, { headers: { 'X-API-KEY': key, accept: 'application/json' } });
      if (!response.ok) throw new Error(`unipile accounts ${response.status}: ${(await response.text()).slice(0, 300)}`);
      const data = await response.json();
      for (const account of data.items ?? data.data ?? []) items.push(account);
      cursor = data.cursor ?? null;
      pages++;
    } while (cursor && pages < 20);

    const rows = items.map((account) => {
      const sources = account.sources ?? [];
      const status = sources.find((source: any) => source.status === 'OK')?.status ?? sources[0]?.status ?? account.status ?? null;
      return { account_id: account.id, name: account.name ?? null, type: account.type ?? account.provider ?? null, status, synced_at: nowIso() };
    });
    await this.upsert.rows('unipile_live_accounts', rows, ['account_id']);
    return { total: rows.length, pages };
  }

  private async prodQuery(managementToken: string, sql: string): Promise<any[]> {
    const response = await fetch(`https://api.supabase.com/v1/projects/${PROD_SUPABASE_REF}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    if (!response.ok) throw new Error(`prod query ${response.status}: ${await response.text()}`);
    const data = await response.json();
    return Array.isArray(data) ? data : data.result ?? [];
  }

  private async syncProd() {
    const managementToken = env('OS_SUPABASE_MGMT_TOKEN');
    if (!managementToken) return { skipped: 'no supabase management token' };
    const workspace = PROD_WORKSPACE_ID;

    const disconnected = await this.prodQuery(managementToken,
      `select label, account_id, last_status_at from public.unipile_accounts where workspace_id='${workspace}' and last_status='CREDENTIALS' order by last_status_at desc`);
    const counts = await this.prodQuery(managementToken,
      `select (select count(distinct account_id) from public.campaigns where workspace_id='${workspace}' and deleted_at is null and status in ('active','ready_to_continue','rate_limited')) as active_accounts,
              (select count(*) from public.unipile_accounts where workspace_id='${workspace}' and last_status in ('OK','SYNC_SUCCESS')) as connected`);
    const accounts = await this.prodQuery(managementToken,
      `select u.account_id, u.label, u.created_at, u.last_status, u.last_status_at,
         exists(select 1 from public.campaigns c where c.account_id=u.account_id and c.deleted_at is null and c.status in ('active','ready_to_continue','rate_limited')) as in_active_campaign,
         (select count(*) from public.campaign_prospects cp where cp.account_id=u.account_id and cp.invitation_sent_at is not null) as requests_sent
       from public.unipile_accounts u where u.workspace_id='${workspace}'`);
    const active = Number(counts?.[0]?.active_accounts ?? 0);
    const connected = Number(counts?.[0]?.connected ?? 0);

    await this.dataSource.query(`select os.apply_outreach_sync($1::jsonb, $2::int, $3::int, $4::jsonb)`, [
      JSON.stringify(disconnected), active, connected, JSON.stringify(accounts),
    ]);

    let agenciesSynced = 0;
    let agencyAccountsSynced = 0;
    try {
      const [{ map }] = await this.dataSource.query(`select os.get_agency_user_map() as map`);
      const rows: { customer_id: string; user_id: string }[] = Array.isArray(map) ? map : [];
      if (rows.length) {
        const escape = (value: string) => String(value).replace(/'/g, "''");
        const values = rows.map((row) => `('${escape(row.customer_id)}','${escape(row.user_id)}')`).join(',');
        const stats = await this.prodQuery(managementToken, `
          with u(cid, user_id) as (values ${values})
          select u.cid,
            min(wm.workspace_id::text) workspace_id,
            count(distinct ua.account_id) accounts_total,
            count(distinct ua.account_id) filter (where ua.last_status in ('OK','SYNC_SUCCESS')) accounts_active,
            count(distinct c.id) campaigns_total,
            count(distinct c.id) filter (where c.status='active') campaigns_active
          from u
          join public.workspace_members wm on wm.user_id::text=u.user_id
          left join public.unipile_accounts ua on ua.workspace_id=wm.workspace_id
          left join public.campaigns c on c.workspace_id=wm.workspace_id and c.deleted_at is null
          group by u.cid`);
        await this.upsert.rows('agency_workspace_stats', stats.map((stat) => ({
          customer_id: stat.cid,
          workspace_id: stat.workspace_id,
          accounts_total: Number(stat.accounts_total),
          accounts_active: Number(stat.accounts_active),
          campaigns_total: Number(stat.campaigns_total),
          campaigns_active: Number(stat.campaigns_active),
          updated_at: nowIso(),
        })), ['customer_id']);
        agenciesSynced = stats.length;

        const seats = await this.prodQuery(managementToken, `
          with u(cid, user_id) as (values ${values}),
          mem as (select distinct u.cid, wm.workspace_id from u join public.workspace_members wm on wm.user_id::text=u.user_id)
          select m.cid, ua.account_id, ua.label, ua.last_status, ua.last_status_at,
            exists(select 1 from public.campaigns c where c.account_id=ua.account_id and c.deleted_at is null and c.status in ('active','ready_to_continue','rate_limited')) as in_active_campaign,
            (select count(*) from public.campaign_prospects cp where cp.account_id=ua.account_id and cp.invitation_sent_at is not null) as requests_sent
          from mem m join public.unipile_accounts ua on ua.workspace_id=m.workspace_id`);
        const seen = new Set<string>();
        const seatRows: Record<string, unknown>[] = [];
        for (const seat of seats) {
          const dedupeKey = `${seat.cid}::${seat.account_id}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          seatRows.push({
            customer_id: seat.cid,
            account_id: seat.account_id,
            label: seat.label ?? null,
            last_status: seat.last_status ?? null,
            last_status_at: seat.last_status_at ?? null,
            in_active_campaign: seat.in_active_campaign === true,
            requests_sent: Number(seat.requests_sent ?? 0),
            updated_at: nowIso(),
          });
        }
        await this.dataSource.query(`delete from os.agency_accounts where customer_id = any($1)`, [rows.map((row) => row.customer_id)]);
        await this.upsert.rows('agency_accounts', seatRows, ['customer_id', 'account_id']);
        agencyAccountsSynced = seatRows.length;
      }
    } catch (error) {
      this.logger.warn(`agency stats sync skipped: ${(error as Error).message}`);
    }

    await this.dataSource.query(`update os.sync_state set last_prod_sync = now() where id = 1`);
    return { active, connected, disconnected: disconnected.length, accounts: accounts.length, agencies_synced: agenciesSynced, agency_accounts_synced: agencyAccountsSynced };
  }

  private async refreshLedger() {
    await this.dataSource.query(`select os.refresh_sales_ledger()`);
    return { refreshed: true };
  }

  private async trialForward() {
    const sentRows: { subscription_id: string }[] = await this.dataSource.query(`select subscription_id from os.trial_webhook_sent`);
    const sent = new Set(sentRows.map((row) => row.subscription_id));
    const subscriptions: any[] = await this.dataSource.query(
      `select id, customer_id, customer_email, customer_name, plan, amount_cents, "interval", trial_start, trial_end, created
       from os.stripe_subscriptions where status='trialing' and trial_start >= now() - interval '30 days'`,
    );
    const fresh = subscriptions.filter((subscription) => !sent.has(subscription.id));
    let forwarded = 0;
    let failed = 0;
    for (const subscription of fresh) {
      const payload = {
        event: 'trial_started',
        source: 'conversifi_stripe',
        subscription_id: subscription.id,
        stripe_customer_id: subscription.customer_id,
        customer_email: subscription.customer_email,
        customer_name: subscription.customer_name,
        plan: subscription.plan,
        interval: subscription.interval,
        amount_cents: subscription.amount_cents,
        trial_start: subscription.trial_start,
        trial_end: subscription.trial_end,
        created: subscription.created,
      };
      try {
        const response = await fetch(TRIAL_FORWARD_DEST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (response.ok) {
          await this.upsert.rows('trial_webhook_sent', [{ subscription_id: subscription.id, customer_email: subscription.customer_email, sent_at: nowIso() }], ['subscription_id']);
          forwarded++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    return { new_trials: fresh.length, forwarded, failed };
  }
}
