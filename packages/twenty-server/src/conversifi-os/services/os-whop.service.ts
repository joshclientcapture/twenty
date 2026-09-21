import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { createHmac, timingSafeEqual } from 'crypto';

import { DataSource } from 'typeorm';

import { OsUpsertService } from 'src/conversifi-os/services/os-upsert.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

const WHOP_API = 'https://api.whop.com/api/v1';
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
// Whop membership statuses that still grant access.
const LIVE_MEMBERSHIP = new Set(['active', 'trialing', 'past_due', 'canceling']);

type WhopUser = { id?: string; email?: string | null; name?: string | null };
type WhopRef = { id?: string; title?: string | null };
type WhopPayment = {
  id: string; status?: string; total?: number | string | null; currency?: string | null; refunded_amount?: number | string | null;
  paid_at?: string | null; created_at?: string | null; user?: WhopUser | null; member?: WhopRef | null; membership?: WhopRef | null;
  product?: WhopRef | null; plan?: WhopRef | null;
};
type WhopMembership = {
  id: string; status?: string; user?: WhopUser | null; member?: WhopRef | null; product?: WhopRef | null; plan?: WhopRef | null;
  created_at?: string | null; renewal_period_start?: string | null; renewal_period_end?: string | null; canceled_at?: string | null;
  cancel_at_period_end?: boolean | null;
};

const cents = (value: number | string | null | undefined) => (value === null || value === undefined || value === '' ? null : Math.round(Number(value) * 100));

// DFY subscriptions are billed through Whop. Webhooks land here in real time and a poll backfills
// what the webhook missed; both write the same two tables the lifecycle and the ledger read.
@Injectable()
export class OsWhopService {
  private readonly logger = new Logger(OsWhopService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly upsert: OsUpsertService,
  ) {}

  isConfigured() {
    return !!env('OS_WHOP_API_KEY');
  }

  // Standard Webhooks: HMAC-SHA256 over "<id>.<timestamp>.<raw body>", base64, in "v1,<sig>" pairs.
  // Whop hands out the secret as "ws_<base64>"; the key is the decoded part after the prefix.
  signatureIsValid(headers: Record<string, string | undefined>, rawBody: Buffer | undefined): boolean {
    const secret = env('OS_WHOP_WEBHOOK_SECRET');
    if (!secret) return false;
    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const signatureHeader = headers['webhook-signature'] ?? '';
    if (!id || !timestamp || !rawBody) return false;
    if (Math.abs(Date.now() - Number(timestamp) * 1000) > SIGNATURE_TOLERANCE_MS) return false;
    const bare = secret.replace(/^(ws_|whsec_)/, '');
    const keys = [Buffer.from(bare, 'base64'), Buffer.from(secret, 'utf8'), Buffer.from(bare, 'utf8')];
    const provided = signatureHeader.split(' ').map((part) => part.split(',')[1] ?? '').filter(Boolean);
    const message = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
    return keys.some((key) => {
      const expected = createHmac('sha256', key).update(message).digest('base64');
      return provided.some((candidate) => candidate.length === expected.length && timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)));
    });
  }

  async record(webhookId: string, event: string, payload: unknown) {
    const inserted = await this.dataSource.query(
      'insert into os.whop_events (id, event, payload) values ($1, $2, $3::jsonb) on conflict (id) do nothing returning id',
      [webhookId, event, JSON.stringify(payload)],
    );
    return inserted.length > 0;
  }

  async applyPayment(payment: WhopPayment) {
    if (!payment?.id) return;
    await this.upsert.rows('whop_payments', [{
      id: payment.id,
      status: payment.status ?? null,
      total_cents: cents(payment.total),
      currency: payment.currency ?? null,
      refunded_cents: cents(payment.refunded_amount),
      paid_at: payment.paid_at ?? null,
      created_at: payment.created_at ?? null,
      user_id: payment.user?.id ?? null,
      email: payment.user?.email?.toLowerCase() ?? null,
      name: payment.user?.name ?? null,
      member_id: payment.member?.id ?? null,
      membership_id: payment.membership?.id ?? null,
      product_id: payment.product?.id ?? null,
      product_title: payment.product?.title ?? null,
      plan_id: payment.plan?.id ?? null,
      synced_at: new Date().toISOString(),
    }], ['id']);
  }

  async applyMembership(membership: WhopMembership) {
    if (!membership?.id) return;
    await this.upsert.rows('whop_memberships', [{
      id: membership.id,
      status: membership.status ?? null,
      valid: LIVE_MEMBERSHIP.has(membership.status ?? ''),
      user_id: membership.user?.id ?? null,
      email: membership.user?.email?.toLowerCase() ?? null,
      name: membership.user?.name ?? null,
      member_id: membership.member?.id ?? null,
      product_id: membership.product?.id ?? null,
      product_title: membership.product?.title ?? null,
      plan_id: membership.plan?.id ?? null,
      created_at: membership.created_at ?? null,
      renewal_period_start: membership.renewal_period_start ?? null,
      renewal_period_end: membership.renewal_period_end ?? null,
      canceled_at: membership.canceled_at ?? null,
      cancel_at_period_end: membership.cancel_at_period_end ?? null,
      synced_at: new Date().toISOString(),
    }], ['id']);
  }

  // Paid Whop payments join the Stripe payments table (source = 'whop') so the sales ledger, commission
  // and Records see one list; the ledger is rebuilt right after so a new DFY sale is attributed at once.
  async mirrorToLedger() {
    await this.dataSource.query('select os.mirror_whop_payments()');
    await this.dataSource.query('select os.refresh_sales_ledger()');
  }

  // Full re-read of payments and memberships from the API; cheap at DFY volumes and it fills whatever
  // a missed webhook left out. Product titles come from the product list so the ledger can name them.
  async sync() {
    const key = env('OS_WHOP_API_KEY');
    const account = env('OS_WHOP_ACCOUNT_ID') ?? 'biz_hAs1H6D2HoNlpI';
    if (!key) return { skipped: 'no OS_WHOP_API_KEY' };
    const headers = { Authorization: `Bearer ${key}` };
    const list = async <TItem>(path: string): Promise<TItem[]> => {
      const items: TItem[] = [];
      let after: string | null = null;
      for (;;) {
        const url = `${WHOP_API}/${path}?account_id=${encodeURIComponent(account)}&first=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const response = await fetch(url, { headers });
        if (!response.ok) throw new Error(`whop ${path} ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const page = (await response.json()) as { data: TItem[]; page_info?: { has_next_page?: boolean; end_cursor?: string | null } };
        items.push(...(page.data ?? []));
        if (!page.page_info?.has_next_page || !page.page_info.end_cursor) return items;
        after = page.page_info.end_cursor;
      }
    };
    const products = await list<{ id: string; title: string }>('products');
    const titleOf = new Map(products.map((product) => [product.id, product.title]));
    for (const product of products) {
      await this.dataSource.query(
        `insert into os.whop_products (id, title) values ($1, $2) on conflict (id) do update set title = excluded.title`,
        [product.id, product.title],
      );
    }
    const withTitle = <TItem extends { product?: WhopRef | null }>(item: TItem): TItem =>
      item.product?.id && !item.product.title ? { ...item, product: { ...item.product, title: titleOf.get(item.product.id) ?? null } } : item;
    const memberships = await list<WhopMembership>('memberships');
    for (const membership of memberships) await this.applyMembership(withTitle(membership));
    const payments = await list<WhopPayment>('payments');
    for (const payment of payments) await this.applyPayment(withTitle(payment));
    await this.mirrorToLedger();
    return { products: products.length, memberships: memberships.length, payments: payments.length };
  }
}
