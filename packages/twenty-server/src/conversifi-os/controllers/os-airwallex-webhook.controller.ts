import { Body, Controller, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import { OsAirwallexService } from 'src/conversifi-os/services/os-airwallex.service';
import { OsDfyBillingService } from 'src/conversifi-os/services/os-dfy-billing.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

type AirwallexEvent = { id?: string; name?: string; created_at?: string; data?: { object?: Record<string, unknown> } };

// Airwallex posts payment events here. Locked by the random path token and the HMAC signature;
// every delivery is kept raw, then applied: a succeeded intent marks its instalment paid, which
// writes the ledger row, counts commission, posts the Discord card and sends the receipt.
@Controller(`${ApiPath.Os}/airwallex`)
export class OsAirwallexWebhookController {
  private readonly logger = new Logger(OsAirwallexWebhookController.name);

  constructor(
    private readonly airwallex: OsAirwallexService,
    private readonly billing: OsDfyBillingService,
  ) {}

  @Post('webhook/:token')
  @HttpCode(200)
  async receive(@Param('token') token: string, @Body() body: AirwallexEvent, @Req() request: Request & { rawBody?: Buffer }) {
    const expected = await this.airwallex.webhookPathToken();
    if (!expected || token !== expected) throw new NotFoundException();
    if (!(await this.airwallex.signatureIsValid(request.header('x-timestamp'), request.header('x-signature'), request.rawBody))) {
      this.logger.warn('airwallex webhook with a bad signature ignored');
      throw new NotFoundException();
    }
    const name = body?.name ?? 'unknown';
    const id = body?.id ?? `${name}:${Date.now()}`;
    if (!(await this.airwallex.recordEvent(id, name, body))) return { ok: true, duplicate: true };
    const object = body?.data?.object ?? {};
    try {
      await this.apply(name, object);
    } catch (error) {
      // Logged, not thrown: Airwallex would otherwise retry a delivery we have already recorded.
      this.logger.error(`airwallex ${name} failed to apply: ${(error as Error).message}`);
    }
    return { ok: true };
  }

  private async apply(name: string, object: Record<string, unknown>) {
    const instalmentId = this.instalmentIdOf(object);
    if (name === 'payment_intent.succeeded') {
      if (!instalmentId) { this.logger.warn(`airwallex succeeded intent ${object.id} carries no instalment id`); return; }
      const attempt = object.latest_payment_attempt as { payment_method?: { type?: string } } | undefined;
      const type = attempt?.payment_method?.type ?? '';
      await this.billing.markPaid(instalmentId, {
        method: type.includes('debit') || type.includes('ach') ? 'DEBIT' : 'PUSH',
        reference: String(object.id ?? ''),
        source: 'airwallex',
        amountUsd: typeof object.amount === 'number' ? object.amount : undefined,
        paidAt: typeof object.updated_at === 'string' ? object.updated_at : undefined,
      });
      this.logger.log(`airwallex payment ${object.id} marked instalment ${instalmentId} paid`);
      return;
    }
    if (name === 'payment_intent.payment_failed' || name === 'payment_attempt.failed_to_process' || name === 'payment_attempt.expired') {
      await this.discord('⚠️ DFY payment did not go through', `${name}\nIntent: ${object.id ?? object.payment_intent_id ?? '?'}\nInstalment: ${instalmentId ?? 'unknown'}\nAmount: ${object.amount ?? '?'} ${object.currency ?? ''}`, 0xe67e22);
      return;
    }
    if (name.startsWith('payment_dispute.')) {
      await this.discord('🚩 DFY payment dispute', `${name}\nDispute: ${object.id ?? '?'}\nIntent: ${object.payment_intent_id ?? '?'}\nAmount: ${object.amount ?? '?'} ${object.currency ?? ''}\nReason: ${object.reason ?? object.dispute_reason ?? '?'}`, 0xe74c3c);
      return;
    }
    if (name === 'deposit.settled') {
      this.logger.log(`airwallex deposit settled: ${object.amount ?? '?'} ${object.currency ?? ''} ${object.id ?? ''}`);
      return;
    }
    this.logger.log(`airwallex ${name} recorded (no action)`);
  }

  private instalmentIdOf(object: Record<string, unknown>): string | null {
    const metadata = object.metadata as { instalmentId?: string } | undefined;
    const candidate = metadata?.instalmentId ?? (typeof object.merchant_order_id === 'string' ? object.merchant_order_id : null);
    return candidate && /^[0-9a-f-]{36}$/.test(candidate) ? candidate : null;
  }

  private async discord(title: string, description: string, color: number) {
    const hook = env('OS_DFY_DISCORD_WEBHOOK') ?? env('OS_WHOP_DISCORD_WEBHOOK');
    if (!hook) return;
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'DFY billing', embeds: [{ title, description, color }] }) });
    } catch (error) {
      this.logger.warn(`airwallex discord failed: ${(error as Error).message}`);
    }
  }
}
