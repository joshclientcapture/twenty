// Data layer copied from the OS app's lib/supabase.ts. The functions below are served by
// twenty-server from the `os` schema of the CRM database (see transport.ts).
import { osClient } from "@/custom-pages/os/transport";

export type DashboardMetrics = {
  generated_at: string;
  kpis: { appts_booked: number; appts_held: number; appts_upcoming: number; appts_canceled: number };
  appointments_sat: number;
  trials_started: number;
  revenue: {
    currency: string; total_collected: number; from_sales_calls: number; sales_commission: number;
    therapon_customers: number; jamal_customers: number; jamal_revenue: number;
    unattributed_customers: number; unattributed_revenue: number;
    by_source: {
      linkedin_outreach: { n: number; v: number };
      email_marketing: { n: number; v: number };
      organic: { n: number; v: number };
      paid_ads: { n: number; v: number };
      unattributed: { n: number; v: number };
    };
  };
  subs: { total: number; active: number; trialing: number; ever_paid: number };
  attribution: { email: number; name: number; unmatched: number; paid_from_appt: number; paid_total: number };
  attribution_recent: { paid: number; paid_from_appt: number; pct: number };
  linkedin: { total: number; active: number; idle: number };
  linkedin_monthly: { month: string; added: number; cumulative: number }[];
  appts_monthly: { month: string; booked: number; held: number; upcoming: number; canceled: number }[];
  signups_monthly: { month: string; signups: number; paid: number; sales: number }[];
};

export async function fetchDashboardMetrics(): Promise<DashboardMetrics> {
  const { data, error } = await osClient.rpc("get_dashboard_metrics");
  if (error) throw error;
  return data as DashboardMetrics;
}

export type ShowUpStats = { booked: number; occurred: number; held: number; canceled: number; rescheduled: number; upcoming: number; no_show: number; recorded: number; rate: number; cancel_rate: number };
export type ShowUp = ShowUpStats & { monthly: Record<string, ShowUpStats> };
// Show-up rate EXCLUDES cancellations: rate = recorded ÷ held. Cancellations are
// reported separately (canceled / cancel_rate). See get_show_up() RPC.
export async function fetchShowUp(): Promise<ShowUp> {
  const { data, error } = await osClient.rpc("get_show_up");
  if (error) throw error;
  return data as ShowUp;
}

// Evergreen webinar funnel, split into TWO equally-weighted paths that share the same top (registered
// -> showed up), then diverge:
//   Offer path:  ... -> saw offer -> clicked offer -> $599 yearly paid   (event-tracked)
//   Trial path:  ... -> clicked start trial -> trial started -> paying   (paid/started DERIVED from Stripe)
// Fed by the `webinar_events` table (written by the main project's webinar-track edge function); the
// trial/paying stages are derived by joining attendee emails against the OS's existing Stripe data.
export type WebinarFunnel = {
  // Shared top of both funnels. `due` = sessions whose time has passed (the only fair
  // denominator for show-up rate); `showed` = of those, who turned up.
  shared: { registered: number; entered: number; due: number; showed: number; upcoming: number; rescheduled: number };
  // Offer path close: 'paid' is the webinar $599 'paid' event.
  offer: { reached_offer: number; offer_click: number; paid: number };
  // Trial path: trial_click is the event; trial_started + paid are DERIVED from Stripe (attendees who
  // started a trial, and of those, who are now paying).
  trial: { trial_click: number; trial_started: number; paid: number };
  // Broader outcomes across ALL attendees (any path), joined to Stripe. The true payoff.
  outcomes: {
    trialing_now: number;    // attendee emails currently trialing
    trial_started: number;   // attendee emails that EVER started a trial
    paying_any: number;      // attendee emails paying now, ANY plan (the headline)
    paying_monthly: number;  // subset on a monthly plan
    paying_yearly: number;   // subset on a yearly plan
    mrr_cents: number;       // total MRR from paying attendees
  };
  daily: { day: string; registered: number; entered: number; trial_click: number; offer_click: number }[];
};

export async function fetchWebinarFunnel(from: string | null = null, to: string | null = null): Promise<WebinarFunnel> {
  const { data, error } = await osClient.rpc("get_webinar_funnel", { p_from: from, p_to: to });
  if (error) throw error;
  return data as WebinarFunnel;
}

// The people behind a single funnel/outcome stage, for the click-through drill-down.
// `at` = when their event fired (e.g. when they registered). `slot` = the webinar session
// they actually booked (props.slot on the registered event) — only set for attendees.
export type WebinarMember = { email: string; name: string | null; at: string | null; slot: string | null; rescheduled: boolean; bookings: number };
export async function fetchWebinarStageMembers(stage: string, from: string | null = null, to: string | null = null): Promise<WebinarMember[]> {
  const { data, error } = await osClient.rpc("get_webinar_stage_members", { p_stage: stage, p_from: from, p_to: to });
  if (error) throw error;
  return (data as WebinarMember[]) ?? [];
}

// Remove a person from an EVENT-based stage (deletes their matching webinar_events rows in range).
// Only works for event stages (registered/entered/reached_offer/offer_click/trial_click/offer_paid);
// the Stripe-derived stages have no event rows to delete. Returns the number of rows removed.
export async function deleteWebinarStageMember(stage: string, email: string, from: string | null = null, to: string | null = null): Promise<number> {
  const { data, error } = await osClient.rpc("delete_webinar_stage_member", { p_stage: stage, p_email: email, p_from: from, p_to: to });
  if (error) throw error;
  return (data as number) ?? 0;
}

export type RangeMetrics = {
  from: string; to: string; booked: number; recorded: number; held: number; no_show: number;
  canceled: number; show_up_rate: number | null; cancel_rate: number | null;
  sat_trials: number; conversion: number | null;
  trials_total: number; trials_therapon: number; sales_total: number; sales_therapon: number; cash_collected: number;
};

// Trial conversion cohort: of appointments SAT in a period, how many prospects started a trial.
export type ConvStats = { sat: number; sat_trials: number; trials_total: number; rate: number | null };
export type Conversion = { total: ConvStats; monthly: Record<string, ConvStats> };
export async function fetchConversion(): Promise<Conversion> {
  const { data, error } = await osClient.rpc("get_conversion");
  if (error) throw error;
  return data as Conversion;
}
// All dashboard KPIs computed for an arbitrary [from,to] date range.
export async function fetchRangeMetrics(from: string, to: string): Promise<RangeMetrics> {
  const { data, error } = await osClient.rpc("get_range_metrics", { p_from: from, p_to: to });
  if (error) throw error;
  return data as RangeMetrics;
}

export type CountryGeo = { country: string; count: number };
export type CustomerGeo = { total_located: number; countries: CountryGeo[] };
// Customer locations (from Stripe billing/card country), aggregated by country.
export async function fetchCustomerGeo(): Promise<CustomerGeo> {
  const { data, error } = await osClient.rpc("get_customer_geo");
  if (error) throw error;
  return data as CustomerGeo;
}

export type CustomerPoint = {
  customer_id: string; name: string; email: string | null;
  country: string; state: string | null; city: string | null;
  lat: number | null; lng: number | null; payments: number; total_paid: number; active: boolean;
};
// One row per paying customer with precise coords (ZIP-geocoded for US/CA/UK) + payment stats.
export async function fetchCustomerPoints(): Promise<CustomerPoint[]> {
  const { data, error } = await osClient.rpc("get_customer_points");
  if (error) throw error;
  return (data ?? []) as CustomerPoint[];
}

export type GrowthPoint = { month: string; arr: number; subscribers: number };
export type Growth = { current_arr: number; current_mrr: number; current_subscribers: number; arr_goal: number; series: GrowthPoint[] };
export async function fetchGrowth(): Promise<Growth> {
  const { data, error } = await osClient.rpc("get_growth");
  if (error) throw error;
  return data as Growth;
}

export type DfyRevenue = { mrr: number; clients: number; collected: number; collected_this_month: number; monthly: Record<string, number> };
export async function fetchDfyRevenue(): Promise<DfyRevenue> {
  const { data, error } = await osClient.rpc("get_dfy_revenue");
  if (error) throw error;
  return data as DfyRevenue;
}

export type ChurnMonth = { month: string; start: number; new: number; churned: number; reactivated: number; net: number; churn_rate: number | null; churned_arr: number };
export type Churn = { months: ChurnMonth[]; series: { month: string; rate: number | null }[] };
export async function fetchChurn(): Promise<Churn> {
  const { data, error } = await osClient.rpc("get_churn");
  if (error) throw error;
  return data as Churn;
}
export type ChurnListRow = {
  customer_id: string; name: string; email: string | null; plan: string | null; interval: string;
  mrr: number; arr: number; cancel_date: string | null; start_date: string; status: string;
};
export async function fetchChurnList(type: string, month: string | null = null): Promise<ChurnListRow[]> {
  const { data, error } = await osClient.rpc("get_churn_list", { p_type: type, p_month: month });
  if (error) throw error;
  return (data ?? []) as ChurnListRow[];
}

export type RenewalRow = {
  customer_id: string; name: string; country: string | null;
  renewal: string; past_due: boolean; status: "active" | "past_due" | "canceling";
  mrr: number; arr: number; net_payments: number; plan: string | null; interval: string; since: string;
};
export type Renewals = { days: number; count: number; past_due_count: number; total_expected: number; rows: RenewalRow[] };
// Upcoming subscription renewals due within N days (forecast).
export async function fetchUpcomingRenewals(days: number): Promise<Renewals> {
  const { data, error } = await osClient.rpc("get_upcoming_renewals", { p_days: days });
  if (error) throw error;
  return data as Renewals;
}

export type TrialRow = {
  sub_id: string; customer_id: string; name: string; country: string | null; plan: string | null; interval: string;
  est: boolean; mrr: number; arr: number; trial_end: string; since: string;
};
export type TrialForecast = {
  days: number; conversion_rate: number; count: number; expected_conversions: number;
  potential_mrr: number; expected_mrr: number; rows: TrialRow[];
};
// Trials expiring within N days × conversion rate → expected new revenue.
export async function fetchTrialForecast(days: number): Promise<TrialForecast> {
  const { data, error } = await osClient.rpc("get_trial_forecast", { p_days: days });
  if (error) throw error;
  return data as TrialForecast;
}
// Manually hide (or restore) a specific trial subscription from the forecast.
export async function hideTrial(subId: string): Promise<void> {
  const { error } = await osClient.rpc("hide_trial", { p_sub_id: subId });
  if (error) throw error;
}
export async function unhideTrial(subId: string): Promise<void> {
  const { error } = await osClient.rpc("unhide_trial", { p_sub_id: subId });
  if (error) throw error;
}

export type GoalMonth = { month: string; clients: number; trials: number };
// Actual new clients + trials per month, for the Goals page (vs the growth-plan ramp).
export async function fetchGoalTracker(): Promise<GoalMonth[]> {
  const { data, error } = await osClient.rpc("get_goal_tracker");
  if (error) throw error;
  return ((data as { months?: GoalMonth[] })?.months ?? []);
}

export type TheraponCash = { total: number; monthly: Record<string, number> };
export async function fetchTheraponCash(): Promise<TheraponCash> {
  const { data, error } = await osClient.rpc("get_therapon_cash");
  if (error) throw error;
  return data as TheraponCash;
}

// `active`/`mrr` are only populated on the sales split (Therapon's paying customers still active + their MRR).
export type AttrSplit = { total: number; therapon: number; active?: number; mrr?: number; monthly: Record<string, { total: number; therapon: number; active?: number; mrr?: number }> };
export type TrialPath = { trials: number; sales: number; rate: number | null };
export type TrialPaths = { appointment: TrialPath; organic: TrialPath; funnel: { sat: number; sat_trials: number; sat_sales: number } };
// Trial to sale by path, every closer: booked a sales call vs signed up on their own.
export async function fetchTrialPaths(): Promise<TrialPaths> {
  const { data, error } = await osClient.rpc("get_trial_paths");
  if (error) throw error;
  return data as TrialPaths;
}

export type AttributionSplit = { trials: AttrSplit; sales: AttrSplit };
// Trials & sales, total vs Therapon-attributed (customer booked/sat a sales call).
export async function fetchAttributionSplit(): Promise<AttributionSplit> {
  const { data, error } = await osClient.rpc("get_attribution_split");
  if (error) throw error;
  return data as AttributionSplit;
}

export type ShowUpBucket = {
  start: string; occurred: number; canceled: number; held: number; no_show: number; recorded: number;
  rate: number | null; cancel_rate: number | null;
};
export type ShowUpSeries = { grain: string; buckets: ShowUpBucket[]; total: Omit<ShowUpBucket, "start"> };
// Bucketed show-up (day/week/month) with an optional [from,to] range and a total row.
export async function fetchShowUpSeries(grain: string, from: string | null = null, to: string | null = null): Promise<ShowUpSeries> {
  const { data, error } = await osClient.rpc("get_show_up_series", { p_grain: grain, p_from: from, p_to: to });
  if (error) throw error;
  return data as ShowUpSeries;
}

export async function fetchLastSync(): Promise<string | null> {
  const { data, error } = await osClient.rpc("get_last_sync");
  if (error) throw error;
  return (data as string) ?? null;
}

export type DisconnectedAccount = { name: string; disconnected_at: string | null };
export async function fetchDisconnected(): Promise<DisconnectedAccount[]> {
  const { data, error } = await osClient.rpc("get_disconnected_accounts");
  if (error) throw error;
  return (data ?? []) as DisconnectedAccount[];
}

export type MonthlyRow = {
  month: string; month_key: string; booked: number; sat: number; trials: number;
  transactions: number; new_customers: number; new_sales: number; therapon_sales: number;
  cash_collected: number; sales_revenue: number; commission: number;
};

export type RecordRow = Record<string, string | number | boolean | null>;
export async function fetchRecords(type: string, month: string | null, arg: string | null = null, from: string | null = null, to: string | null = null): Promise<RecordRow[]> {
  if (type.startsWith("setters")) {
    const { data, error } = await osClient.rpc("get_setter_list", { p_bucket: type, p_month: month, p_recruiter: arg });
    if (error) throw error;
    return (data ?? []) as RecordRow[];
  }
  if (type === "new_customers" || type === "churned_customers") {
    const { data, error } = await osClient.rpc("get_customer_records", {
      p_kind: type === "churned_customers" ? "churned" : "new", p_month: month, p_from: from, p_to: to,
    });
    if (error) throw error;
    return (data ?? []) as RecordRow[];
  }
  if (type === "therapon_customers") {
    const { data, error } = await osClient.rpc("get_therapon_customers", { p_month: month, p_from: from, p_to: to });
    if (error) throw error;
    return (data ?? []) as RecordRow[];
  }
  // `arg` carries the closer id for the per-closer customers drill-down.
  if (type === "closer_customers") {
    const { data, error } = await osClient.rpc("get_closer_customers", { p_closer_id: arg, p_month: month, p_from: from, p_to: to });
    if (error) throw error;
    return (data ?? []) as RecordRow[];
  }
  const { data, error } = await osClient.rpc("get_records", { p_type: type, p_month: month, p_arg: arg, p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as RecordRow[];
}

// Customer-level new/churned counts for a period (month, custom range, or all-time when all null).
export type CustomerCounts = { new: number; churned: number };
export async function fetchCustomerCounts(month: string | null, from: string | null = null, to: string | null = null): Promise<CustomerCounts> {
  const { data, error } = await osClient.rpc("get_customer_counts", { p_month: month, p_from: from, p_to: to });
  if (error) throw error;
  return data as CustomerCounts;
}

// Therapon's daily call log for any date range (calls, show-ups, trials).
// `maybe` = a likely-but-unconfirmed trial (Stripe name matches the booking name, started near the
// call, but a different email). Needs a human to approve — see the "maybe match" chip.
export type MaybeMatch = { email: string; name: string | null; mins: number | null };
export type DailyLogRow = { key: string; time: string; name: string | null; email: string | null; status: string; trialed: boolean; recording: string | null; overridden?: boolean; stripe_email?: string | null; note?: string | null; maybe?: MaybeMatch | null };
export type DailyDay = { date: string; booked: number; showed: number; no_show: number; trials: number };
export type TheraponDaily = {
  from: string; to: string;
  summary: { booked: number; showed: number; no_show: number; in_progress: number; cancelled: number; upcoming: number; trials: number; maybe_trials?: number; show_up_rate: number | null };
  daily: DailyDay[];
  log: DailyLogRow[];
};
export async function fetchTheraponDaily(from: string, to: string): Promise<TheraponDaily> {
  const { data, error } = await osClient.rpc("get_therapon_daily", { p_from: from, p_to: to });
  if (error) throw error;
  return data as TheraponDaily;
}
// Manually set a call's status / trial. For a trial, stripe_email is the address they used on
// Stripe — it attributes both the trial and the eventual sale to Therapon automatically.
export async function setTheraponCall(p: {
  key: string; status?: string | null; trialed?: boolean | null; stripe_email?: string | null;
  name?: string | null; email?: string | null; note?: string | null; by?: string | null;
}): Promise<void> {
  const { error } = await osClient.rpc("set_therapon_call", {
    p_key: p.key, p_status: p.status ?? null, p_trialed: p.trialed ?? null,
    p_stripe_email: p.stripe_email ?? null, p_name: p.name ?? null, p_email: p.email ?? null,
    p_note: p.note ?? null, p_by: p.by ?? null,
  });
  if (error) throw error;
}
export async function clearTheraponCall(key: string): Promise<void> {
  const { error } = await osClient.rpc("clear_therapon_call", { p_key: key });
  if (error) throw error;
}

// Onboarding-call impact: does Melanie's complimentary setup call lift trial→paid conversion?
export type OnboardCohort = { trials: number; converted: number; rate: number; revenue: number; rev_per_trial: number; rev_per_customer: number };
export type ConvCohort = { trials: number; converted: number; rate: number };
export type OnboardPerson = {
  name: string; email: string; onboarded: boolean; onboard_date: string | null; sales_call: boolean; converted: boolean; paid_date: string | null; revenue: number;
};
export type OnboardingImpact = {
  summary: {
    trials_people: number; trials_subs: number; converted_total: number; onboarding_calls: number;
    avg_active_mrr: number; active_subs: number; ltv_3mo: number;
    onboarded: OnboardCohort; not_onboarded: OnboardCohort; uplift_pts: number; rev_per_trial_gap: number;
    among_sales_call: { onboarded: ConvCohort; not_onboarded: ConvCohort; uplift_pts: number };
  };
  excluded: { email: string }[];
  people: OnboardPerson[];
};
export async function fetchOnboardingImpact(): Promise<OnboardingImpact> {
  const { data, error } = await osClient.rpc("get_onboarding_impact");
  if (error) throw error;
  return data as OnboardingImpact;
}
// Manually remove / restore a person from the onboarding analysis (e.g. an untracked call).
export async function excludeFromOnboarding(email: string): Promise<void> {
  const { error } = await osClient.rpc("exclude_from_onboarding", { p_email: email });
  if (error) throw error;
}
export async function includeInOnboarding(email: string): Promise<void> {
  const { error } = await osClient.rpc("include_in_onboarding", { p_email: email });
  if (error) throw error;
}

// Agency Partners — our highest-priority clients. MRR sums ALL active subscriptions
// (agency plan + account rentals + managed services); LTV = revenue paid to date.
export type AgencyPartner = {
  customer_id: string; name: string; email: string | null; plan: string; seats: number;
  payment_status: "active" | "past_due" | "trialing" | "churned";
  software_mrr: number; rentals_mrr: number; service_mrr: number; total_mrr: number; ltv: number;
  first_paid: string | null; months_active: number;
  accounts_active: number; accounts_total: number; campaigns_active: number; campaigns_total: number;
  status: string; notes: string | null;
};
export type AgencyPartners = {
  agencies: AgencyPartner[];
  summary: {
    count: number; total_mrr: number; total_ltv: number; total_rentals_mrr: number; total_service_mrr: number;
    avg_mrr: number; avg_months: number; agency_count: number; lite_count: number;
    past_due_count: number; churned_count: number;
    total_seats: number; total_accounts_active: number; total_campaigns_active: number;
  };
};
export async function fetchAgencyPartners(): Promise<AgencyPartners> {
  const { data, error } = await osClient.rpc("get_agency_partners");
  if (error) throw error;
  return data as AgencyPartners;
}
export async function setAgencyPartner(customerId: string, status: string, notes: string | null): Promise<void> {
  const { error } = await osClient.rpc("set_agency_partner", { p_customer_id: customerId, p_status: status, p_notes: notes });
  if (error) throw error;
}

// Drill-down behind an agency's seat/activity numbers: the individual LinkedIn
// accounts, each tagged live (in an active campaign), idle (connected but no active
// campaign — a wasted seat) or disconnected (login broken). Same prod source as the
// aggregate counts, so it always reconciles.
export type AgencySeat = {
  account_id: string; label: string; last_status: string | null; last_status_at: string | null;
  in_active_campaign: boolean; requests_sent: number; state: "live" | "idle" | "disconnected";
};
export type AgencyAccounts = {
  accounts: AgencySeat[];
  summary: { total: number; live: number; idle: number; disconnected: number; requests_sent: number };
};
export async function fetchAgencyAccounts(customerId: string): Promise<AgencyAccounts> {
  const { data, error } = await osClient.rpc("get_agency_accounts", { p_customer_id: customerId });
  if (error) throw error;
  return data as AgencyAccounts;
}

// Appointment-setter attribution: which LinkedIn account sourced each Calendly booking
// (name match + conversation tie-break for duplicate names). Runs on demand via a button.
export type SetterAttribution = {
  name: string; account_id: string; campaign: string; in_active_campaign: boolean;
  requests_sent: number; bookings: number; status: string; recruiter: string; days_active: number;
};
export type AttributionMeta = { last_run: string | null; total_bookings: number; matched: number; collisions: number; no_match: number };
export type SetterAttributionData = { setters: SetterAttribution[]; meta: AttributionMeta };
export async function fetchSetterAttribution(): Promise<SetterAttributionData> {
  const { data, error } = await osClient.rpc("get_setter_attribution");
  if (error) throw error;
  return data as SetterAttributionData;
}
export async function refreshAttribution(): Promise<{ ok: boolean; new_bookings: number; matched_this_run: number; meta: AttributionMeta }> {
  const { data, error } = await osClient.functions.invoke("attribute-bookings", { body: {} });
  if (error) throw error;
  return data as { ok: boolean; new_bookings: number; matched_this_run: number; meta: AttributionMeta };
}

// Agency Ad Campaign (investor clarity page). Live counts for our one Facebook campaign,
// pulled from Cometly via the `cometly-campaign` edge function (token stays server-side).
// ad_spend / trials / revenue are null until wired from another source (the REST token
// can't return ad spend).
export type AgencyAdCampaign = {
  campaign_name: string;
  source: string;
  attribution: string;
  window: { start: string; end: string };
  total_events: number;
  counts: { leads: number; webinar_registrations: number; calls_booked: number; contacts: number };
  adsets: Record<string, number>;
  ad_spend: number | null;
  trials: number | null;
  revenue: number | null;
  generated_at: string;
};
export async function fetchAgencyAdCampaign(): Promise<AgencyAdCampaign> {
  const { data, error } = await osClient.functions.invoke("cometly-campaign", { body: {} });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as AgencyAdCampaign;
}

// Agency Ad Campaign funnel — live from GoHighLevel via the `ghl-ad-funnel` edge
// function (ad-attributed contacts only, test accounts + pre-launch leads stripped).
export type AdFunnelPerson = { name: string; email: string; at: string; note?: string };
export type AdFunnelStage = { key: string; label: string; hint: string; highlight?: boolean; people: AdFunnelPerson[] };
export type AdFunnel = {
  updated: string;
  since: string;
  total_leads: number;
  partial: number;
  full: number;
  excluded_tests: number;
  mrr_cents: number;
  cash_cents: number;
  converted_count: number;
  active_payers: number;
  on_trial: number;
  stages: AdFunnelStage[];
};
// Reconciled from prod signups + Stripe (ad_campaign_reconciliation table), served by
// the get_ad_campaign_funnel RPC. Replaces the old tag-based ghl-ad-funnel edge function.
export async function fetchAdFunnel(): Promise<AdFunnel> {
  const { data, error } = await osClient.rpc("get_ad_campaign_funnel");
  if (error) throw error;
  if (!data) throw new Error("No funnel data");
  return data as AdFunnel;
}

export type SetterSummary = {
  active: number; connected: number; idle: number; disconnected: number; archived: number;
  added_this_month: number; added_ytd: number; bonus_eligible: number; pending: number; paused: number;
};

export const RECRUITERS = ["Jade Vieira", "Former Recruiter", "Unattributed"] as const;

export type RecruiterRow = {
  recruiter: string; eligible_setters: number; eligible_paid: number; eligible_due: number;
  pending_setters: number; paused_setters: number; total_setters: number;
  earned: number; paid: number; outstanding: number;
};
export type RecruiterSummary = { bonus_per_setter: number; next_payout: string; recruiters: RecruiterRow[] };

export async function fetchRecruiterSummary(): Promise<RecruiterSummary> {
  const { data, error } = await osClient.rpc("get_recruiter_summary");
  if (error) throw error;
  return data as RecruiterSummary;
}
export async function setSetterRecruiter(accountId: string, recruiter: string) {
  const { error } = await osClient.rpc("set_setter_recruiter", { p_account_id: accountId, p_recruiter: recruiter });
  if (error) throw error;
}
export async function markSetterBonus(accountId: string, paid: boolean) {
  const { error } = await osClient.rpc("mark_setter_bonus", { p_account_id: accountId, p_paid: paid });
  if (error) throw error;
}
export async function markRecruiterDuePaid(recruiter: string) {
  const { error } = await osClient.rpc("mark_recruiter_due_paid", { p_recruiter: recruiter });
  if (error) throw error;
}
export async function fetchSetterSummary(): Promise<SetterSummary> {
  const { data, error } = await osClient.rpc("get_setter_summary");
  if (error) throw error;
  return data as SetterSummary;
}
export async function fetchMonthlyMetrics(): Promise<MonthlyRow[]> {
  const { data, error } = await osClient.rpc("get_monthly_metrics");
  if (error) throw error;
  return (data ?? []) as MonthlyRow[];
}

// Re-pulls external sources (Stripe/Fathom/Calendly) if their keys are set as function
// secrets, then callers re-query the RPCs. Best-effort: never throws.
export async function refreshAll() {
  try { await osClient.functions.invoke("refresh-all", { body: {} }); } catch { /* still re-query */ }
}

// Main-dashboard refresh: the business data. Customer locations/geocoding are excluded
// (they're heavy + vanity) — those run from the Customers-map refresh instead.
export const REFRESH_STEPS = [
  { step: "stripe-payments", label: "Stripe payments" },
  { step: "stripe-subs", label: "Subscriptions" },
  { step: "fathom", label: "Fathom recordings" },
  { step: "calendly", label: "Calendly bookings" },
  { step: "unipile", label: "LinkedIn accounts" },
  { step: "prod", label: "Account connections" },
  { step: "ledger", label: "Sales ledger" },
] as const;
// Customer-map refresh: locations + geocoding only.
export const MAP_REFRESH_STEPS = [
  { step: "stripe-geo", label: "Customer locations" },
  { step: "geocode", label: "Geocoding" },
] as const;

async function runSteps(steps: readonly { step: string; label: string }[], onProgress?: (done: number, total: number, label: string) => void) {
  const total = steps.length;
  const failed: string[] = [];
  for (let i = 0; i < total; i++) {
    onProgress?.(i, total, steps[i].label);
    const { error } = await osClient.functions.invoke("refresh-all", { body: { step: steps[i].step } }).catch((e) => ({ error: e as Error }));
    if (error) failed.push(steps[i].label);
  }
  onProgress?.(total, total, "Done");
  // Surface failures so the UI can confirm success only when the sync truly completed.
  if (failed.length) throw new Error(`Couldn't sync: ${failed.join(", ")}`);
}
export const refreshStepped = (onProgress: (done: number, total: number, label: string) => void) => runSteps(REFRESH_STEPS, onProgress);
export const refreshMap = (onProgress?: (done: number, total: number, label: string) => void) => runSteps(MAP_REFRESH_STEPS, onProgress);

// Agency Partners refresh: the data that page shows — subscriptions (MRR/plan),
// payments (LTV) and the prod account/campaign stats (seats · campaigns live).
export const AGENCY_REFRESH_STEPS = [
  { step: "stripe-subs", label: "Subscriptions" },
  { step: "stripe-payments", label: "Payments" },
  { step: "prod", label: "Account & campaign stats" },
] as const;
export const refreshAgencies = (onProgress?: (done: number, total: number, label: string) => void) => runSteps(AGENCY_REFRESH_STEPS, onProgress);

// Fathom-only refresh: pulls the latest call recordings and nothing else. Used by the
// Therapon Daily Call Log so attendance/trials can be pulled on demand between the
// 15-min cron syncs. Best-effort: throws on failure so the caller can surface it.
export async function refreshFathom() {
  const { error } = await osClient.functions.invoke("refresh-all", { body: { step: "fathom" } });
  if (error) throw error;
}

export type SalesLedgerRow = {
  customer_id: string;
  name: string | null;
  email: string | null;
  stripe_email: string | null;
  status: string | null;
  plan: string | null;
  total_paid: number;
  payments: number;
  first_paid: string | null;
  last_paid: string | null;
  signup_at: string | null;
  in_subscriptions: boolean;
  fathom_url: string | null;
  first_call: string | null;
  source: string | null;
  closer: string | null;
  is_manual: boolean;
  bucket: "attributed" | "unattributed";
};

export const CLOSERS = ["Therapon Savvas", "Jamal Robinson"] as const;
export const SOURCES = [
  { key: "linkedin_outreach", label: "LinkedIn Outreach" },
  { key: "email_marketing", label: "Email Marketing" },
  { key: "organic", label: "Organic Content" },
  { key: "paid_ads", label: "Paid Ads" },
] as const;

export async function fetchSalesLedger(): Promise<SalesLedgerRow[]> {
  const { data, error } = await osClient.rpc("get_sales_ledger");
  if (error) throw error;
  return (data ?? []) as SalesLedgerRow[];
}

export async function setSaleCloser(customerId: string, closer: string | null) {
  const { error } = await osClient.rpc("set_sale_closer", { p_customer_id: customerId, p_closer: closer });
  if (error) throw error;
}
export async function setSaleAttribution(customerId: string, source: string | null, closer: string | null) {
  const { error } = await osClient.rpc("set_sale_attribution", { p_customer_id: customerId, p_source: source, p_closer: closer });
  if (error) throw error;
}
export async function excludeSale(customerId: string) {
  const { error } = await osClient.rpc("exclude_sale", { p_customer_id: customerId });
  if (error) throw error;
}
export async function clearSaleOverride(customerId: string) {
  const { error } = await osClient.rpc("clear_sale_override", { p_customer_id: customerId });
  if (error) throw error;
}

export type CommissionRep = {
  rep: string; revenue: number; earned: number; paid: number; outstanding: number;
  payments: number; payments_paid: number; payments_due: number; commissioned: boolean;
};
export type CommissionSummary = {
  commission_rate: number;
  next_payout: string;
  reps: CommissionRep[];
};

export async function fetchCommissionSummary(): Promise<CommissionSummary> {
  const { data, error } = await osClient.rpc("get_commission_summary");
  if (error) throw error;
  return data as CommissionSummary;
}
// Mark the sales commission on a single payment as paid / unpaid.
export async function markCommissionPaid(paymentId: string, paid: boolean) {
  const { error } = await osClient.rpc("mark_commission_paid", { p_payment_id: paymentId, p_paid: paid });
  if (error) throw error;
}
// Mark every outstanding payment's commission for a closer as paid (payout day).
export async function markCloserCommissionPaid(closer: string) {
  const { error } = await osClient.rpc("mark_closer_commission_paid", { p_closer: closer });
  if (error) throw error;
}

// ---- Search Catalog (Sales Nav search library, under Appointment Setters) ----
export type CatalogSearch = {
  id: number;
  search_name: string;
  vertical: string | null;
  sales_nav_url: string;
  source_label: string | null;
  descriptor: string | null;
  regions: string[];
  headcounts: string[];
  titles: string[];
  years_company: string[];
  profile_language: string[];
  keywords: string | null;
  pool_size: number | null;
  status: string;
  assigned_account_id: string | null;
  assigned_setter: string | null;
  campaign_name: string | null;
  requests_sent: number | null;
  connections: number | null;
  reply_count: number | null;
  connection_rate: number | null;
  launched_at: string | null;
  cooldown_until: string | null;
  resolved_at: string | null;
  notes: string | null;
  days_live: number | null;
};
export type UnmatchedCampaign = {
  setter: string | null; campaign_name: string | null; reason: "no_link" | "not_in_catalog";
  source_name: string | null; descriptor: string | null; keywords: string | null; requests_sent: number | null;
};
export type SearchCatalog = {
  searches: CatalogSearch[];
  unmatched: UnmatchedCampaign[];
  summary: {
    total: number; available: number; active: number; cooling: number;
    retired: number; resolved: number; verticals: string[];
    unmatched_total: number; unmatched_no_link: number; unmatched_not_in_catalog: number;
  };
};
export async function fetchSearchCatalog(): Promise<SearchCatalog> {
  const { data, error } = await osClient.rpc("get_search_catalog");
  if (error) throw error;
  return data as SearchCatalog;
}
// Bulk upsert parsed searches (from the paste-CSV importer). Rows come from parseSearchCsv().
export async function upsertSearchCatalog(rows: unknown[]): Promise<{ upserted: number }> {
  const { data, error } = await osClient.rpc("upsert_search_catalog", { p_rows: rows });
  if (error) throw error;
  return data as { upserted: number };
}

// Bulk-match live workspace campaigns to catalog searches (decoded filter signature),
// stamping status + setter + campaign progress. Runs on demand via the "Refresh matches" button.
export async function refreshSearchMatches(incremental = false): Promise<{ ok: boolean; live_campaigns: number; matched: number; unmatched: number; skipped_existing: number }> {
  const { data, error } = await osClient.functions.invoke("match-searches", { body: { incremental } });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || "match failed");
  return data as { ok: boolean; live_campaigns: number; matched: number; unmatched: number; skipped_existing: number };
}

// ---- Access control & User Management (admin) ----
export type MyAccess = { email: string | null; role: "admin" | "user"; allowed_pages: string[] };
export async function fetchMyAccess(): Promise<MyAccess> {
  const { data, error } = await osClient.rpc("get_my_access");
  if (error) throw error;
  return data as MyAccess;
}

export type ManagedUser = {
  user_id: string; email: string; role: "admin" | "user";
  allowed_pages: string[]; created_at: string; last_sign_in_at: string | null;
};
async function adminUsers<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await osClient.functions.invoke("admin-users", { body: payload });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || "request failed");
  return data as T;
}
export async function listUsers(): Promise<ManagedUser[]> {
  const d = await adminUsers<{ users: ManagedUser[] }>({ action: "list" });
  return d.users;
}
export async function createUser(email: string, password: string, role: "admin" | "user", allowed_pages: string[]): Promise<void> {
  await adminUsers({ action: "create", email, password, role, allowed_pages });
}
export async function updateUser(user_id: string, patch: { role?: "admin" | "user"; allowed_pages?: string[] }): Promise<void> {
  await adminUsers({ action: "update", user_id, ...patch });
}
export async function setUserPassword(user_id: string, password: string): Promise<void> {
  await adminUsers({ action: "set_password", user_id, password });
}
export async function deleteUser(user_id: string): Promise<void> {
  await adminUsers({ action: "delete", user_id });
}

// ---- Setter Profile (interlinked hub) ----
export type SetterProfile = {
  account_id: string; name: string; recruiter: string | null;
  status: string | null; state: string | null; in_active_campaign: boolean;
  is_archived: boolean; days_active: number | null; added_at: string | null;
  requests_sent: number | null; eligibility: string | null; bonus_paid: boolean; bookings: number;
  search: null | {
    search_name: string; descriptor: string | null; regions: string[]; headcounts: string[];
    years_company: string[]; keywords: string | null; sales_nav_url: string; campaign_name: string | null;
    launched_at: string | null; connections: number | null; reply_count: number | null;
    connection_rate: number | null; days_live: number | null;
  };
};
export async function fetchSetterProfile(accountId: string): Promise<SetterProfile | null> {
  const { data, error } = await osClient.rpc("get_setter_profile", { p_account_id: accountId });
  if (error) throw error;
  return (data as SetterProfile) ?? null;
}

// ---- Deploy cockpit (allocation) ----
export type IdleSetter = { account_id: string; name: string; recruiter: string | null; days_active: number | null; state: string | null; status: string | null; requests_sent: number | null; bucket: "idle" | "disconnected" };
export type AvailableSearch = { search_name: string; vertical: string | null; descriptor: string | null; source_label: string | null; regions: string[]; headcounts: string[]; years_company: string[]; sales_nav_url: string; pool_size: number | null; cooling: boolean };
export type Allocation = {
  idle_setters: IdleSetter[];
  available_searches: AvailableSearch[];
  summary: { idle_count: number; disconnected_count: number; available_count: number; verticals: string[] };
};
export async function fetchAllocation(): Promise<Allocation> {
  const { data, error } = await osClient.rpc("get_allocation");
  if (error) throw error;
  return data as Allocation;
}

// ---- Needs Attention (campaign health alerts) ----
export type CampaignAlerts = {
  under_volume: { search_name: string; assigned_setter: string | null; assigned_account_id: string | null; requests_sent: number; days_live: number; reqs_per_day: number }[];
  disconnected_holding: { search_name: string; assigned_setter: string | null; assigned_account_id: string | null; requests_sent: number | null }[];
  duplicates: { sig: string; searches: { search_name: string; setter: string | null; account_id: string | null }[] }[];
  exhausting: { search_name: string; assigned_setter: string | null; requests_sent: number; pool_size: number; pct: number }[];
  cooldown_soon: { search_name: string; cooldown_until: string | null }[];
  median_reqs_per_day: number | null;
  summary: { under_volume: number; disconnected_holding: number; duplicates: number; exhausting: number; cooldown_soon: number };
};
export async function fetchCampaignAlerts(): Promise<CampaignAlerts> {
  const { data, error } = await osClient.rpc("get_campaign_alerts");
  if (error) throw error;
  return data as CampaignAlerts;
}

// ---- Account Rentals ($150/mo from client, $50/mo to the setter who lends the account) ----
export type Rental = {
  id: number; setter_name: string; setter_email: string | null;
  account_id: string | null; account_status: string | null; client: string | null;
  placement_date: string | null; first_due_date: string | null; agreement_signed: boolean;
  status: "active" | "cancelled"; cancelled_at: string | null; cancel_reason: string | null;
  client_rate: number; setter_rate: number; notes: string | null;
  ws_added_on: string | null; requests_sent: number | null;
  days_since_placement: number | null; days_in_workspace: number | null;
  client_id: number | null;
  client_overdue: number; setter_owed: number; next_due: string | null;
  cycles: RentalPayment[];
  matched: boolean; matchable: boolean; account_dead: boolean;
};
export type RentalClient = {
  client: string; active: number; cancelled: number; mrr: number; margin: number;
  client_overdue: number; setter_owed: number; owed_by_client: number; owed_to_setters: number;
  unsigned: number; accounts_dead: number; next_due: string | null;
};
export type ManagedClient = { id: number; name: string; email: string | null; workspace_linked: boolean; rentals: number };
export type RentalsData = {
  rentals: Rental[];
  clients: RentalClient[];
  all_clients: ManagedClient[];
  summary: {
    active: number; cancelled: number; mrr_client: number; cost_setter: number; margin: number;
    unsigned: number; accounts_dead: number; unmatched: number;
    client_overdue: number; setter_owed: number; owed_by_clients_cash: number; owed_to_setters_cash: number;
  };
};
export type RentalPayment = {
  id: number; cycle_no: number; due_date: string; date_overridden?: boolean;
  client_paid: boolean; client_paid_at: string | null;
  setter_paid: boolean; setter_paid_at: string | null; overdue: boolean;
};
export async function fetchAccountRentals(): Promise<RentalsData> {
  const { data, error } = await osClient.rpc("get_account_rentals");
  if (error) throw error;
  return data as RentalsData;
}

// A rental setter's details pulled from the careers project (via the
// careers-setter-lookup bridge function).
export type CareersSetter = {
  full_name?: string | null; email?: string | null; phone?: string | null; country?: string | null;
  stage?: string | null; linkedin_url?: string | null;
  payment_method?: string | null; paypal_email?: string | null; bank_details?: string | null;
};
export async function lookupCareersSetter(email: string | null, name: string | null): Promise<CareersSetter | null> {
  const { data, error } = await osClient.functions.invoke("careers-setter-lookup", { body: { email, name } });
  if (error) throw error;
  const setter = (data as { setter?: CareersSetter } | null)?.setter;
  return setter && Object.keys(setter).length > 0 ? setter : null;
}
export async function fetchRentalPayments(rentalId: number): Promise<RentalPayment[]> {
  const { data, error } = await osClient.rpc("get_rental_payments", { p_rental_id: rentalId });
  if (error) throw error;
  return (data as RentalPayment[]) ?? [];
}
export async function setRentalPayment(id: number, which: "client" | "setter", paid: boolean): Promise<void> {
  const { error } = await osClient.rpc("set_rental_payment", { p_id: id, p_which: which, p_paid: paid });
  if (error) throw error;
}
export async function setRental(id: number, patch: { agreement?: boolean; status?: string; cancel_reason?: string; notes?: string }): Promise<void> {
  const { error } = await osClient.rpc("set_rental", {
    p_id: id, p_agreement: patch.agreement ?? null, p_status: patch.status ?? null,
    p_cancel_reason: patch.cancel_reason ?? null, p_notes: patch.notes ?? null,
  });
  if (error) throw error;
}
export async function importAccountRentals(rows: unknown[]): Promise<{ imported: number; rentals: number; cycles: number }> {
  const { data, error } = await osClient.rpc("import_account_rentals", { p_rows: rows });
  if (error) throw error;
  return data as { imported: number; rentals: number; cycles: number };
}

// Re-match rentals to live Unipile accounts inside each client's workspace, refreshing
// connection status, requests sent, and the real workspace-join date.
export async function refreshRentalMatches(): Promise<{ ok: boolean; considered: number; matched: number; unmatched: number; unmatched_list: { setter: string; client: string }[] }> {
  const { data, error } = await osClient.functions.invoke("match-rentals", { body: {} });
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || "match failed");
  return data as { ok: boolean; considered: number; matched: number; unmatched: number; unmatched_list: { setter: string; client: string }[] };
}

// ---- Rentals: manual overrides / CRUD ----
export async function upsertRentalClient(id: number | null, name: string, email: string | null): Promise<number> {
  const { data, error } = await osClient.rpc("upsert_rental_client", { p_id: id, p_name: name, p_email: email });
  if (error) throw error;
  return data as number;
}
export async function deleteRentalClient(id: number, force = false): Promise<void> {
  const { error } = await osClient.rpc("delete_rental_client", { p_id: id, p_force: force });
  if (error) throw error;
}
export async function upsertRental(p: {
  id: number | null; setter_name: string; client_id: number | null; setter_email?: string | null;
  placement_date?: string | null; first_due_date?: string | null; client_rate?: number | null;
  setter_rate?: number | null; agreement?: boolean | null; status?: string | null; notes?: string | null;
}): Promise<number> {
  const { data, error } = await osClient.rpc("upsert_rental", {
    p_id: p.id, p_setter_name: p.setter_name, p_client_id: p.client_id, p_setter_email: p.setter_email ?? null,
    p_placement_date: p.placement_date || null, p_first_due_date: p.first_due_date || null,
    p_client_rate: p.client_rate ?? null, p_setter_rate: p.setter_rate ?? null,
    p_agreement: p.agreement ?? null, p_status: p.status ?? null, p_notes: p.notes ?? null,
  });
  if (error) throw error;
  return data as number;
}
export async function deleteRental(id: number): Promise<void> {
  const { error } = await osClient.rpc("delete_rental", { p_id: id });
  if (error) throw error;
}
export async function updateRentalCycle(id: number, dueDate: string): Promise<void> {
  const { error } = await osClient.rpc("update_rental_cycle", { p_id: id, p_due_date: dueDate });
  if (error) throw error;
}
export async function addRentalCycle(rentalId: number, dueDate: string): Promise<void> {
  const { error } = await osClient.rpc("add_rental_cycle", { p_rental_id: rentalId, p_due_date: dueDate });
  if (error) throw error;
}
export async function deleteRentalCycle(id: number): Promise<void> {
  const { error } = await osClient.rpc("delete_rental_cycle", { p_id: id });
  if (error) throw error;
}

// Purge a person from the webinar funnel entirely — every stage, all time, regardless of the
// range on screen. For dummy/test leads. Returns how many events were removed.
export async function deleteWebinarPerson(email: string): Promise<number> {
  const { data, error } = await osClient.rpc("delete_webinar_person", { p_email: email });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ---- Churn exclusions: mark a "churn" as not real (moved account, DFY, etc.) ----
// Treats the customer's subscription as never-ended, so they drop out of every churn count/list.
export type ChurnExclusion = { customer_id: string; reason: string | null; name: string | null; email: string | null };
export async function fetchChurnExclusions(): Promise<ChurnExclusion[]> {
  const { data, error } = await osClient.rpc("get_churn_exclusions");
  if (error) throw error;
  return (data as ChurnExclusion[]) ?? [];
}
export async function setChurnExclusion(customerId: string, reason: string | null): Promise<void> {
  const { error } = await osClient.rpc("set_churn_exclusion", { p_customer_id: customerId, p_reason: reason, p_by: null });
  if (error) throw error;
}
export async function removeChurnExclusion(customerId: string): Promise<void> {
  const { error } = await osClient.rpc("remove_churn_exclusion", { p_customer_id: customerId });
  if (error) throw error;
}
