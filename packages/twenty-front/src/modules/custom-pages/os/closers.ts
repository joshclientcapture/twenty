import { type Conversion, type ShowUp, type TheraponCash, type TheraponDaily } from '@/custom-pages/os/data';
import { osRpc } from '@/custom-pages/os/transport';

export type Closer = {
  id: string;
  // Equals the `closer` text on the sales ledger, which is how commission rows are matched.
  name: string;
  email: string | null;
  fathomEmail: string | null;
  calendlyHostEmail: string | null;
  commissionRate: number;
  commissioned: boolean;
  tracked: boolean;
  active: boolean;
};

export type CloserSales = {
  total: number;
  active: number;
  mrr: number;
  monthly: Record<string, { total: number; active: number; mrr: number }>;
};

export type CloserCommission = {
  rep: string;
  commission_rate: number;
  commissioned: boolean;
  next_payout: string;
  revenue: number;
  earned: number;
  paid: number;
  outstanding: number;
  payments: number;
  payments_paid: number;
  payments_due: number;
};

export type CloserInput = {
  id: string;
  name: string;
  email?: string | null;
  fathomEmail?: string | null;
  calendlyHostEmail?: string | null;
  calendlyUserUri?: string | null;
  commissionRate?: number | null;
  commissioned?: boolean | null;
  tracked?: boolean | null;
  active?: boolean | null;
};

export type CloserCallPatch = {
  key: string; status?: string | null; trialed?: boolean | null; stripe_email?: string | null;
  name?: string | null; email?: string | null; note?: string | null; by?: string | null;
};

type CloserRow = {
  id: string; name: string; email: string | null; fathom_email: string | null; calendly_host_email: string | null;
  commission_rate: number | null; commissioned: boolean | null; tracked: boolean | null; active: boolean | null;
};

export const THERAPON_CLOSER_ID = 'therapon';

export const slugifyCloserId = (name: string) =>
  name.toLowerCase().trim().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, '') ?? '';

export async function fetchClosers(): Promise<Closer[]> {
  const rows = (await osRpc<CloserRow[] | null>('get_closers')) ?? [];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    fathomEmail: row.fathom_email,
    calendlyHostEmail: row.calendly_host_email,
    commissionRate: row.commission_rate ?? 0.1,
    commissioned: row.commissioned ?? true,
    tracked: row.tracked ?? true,
    active: row.active ?? true,
  }));
}

export const findCloser = (closers: Closer[], id: string | undefined) =>
  closers.find((closer) => closer.id === id) ?? null;

export const findOwnCloser = (closers: Closer[], email: string | null | undefined) => {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;
  return closers.find((closer) => closer.email?.toLowerCase() === normalized) ?? null;
};

export const upsertCloser = (input: CloserInput) =>
  osRpc<{ id: string; name: string }>('upsert_closer', {
    p_id: input.id,
    p_name: input.name,
    p_login_email: input.email ?? null,
    p_fathom_email: input.fathomEmail ?? null,
    p_calendly_host_email: input.calendlyHostEmail ?? null,
    p_calendly_user_uri: input.calendlyUserUri ?? null,
    p_commission_rate: input.commissionRate ?? null,
    p_commissioned: input.commissioned ?? null,
    p_tracked: input.tracked ?? null,
    p_active: input.active ?? null,
  });

export const fetchCloserShowUp = (closerId: string) => osRpc<ShowUp>('get_closer_show_up', { p_closer_id: closerId });
export const fetchCloserConversion = (closerId: string) => osRpc<Conversion>('get_closer_conversion', { p_closer_id: closerId });
export const fetchCloserCash = (closerId: string) => osRpc<TheraponCash>('get_closer_cash', { p_closer_id: closerId });
export const fetchCloserSales = (closerId: string) => osRpc<CloserSales>('get_closer_sales', { p_closer_id: closerId });
export const fetchCloserCommission = (closerId: string) => osRpc<CloserCommission>('get_closer_commission', { p_closer_id: closerId });
export const fetchCloserDaily = (closerId: string, from: string, to: string) =>
  osRpc<TheraponDaily>('get_closer_daily', { p_closer_id: closerId, p_from: from, p_to: to });

export const setCloserCall = (closerId: string, patch: CloserCallPatch) =>
  osRpc<null>('set_closer_call', {
    p_closer_id: closerId, p_key: patch.key, p_status: patch.status ?? null, p_trialed: patch.trialed ?? null,
    p_stripe_email: patch.stripe_email ?? null, p_name: patch.name ?? null, p_email: patch.email ?? null,
    p_note: patch.note ?? null, p_by: patch.by ?? null,
  });

export const clearCloserCall = (closerId: string, key: string) =>
  osRpc<null>('clear_closer_call', { p_closer_id: closerId, p_key: key });
