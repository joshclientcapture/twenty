import { Body, Controller, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';

import { createHmac, timingSafeEqual } from 'crypto';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import { OsBookingsService } from 'src/conversifi-os/services/os-bookings.service';
import { OsContactsImportService } from 'src/conversifi-os/services/os-contacts-import.service';
import { OsUpsertService } from 'src/conversifi-os/services/os-upsert.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

type CalendlyWebhook = {
  event?: string;
  payload?: {
    uri?: string;
    email?: string;
    name?: string;
    first_name?: string | null;
    status?: string;
    timezone?: string | null;
    rescheduled?: boolean;
    old_invitee?: string | null;
    new_invitee?: string | null;
    reschedule_url?: string | null;
    cancel_url?: string | null;
    created_at?: string;
    cancellation?: { reason?: string | null } | null;
    questions_and_answers?: unknown;
    tracking?: unknown;
    scheduled_event?: {
      uri?: string;
      name?: string;
      status?: string;
      start_time?: string;
      end_time?: string;
      created_at?: string;
      updated_at?: string;
      event_type?: string;
      calendar_event?: { external_id?: string | null } | null;
      location?: { type?: string | null; join_url?: string | null } | null;
      event_memberships?: { user?: string; user_email?: string; user_name?: string }[];
      invitees_counter?: { active?: number; total?: number } | null;
    };
  };
};

// Calendly pushes invitee.created / invitee.canceled here the moment they happen, so bookings,
// the person's stage and the confirmation email no longer wait for the 15-minute poll. The poll
// keeps running behind it as the safety net. Guarded by the path token and Calendly's signature.
@Controller(`${ApiPath.Os}/calendly`)
export class OsCalendlyWebhookController {
  private readonly logger = new Logger(OsCalendlyWebhookController.name);
  private syncInFlight: Promise<unknown> | null = null;
  private syncQueued = false;

  constructor(
    private readonly upsert: OsUpsertService,
    private readonly bookings: OsBookingsService,
    private readonly contacts: OsContactsImportService,
  ) {}

  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: CalendlyWebhook, @Req() request: Request & { rawBody?: Buffer }) {
    const expected = env('OS_CALENDLY_WEBHOOK_TOKEN');
    if (!expected || token !== expected) throw new NotFoundException();
    if (!this.signatureIsValid(request)) {
      this.logger.warn('calendly webhook with a bad signature ignored');
      throw new NotFoundException();
    }

    const invitee = body?.payload;
    const event = invitee?.scheduled_event;
    if (!invitee?.uri || !event?.uri || !event.start_time) return { ok: false, reason: 'no event in payload' };

    const now = new Date().toISOString();
    const membership = event.event_memberships?.[0] ?? {};
    await this.upsert.rows('calendly_bookings', [{
      uri: event.uri,
      calendar_external_id: event.calendar_event?.external_id ?? null,
      name: event.name ?? null,
      status: event.status ?? null,
      start_time: event.start_time,
      end_time: event.end_time ?? null,
      booked_at: event.created_at ?? invitee.created_at ?? now,
      updated_at: event.updated_at ?? now,
      event_type_uri: event.event_type ?? null,
      host_user_uri: membership.user ?? null,
      host_email: membership.user_email ?? null,
      host_name: membership.user_name ?? null,
      location_type: event.location?.type ?? null,
      join_url: event.location?.join_url ?? null,
      invitees_active: event.invitees_counter?.active ?? null,
      invitees_total: event.invitees_counter?.total ?? null,
      synced_at: now,
    }], ['uri']);
    await this.upsert.rows('calendly_invitees', [{
      uri: invitee.uri,
      booking_uri: event.uri,
      name: invitee.name ?? null,
      email: invitee.email ?? null,
      status: invitee.status ?? null,
      booked_at: invitee.created_at ?? null,
      canceled: invitee.status === 'canceled' || body.event === 'invitee.canceled',
      cancel_reason: invitee.cancellation?.reason ?? null,
      rescheduled: invitee.rescheduled ?? false,
      old_invitee_uri: invitee.old_invitee ?? '',
      new_invitee_uri: invitee.new_invitee ?? '',
      questions_answers: JSON.stringify(invitee.questions_and_answers ?? null),
      tracking: JSON.stringify(invitee.tracking ?? null),
      first_name: invitee.first_name ?? null,
      timezone: invitee.timezone ?? null,
      reschedule_url: invitee.reschedule_url ?? null,
      cancel_url: invitee.cancel_url ?? null,
      synced_at: now,
    }], ['uri'], { questions_answers: 'jsonb', tracking: 'jsonb' });

    this.logger.log(`calendly ${body.event}: ${event.name} at ${event.start_time} (${invitee.email})`);
    this.mirrorSoon();
    return { ok: true };
  }

  // Calendly waits only a few seconds for a reply, so the mirror into the Booking object runs after
  // the response; overlapping webhooks share one run and trigger one more when it finishes.
  private mirrorSoon() {
    if (this.syncInFlight) {
      this.syncQueued = true;
      return;
    }
    // The invitee becomes a Person first (same rules as the people step), then the booking is mirrored.
    // A bad contact must not stop the booking from landing, so the mirror runs either way.
    this.syncInFlight = this.contacts
      .run({ onlyNew: true })
      .catch((error) => this.logger.error(`person import after calendly webhook failed: ${(error as Error).message}`))
      .then(() => this.bookings.sync(45))
      .catch((error) => this.logger.error(`bookings mirror after calendly webhook failed: ${(error as Error).message}`))
      .finally(() => {
        this.syncInFlight = null;
        if (this.syncQueued) {
          this.syncQueued = false;
          this.mirrorSoon();
        }
      });
  }

  private signatureIsValid(request: Request & { rawBody?: Buffer }) {
    const key = env('OS_CALENDLY_SIGNING_KEY');
    if (!key) return true;
    const header = request.header('Calendly-Webhook-Signature') ?? '';
    const parts = Object.fromEntries(header.split(',').map((part) => part.split('=') as [string, string]));
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature || !request.rawBody) return false;
    const digest = createHmac('sha256', key).update(`${timestamp}.${request.rawBody.toString('utf8')}`).digest('hex');
    return digest.length === signature.length && timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }
}
