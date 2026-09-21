import { Body, Controller, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

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
    @InjectDataSource() private readonly dataSource: DataSource,
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
    if (event.startsWith('payment.')) {
      await this.whop.applyPayment(data as never);
      await this.whop.mirrorToLedger();
      if (event === 'payment.succeeded' || event === 'payment.failed') this.ping(event, data).catch((error) => this.logger.warn(`whop discord ping failed: ${(error as Error).message}`));
    }
    else if (event.startsWith('membership.')) await this.whop.applyMembership(data as never);
    else if (event.startsWith('dispute.') || event.startsWith('refund.')) {
      // The payment the dispute or refund belongs to is re-read on the next poll; the raw event is kept.
      this.logger.warn(`whop ${event} received: ${JSON.stringify(data).slice(0, 200)}`);
    }
    this.logger.log(`whop ${event}: ${(data as { user?: { email?: string } }).user?.email ?? 'no email'}`);
    this.lifecycleSoon();
    return { ok: true };
  }

  // One card per DFY payment in the channel Jamal chose, with the closer it is attributed to.
  private async ping(event: string, data: Record<string, unknown>) {
    const hook = env('OS_WHOP_DISCORD_WEBHOOK');
    if (!hook) return;
    const user = (data.user ?? {}) as { email?: string; name?: string };
    const product = (data.product ?? {}) as { id?: string; title?: string };
    const total = Number(data.total ?? 0);
    const currency = String(data.currency ?? 'usd').toUpperCase();
    const email = (user.email ?? '').toLowerCase();
    const rows: { closer: string | null; title: string | null }[] = email
      ? await this.dataSource.query(
          `select (select closer from workspace_a1aip8pgko71t0v2lrw9rnizs.person where lower("emailsPrimaryEmail") = $1 and "deletedAt" is null limit 1) as closer,
                  (select title from os.whop_products where id = $2) as title`,
          [email, product.id ?? ''],
        )
      : [];
    const ok = event === 'payment.succeeded';
    const body = {
      username: 'Conversifi DFY',
      embeds: [{
        title: ok ? '💰 New DFY Payment' : '⚠️ DFY Payment Failed',
        color: ok ? 3066993 : 15158332,
        fields: [
          { name: 'Client', value: user.name || email || 'Unknown', inline: true },
          { name: 'Email', value: email || 'n/a', inline: true },
          { name: 'Amount', value: `${currency} ${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}`, inline: true },
          { name: 'Plan', value: rows[0]?.title || product.title || product.id || 'n/a', inline: true },
          { name: 'Closer', value: rows[0]?.closer || 'Unassigned', inline: true },
        ],
      }],
    };
    await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
