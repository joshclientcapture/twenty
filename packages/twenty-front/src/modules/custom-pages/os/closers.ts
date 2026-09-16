import {
  clearTheraponCall,
  fetchConversion,
  fetchShowUp,
  fetchTheraponCash,
  fetchTheraponDaily,
  setTheraponCall,
  type Conversion,
  type ShowUp,
  type TheraponCash,
  type TheraponDaily,
} from '@/custom-pages/os/data';
import { osClient as supabase } from '@/custom-pages/os/transport';

export type Closer = {
  id: string;
  // Must match the `closer` value on the OS sales ledger so commission rows line up.
  name: string;
  email: string | null;
  commissionRate: number;
  // Call-level tracking (show-up, conversion, daily log) exists only for closers whose
  // Calendly + Fathom activity the OS syncs. Untracked closers still get ledger commission.
  tracked: boolean;
  active: boolean;
};

export const THERAPON_CLOSER_ID = 'therapon';

// Mirrors the OS `CLOSERS` constant until the `closers` table exists in the OS project.
const FALLBACK_CLOSERS: Closer[] = [
  { id: THERAPON_CLOSER_ID, name: 'Therapon Savvas', email: null, commissionRate: 0.1, tracked: true, active: true },
  { id: 'jamal', name: 'Jamal Robinson', email: null, commissionRate: 0.1, tracked: false, active: true },
];

type CloserRow = {
  id: string; name: string; email: string | null; commission_rate: number | null; tracked: boolean | null; active: boolean | null;
};

export async function fetchClosers(): Promise<Closer[]> {
  const { data, error } = await supabase.rpc('get_closers');
  if (error || !Array.isArray(data) || data.length === 0) return FALLBACK_CLOSERS;
  return (data as CloserRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    commissionRate: r.commission_rate ?? 0.1,
    tracked: r.tracked ?? false,
    active: r.active ?? true,
  }));
}

export const findCloser = (closers: Closer[], id: string | undefined) =>
  closers.find((c) => c.id === id) ?? null;

const isTherapon = (closer: Closer) => closer.id === THERAPON_CLOSER_ID;

// Therapon's numbers come from the original single-closer RPCs. Every other closer goes
// through the `get_closer_*` family, which takes `p_closer_id`.
export async function fetchCloserShowUp(closer: Closer): Promise<ShowUp> {
  if (isTherapon(closer)) return fetchShowUp();
  const { data, error } = await supabase.rpc('get_closer_show_up', { p_closer_id: closer.id });
  if (error) throw error;
  return data as ShowUp;
}

export async function fetchCloserConversion(closer: Closer): Promise<Conversion> {
  if (isTherapon(closer)) return fetchConversion();
  const { data, error } = await supabase.rpc('get_closer_conversion', { p_closer_id: closer.id });
  if (error) throw error;
  return data as Conversion;
}

export async function fetchCloserCash(closer: Closer): Promise<TheraponCash> {
  if (isTherapon(closer)) return fetchTheraponCash();
  const { data, error } = await supabase.rpc('get_closer_cash', { p_closer_id: closer.id });
  if (error) throw error;
  return data as TheraponCash;
}

export async function fetchCloserDaily(closer: Closer, from: string, to: string): Promise<TheraponDaily> {
  if (isTherapon(closer)) return fetchTheraponDaily(from, to);
  const { data, error } = await supabase.rpc('get_closer_daily', { p_closer_id: closer.id, p_from: from, p_to: to });
  if (error) throw error;
  return data as TheraponDaily;
}

export type CloserCallPatch = {
  key: string; status?: string | null; trialed?: boolean | null; stripe_email?: string | null;
  name?: string | null; email?: string | null; note?: string | null; by?: string | null;
};

export async function setCloserCall(closer: Closer, p: CloserCallPatch): Promise<void> {
  if (isTherapon(closer)) return setTheraponCall(p);
  const { error } = await supabase.rpc('set_closer_call', {
    p_closer_id: closer.id, p_key: p.key, p_status: p.status ?? null, p_trialed: p.trialed ?? null,
    p_stripe_email: p.stripe_email ?? null, p_name: p.name ?? null, p_email: p.email ?? null,
    p_note: p.note ?? null, p_by: p.by ?? null,
  });
  if (error) throw error;
}

export async function clearCloserCall(closer: Closer, key: string): Promise<void> {
  if (isTherapon(closer)) return clearTheraponCall(key);
  const { error } = await supabase.rpc('clear_closer_call', { p_closer_id: closer.id, p_key: key });
  if (error) throw error;
}
