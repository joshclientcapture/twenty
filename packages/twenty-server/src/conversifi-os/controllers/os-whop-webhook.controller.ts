import { Body, Controller, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import { OsLifecycleService } from 'src/conversifi-os/services/os-lifecycle.service';
import { OsWhopService } from 'src/conversifi-os/services/os-whop.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

type WhopWebhook = { id?: string; type?: string; action?: string; event?: string; data?: Record<string, unknown>; timestamp?: string };

// Whop posts payment and membership events here the moment they happen. Guarded by the path token
// and the Standard Webhooks signature; every delivery is kept raw, then mirrored, then the person
// is brought up to date so a new DFY client reads DFY client within seconds.
@Controller(`${ApiPath.Os}/whop`)
export class OsWhopWebhookController {
  private readonly logger = new Logger(OsWhopWebhookController.name);
  private lifecycleInFlight: Promise<unknown> | null = null;
  private lifecycleQueued = false;

  constructor(
    private readonly whop: OsWhopService,
    private readonly lifecycle: OsLifecycleService,
  ) {}

  @Post(':token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: WhopWebhook, @Req() request: Request & { rawBody?: Buffer }) {
    const expected = env('OS_WHOP_WEBHOOK_TOKEN');
    if (!expected || token !== expected) throw new NotFoundException();
    const headers = {
      'webhook-id': request.header('webhook-id'),
      'webhook-timestamp': request.header('webhook-timestamp'),
      'webhook-signature': request.header('webhook-signature'),
    };
    if (!this.whop.signatureIsValid(headers, request.rawBody)) {
      this.logger.warn('whop webhook with a bad signature ignored');
      throw new NotFoundException();
    }
    const event = body?.type ?? body?.action ?? body?.event ?? 'unknown';
    const webhookId = headers['webhook-id'] ?? `${event}:${Date.now()}`;
    const fresh = await this.whop.record(webhookId, event, body);
    if (!fresh) return { ok: true, duplicate: true };

    const data = (body?.data ?? {}) as Record<string, unknown>;
    if (event.startsWith('payment.')) await this.whop.applyPayment(data as never);
    else if (event.startsWith('membership.')) await this.whop.applyMembership(data as never);
    else if (event.startsWith('dispute.') || event.startsWith('refund.')) {
      // The payment the dispute or refund belongs to is re-read on the next poll; the raw event is kept.
      this.logger.warn(`whop ${event} received: ${JSON.stringify(data).slice(0, 200)}`);
    }
    this.logger.log(`whop ${event}: ${(data as { user?: { email?: string } }).user?.email ?? 'no email'}`);
    this.lifecycleSoon();
    return { ok: true };
  }

  private lifecycleSoon() {
    if (this.lifecycleInFlight) {
      this.lifecycleQueued = true;
      return;
    }
    this.lifecycleInFlight = this.lifecycle
      .sync()
      .catch((error) => this.logger.error(`lifecycle after whop webhook failed: ${(error as Error).message}`))
      .finally(() => {
        this.lifecycleInFlight = null;
        if (this.lifecycleQueued) {
          this.lifecycleQueued = false;
          this.lifecycleSoon();
        }
      });
  }
}
