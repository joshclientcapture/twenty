import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import { DataSource } from 'typeorm';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

const API = 'https://api.airwallex.com';
const TOKEN_TTL_MS = 25 * 60 * 1000;
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
// The payload version the webhook is registered with; events then carry this shape.
const WEBHOOK_VERSION = '2022-11-11';
const WEBHOOK_EVENTS = [
  'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.cancelled',
  'payment_attempt.settled', 'payment_attempt.paid', 'payment_attempt.expired', 'payment_attempt.failed_to_process',
  // Dispute events are not offered under this payload version; disputes arrive by email and in the dashboard.
  'deposit.settled',
];

export type TransferInstructions = {
  intentId: string;
  reference: string | null;
  accountName: string | null;
  accountNumber: string | null;
  bankName: string | null;
  routing: string | null;
  instructionUrl: string | null;
  text: string;
};

type IntentResponse = {
  id: string; status?: string; amount?: number; currency?: string; merchant_order_id?: string;
  next_action?: { type?: string; url?: string; data?: { transfer_instructions?: Record<string, string | undefined> } } | null;
  latest_payment_attempt?: { id?: string; payment_method?: { type?: string } } | null;
};

// Airwallex: DFY money in. Bank-transfer intents give each invoice its own reference and account
// details so transfers reconcile on their own; the webhook marks instalments paid; direct debits
// come later through the same client. Secrets live in os.app_settings, never in chat or git.
@Injectable()
export class OsAirwallexService {
  private readonly logger = new Logger(OsAirwallexService.name);
  private token: { value: string; expiresAt: number } | null = null;
  private tablesReady = false;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  isConfigured() {
    return !!env('OS_AIRWALLEX_CLIENT_ID') && !!env('OS_AIRWALLEX_API_KEY');
  }

  private async ensureTables() {
    if (this.tablesReady) return;
    await this.dataSource.query(`create table if not exists os.app_settings (key text primary key, value text not null, updated_at timestamptz default now())`);
    await this.dataSource.query(`create table if not exists os.airwallex_events (id text primary key, name text, received_at timestamptz default now(), payload jsonb)`);
    this.tablesReady = true;
  }

  async setting(key: string): Promise<string | null> {
    await this.ensureTables();
    const rows: { value: string }[] = await this.dataSource.query('select value from os.app_settings where key = $1', [key]);
    return rows[0]?.value ?? null;
  }

  private async setSetting(key: string, value: string) {
    await this.ensureTables();
    await this.dataSource.query('insert into os.app_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()', [key, value]);
  }

  private async login(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    const response = await fetch(`${API}/api/v1/authentication/login`, {
      method: 'POST',
      headers: { 'x-client-id': env('OS_AIRWALLEX_CLIENT_ID') ?? '', 'x-api-key': env('OS_AIRWALLEX_API_KEY') ?? '', 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw new Error(`airwallex login ${response.status}`);
    const data = (await response.json()) as { token?: string };
    if (!data.token) throw new Error('airwallex login returned no token');
    this.token = { value: data.token, expiresAt: Date.now() + TOKEN_TTL_MS };
    return data.token;
  }

  async api<TData>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<TData> {
    const token = await this.login();
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`airwallex ${method} ${path} ${response.status}: ${text.slice(0, 400)}`);
    return (text ? JSON.parse(text) : {}) as TData;
  }

  // ---------- webhook ----------

  // Registers our endpoint once and keeps the signing secret; the URL carries a random path token
  // as a second lock on top of the signature.
  async ensureWebhook(): Promise<{ url: string; registered: boolean }> {
    const serverUrl = env('SERVER_URL');
    if (!serverUrl) throw new Error('SERVER_URL is not set');
    let pathToken = await this.setting('airwallex.webhook.token');
    if (!pathToken) {
      pathToken = randomBytes(24).toString('hex');
      await this.setSetting('airwallex.webhook.token', pathToken);
    }
    const url = `${serverUrl}/os/airwallex/webhook/${pathToken}`;
    if (await this.setting('airwallex.webhook.secret')) return { url, registered: false };
    const created = await this.api<{ id?: string; secret?: string; url?: string }>('POST', '/api/v1/webhooks/create', {
      request_id: randomUUID(), url, events: WEBHOOK_EVENTS, version: WEBHOOK_VERSION,
    });
    if (!created.secret) throw new Error(`airwallex webhook created without a secret: ${JSON.stringify(created).slice(0, 200)}`);
    await this.setSetting('airwallex.webhook.secret', created.secret);
    if (created.id) await this.setSetting('airwallex.webhook.id', created.id);
    this.logger.log(`airwallex webhook registered at ${url}`);
    return { url, registered: true };
  }

  async webhookPathToken() {
    return this.setting('airwallex.webhook.token');
  }

  // x-signature = HMAC-SHA256(secret, x-timestamp + raw body), hex.
  async signatureIsValid(timestamp: string | undefined, signature: string | undefined, rawBody: Buffer | undefined): Promise<boolean> {
    const secret = await this.setting('airwallex.webhook.secret');
    if (!secret || !timestamp || !signature || !rawBody) return false;
    if (Math.abs(Date.now() - Number(timestamp)) > SIGNATURE_TOLERANCE_MS) return false;
    const expected = createHmac('sha256', secret).update(timestamp + rawBody.toString('utf8')).digest('hex');
    return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async recordEvent(id: string, name: string, payload: unknown): Promise<boolean> {
    await this.ensureTables();
    const inserted = await this.dataSource.query('insert into os.airwallex_events (id, name, payload) values ($1, $2, $3::jsonb) on conflict (id) do nothing returning id', [id, name, JSON.stringify(payload)]);
    return inserted.length > 0;
  }

  // ---------- bank transfer (push) ----------

  // One intent per instalment: Airwallex hands back the account to pay into and a reference,
  // and tells us by webhook when the money lands.
  async createBankTransfer(input: { instalmentId: string; amount: number; currency: string; email: string | null; name: string | null; description: string }): Promise<TransferInstructions> {
    const [firstName, ...rest] = (input.name ?? '').trim().split(/\s+/);
    const intent = await this.api<IntentResponse>('POST', '/api/v1/pa/payment_intents/create', {
      request_id: `dfy-${input.instalmentId}-${Date.now()}`,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency,
      merchant_order_id: input.instalmentId,
      descriptor: 'Conversifi DFY',
      metadata: { source: 'dfy', instalmentId: input.instalmentId },
      ...(input.email ? { customer: { email: input.email, first_name: firstName || undefined, last_name: rest.join(' ') || undefined } } : {}),
    });
    const confirmed = await this.api<IntentResponse>('POST', `/api/v1/pa/payment_intents/${intent.id}/confirm`, {
      request_id: `dfy-${input.instalmentId}-confirm-${Date.now()}`,
      payment_method: { type: 'bank_transfer', bank_transfer: { ...(input.email ? { shopper_email: input.email } : {}) } },
    });
    const details = confirmed.next_action?.data?.transfer_instructions ?? {};
    const instructions: TransferInstructions = {
      intentId: intent.id,
      reference: details.reference ?? null,
      accountName: details.account_name ?? null,
      accountNumber: details.account_number ?? null,
      bankName: details.bank_name ?? null,
      routing: details.routing_number ?? details.sort_code ?? details.swift_code ?? details.bank_code ?? null,
      instructionUrl: confirmed.next_action?.url ?? null,
      text: '',
    };
    const lines = [
      instructions.bankName ? `Bank: ${instructions.bankName}` : null,
      instructions.accountName ? `Account name: ${instructions.accountName}` : null,
      instructions.accountNumber ? `Account number: ${instructions.accountNumber}` : null,
      instructions.routing ? `Routing / sort code: ${instructions.routing}` : null,
      instructions.reference ? `Payment reference (required): ${instructions.reference}` : null,
      instructions.instructionUrl ? `Step-by-step instructions: ${instructions.instructionUrl}` : null,
    ].filter((line): line is string => line !== null);
    instructions.text = lines.join('\n');
    this.logger.log(`airwallex bank transfer intent ${intent.id} for instalment ${input.instalmentId}: ${instructions.reference ?? 'no reference'}`);
    return instructions;
  }
}
