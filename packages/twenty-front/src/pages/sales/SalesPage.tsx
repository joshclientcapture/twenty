import "@/custom-pages/os/os.css";
import { useEffect, useState } from "react";
import { fetchDashboardMetrics, fetchShowUp, fetchAttributionSplit, fetchConversion, fetchRangeMetrics, fetchGrowth, fetchMonthlyMetrics, fetchLastSync, fetchCustomerCounts, refreshStepped, REFRESH_STEPS, type DashboardMetrics, type ShowUp, type AttributionSplit, type Conversion, type RangeMetrics, type Growth, type MonthlyRow, type CustomerCounts } from "@/custom-pages/os/data";
import { Chart } from "@/custom-pages/os/Chart";

// --- date helpers for the custom range picker ---
const isoDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
function rangePreset(kind: string): { from: string; to: string } {
  const today = new Date();
  const dow = (today.getDay() + 6) % 7; // 0 = Monday
  if (kind === "this-week") return { from: isoDate(addDays(today, -dow)), to: isoDate(today) };
  if (kind === "last-week") return { from: isoDate(addDays(today, -dow - 7)), to: isoDate(addDays(today, -dow - 1)) };
  if (kind === "last-7") return { from: isoDate(addDays(today, -6)), to: isoDate(today) };
  if (kind === "last-30") return { from: isoDate(addDays(today, -29)), to: isoDate(today) };
  return { from: isoDate(addDays(today, -6)), to: isoDate(today) };
}
const fmtRange = (from: string, to: string) => {
  const f = new Date(from + "T00:00:00"), t = new Date(to + "T00:00:00");
  const o: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return from === to ? f.toLocaleDateString("en-GB", { ...o, year: "numeric" }) : `${f.toLocaleDateString("en-GB", o)} – ${t.toLocaleDateString("en-GB", { ...o, year: "numeric" })}`;
};


/* ------------------------------------------------------------------ */
/*  Line chart: signups vs sales traced to Therapon (monthly)          */
/* ------------------------------------------------------------------ */
function buildPath(values: number[], max: number, width: number, height: number, pad: number) {
  const stepX = (width - pad * 2) / Math.max(values.length - 1, 1);
  return values
    .map((v, i) => {
      const x = pad + stepX * i;
      const y = height - pad - (v / max) * (height - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function TrendChart({ data }: { data: DashboardMetrics["signups_monthly"] }) {
  const W = 1200, H = 480, P = 40;
  const signups = data.map((d) => d.signups);
  const sales = data.map((d) => d.sales);
  const months = data.map((d) => d.month);
  const max = Math.max(...signups, ...sales, 1) * 1.15;
  const gridVals = [max, max * 0.75, max * 0.5, max * 0.25, 0].map((v) => Math.round(v));
  const sigPath = buildPath(signups, max, W, H, P);
  const salPath = buildPath(sales, max, W, H, P);
  const areaPath = `${sigPath} L${W - P},${H - P} L${P},${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sigFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.16" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => {
        const y = P + ((H - P * 2) / 4) * i;
        return <line key={i} x1={P} x2={W - P} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.06" strokeDasharray="2 4" />;
      })}
      {gridVals.map((label, i) => {
        const y = P + ((H - P * 2) / 4) * i + 4;
        return (
          <text key={i} x={P - 10} y={y} textAnchor="end" className="fill-slate-400" fontSize="11" fontFamily="JetBrains Mono, monospace">
            {label}
          </text>
        );
      })}
      {months.map((m, i) => {
        const stepX = (W - P * 2) / Math.max(months.length - 1, 1);
        const x = P + stepX * i;
        return (
          <text key={m} x={x} y={H - P + 20} textAnchor="middle" className="fill-slate-400" fontSize="11" fontFamily="JetBrains Mono, monospace">
            {m.toUpperCase()}
          </text>
        );
      })}
      <path d={areaPath} fill="url(#sigFill)" />
      <path d={salPath} fill="none" stroke="rgb(148 163 184)" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={sigPath} fill="none" stroke="var(--color-primary)" strokeWidth="2.25" />
      {signups.map((v, i) => {
        const stepX = (W - P * 2) / Math.max(signups.length - 1, 1);
        const x = P + stepX * i;
        const y = H - P - (v / max) * (H - P * 2);
        return <circle key={i} cx={x} cy={y} r="3" fill="var(--color-primary)" />;
      })}
    </svg>
  );
}

function LinkedInTrend({ data }: { data: DashboardMetrics["linkedin_monthly"] }) {
  const W = 360, H = 90, P = 6;
  const vals = data.map((d) => d.cumulative);
  const max = Math.max(...vals, 1);
  const stepX = (W - P * 2) / Math.max(vals.length - 1, 1);
  const pts = vals.map((v, i) => [P + stepX * i, H - P - (v / max) * (H - P * 2)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${W - P},${H - P} L${P},${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="liFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#liFill)" />
      <path d={line} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill="var(--color-primary)" />)}
    </svg>
  );
}

function Card({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface shadow-sm ring-1 ring-[var(--color-surface-ring)] ${className}`}>{children}</div>;
}

const fmtUsd = (n: number) => "$" + Math.round(n).toLocaleString();
const fmtWhen = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

type Kpi = { label: string; value: string; delta: string; tone: "positive" | "caution"; to?: string };
function KpiTile({ kpi }: { kpi: Kpi }) {
  const inner = (
    <Card className={`flex h-full flex-col p-3.5 ${kpi.to ? "cursor-pointer transition-all hover:ring-primary" : ""}`}>
      <p className="mb-2 flex items-start gap-0.5 font-mono text-[9px] uppercase leading-tight tracking-wide text-muted-foreground">
        <span>{kpi.label}</span>
        {kpi.to && <span aria-hidden>→</span>}
      </p>
      <div className="mt-auto flex flex-col gap-0.5">
        <span className="text-2xl font-bold leading-none tracking-tight tabular-nums">{kpi.value}</span>
        <span className={`font-mono text-[9px] leading-tight ${kpi.tone === "positive" ? "text-[var(--color-positive)]" : "text-[var(--color-caution)]"}`}>{kpi.delta}</span>
      </div>
    </Card>
  );
  return kpi.to ? <a href={kpi.to} className="block h-full">{inner}</a> : inner;
}

/* ------------------------------------------------------------------ */
function OperatingSystem() {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  const [showUp, setShowUp] = useState<ShowUp | null>(null);
  const [split, setSplit] = useState<AttributionSplit | null>(null);
  const [conv, setConv] = useState<Conversion | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7)); // default: current month
  const [range, setRange] = useState<{ from: string; to: string } | null>(null); // custom date range (overrides period)
  const [rangeM, setRangeM] = useState<RangeMetrics | null>(null);
  const [counts, setCounts] = useState<CustomerCounts | null>(null); // new/churned customers for the active period
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; at: Date; msg?: string } | null>(null);

  const load = async () => {
    try { setM(await fetchDashboardMetrics()); setErr(null); } catch (e: any) { setErr(String(e?.message ?? e)); }
    try { setShowUp(await fetchShowUp()); } catch { /* noop */ }
    try { setSplit(await fetchAttributionSplit()); } catch { /* noop */ }
    try { setConv(await fetchConversion()); } catch { /* noop */ }
    try { setGrowth(await fetchGrowth()); } catch { /* noop */ }
    try { setMonthly(await fetchMonthlyMetrics()); } catch { /* noop */ }
    try { setLastSync(await fetchLastSync()); } catch { /* noop */ }
  };
  useEffect(() => { load(); }, []);

  // If the current month isn't in the data yet, fall back to the most recent month with data.
  useEffect(() => {
    if (monthly.length && period !== "all" && !monthly.some((r) => r.month_key === period)) {
      setPeriod([...monthly].sort((a, b) => b.month_key.localeCompare(a.month_key))[0].month_key);
    }
  }, [monthly, period]);

  // Load range metrics whenever a custom range is set (and on refresh).
  useEffect(() => {
    if (range?.from && range?.to) fetchRangeMetrics(range.from, range.to).then(setRangeM).catch(() => setRangeM(null));
    else setRangeM(null);
  }, [range]);

  // New/churned customer counts for whichever period is active (range > month > all-time).
  useEffect(() => {
    const mth = range ? null : period !== "all" ? period : null;
    fetchCustomerCounts(mth, range?.from ?? null, range?.to ?? null).then(setCounts).catch(() => setCounts(null));
  }, [range, period]);

  const refresh = async () => {
    setRefreshing(true);
    setSyncStatus(null);
    setProgress({ done: 0, total: REFRESH_STEPS.length, label: "Starting…" });
    let syncErr: string | null = null;
    try {
      await refreshStepped((done, total, label) => setProgress({ done, total, label }));
    } catch (e) { syncErr = (e as Error).message; }
    // Always re-query so the page reflects whatever did sync, then confirm the outcome.
    try {
      await load();
      if (range?.from && range?.to) setRangeM(await fetchRangeMetrics(range.from, range.to).catch(() => null));
    } catch { /* best-effort reload */ }
    setRefreshing(false);
    setProgress(null);
    setSyncStatus(syncErr ? { ok: false, at: new Date(), msg: syncErr } : { ok: true, at: new Date() });
  };

  const mo = !range && period !== "all" ? monthly.find((r) => r.month_key === period) : null;

  const cancelRate = m ? ((m.kpis.appts_canceled / Math.max(m.kpis.appts_booked, 1)) * 100).toFixed(1) : "—";
  const heldRate = m ? Math.round((m.kpis.appts_held / Math.max(m.kpis.appts_booked, 1)) * 100) : 0;
  // Show-up rate: of appointments that have occurred, how many were actually recorded in
  // Fathom (matched booking→recording by scheduled time). Fathom records everyone who
  // shows, so a matched recording = a real attendance. Per-month figures come with it.
  const rq = range ? `&from=${range.from}&to=${range.to}` : "";
  // Company-wide totals (the homepage is the whole business; Therapon's own numbers live on /therapon)
  const liTile: Kpi = { label: "Active LinkedIn Accounts Doing Outreach", value: String(m?.linkedin.active ?? 0), delta: `${m?.linkedin.total ?? 0} CONNECTED`, tone: "positive", to: "/setters" };

  const northStar: Kpi[] = m
    ? [
        { label: "Trials Started", value: (split?.trials.total ?? m.trials_started ?? 0).toLocaleString(), delta: "ALL TRIALS", tone: "positive", to: "/records?type=trials" },
        { label: "New Customers", value: String(counts?.new ?? split?.sales.total ?? 0), delta: "PAYING · TOTAL", tone: "positive", to: "/records?type=new_customers" },
        { label: "Churned Customers", value: String(counts?.churned ?? 0), delta: "LIFETIME", tone: "caution", to: "/records?type=churned_customers" },
        { label: "Cash Collected", value: fmtUsd(m.revenue?.total_collected ?? 0), delta: "LIFETIME", tone: "positive", to: "/customers?b=all" },
        { label: "Paid Subscribers", value: String(growth?.current_subscribers ?? 0), delta: "ACTIVE", tone: "positive", to: "/customers?b=all" },
        liTile,
      ]
    : [];

  const rangeKpis: Kpi[] = range && rangeM
    ? [
        { label: "Trials Started", value: String(rangeM.trials_total), delta: "IN RANGE", tone: "positive", to: `/records?type=trials${rq}` },
        { label: "New Customers", value: String(counts?.new ?? rangeM.sales_total), delta: "IN RANGE", tone: "positive", to: `/records?type=new_customers${rq}` },
        { label: "Churned Customers", value: String(counts?.churned ?? 0), delta: "IN RANGE", tone: "caution", to: `/records?type=churned_customers${rq}` },
        { label: "Cash Collected", value: fmtUsd(rangeM.cash_collected), delta: "IN RANGE", tone: "positive", to: "/customers?b=all" },
        { label: "Paid Subscribers", value: String(growth?.current_subscribers ?? 0), delta: "CURRENT", tone: "positive", to: "/customers?b=all" },
        liTile,
      ]
    : [];

  const kpis: Kpi[] = range && rangeM
    ? rangeKpis
    : mo
    ? [
        { label: "Trials Started", value: String(split?.trials.monthly[mo.month_key]?.total ?? mo.trials ?? 0), delta: mo.month.replace(" 2026", ""), tone: "positive", to: `/records?type=trials&month=${mo.month_key}` },
        { label: "New Customers", value: String(counts?.new ?? split?.sales.monthly[mo.month_key]?.total ?? mo.new_sales ?? 0), delta: mo.month.replace(" 2026", ""), tone: "positive", to: `/records?type=new_customers&month=${mo.month_key}` },
        { label: "Churned Customers", value: String(counts?.churned ?? 0), delta: mo.month.replace(" 2026", ""), tone: "caution", to: `/records?type=churned_customers&month=${mo.month_key}` },
        { label: "Cash Collected", value: fmtUsd(mo.cash_collected), delta: mo.month.replace(" 2026", ""), tone: "positive", to: "/customers?b=all" },
        { label: "Paid Subscribers", value: String(growth?.current_subscribers ?? 0), delta: "CURRENT", tone: "positive", to: "/customers?b=all" },
        liTile,
      ]
    : northStar;

  // Funnel uses the SAME numbers as the Show-up and Therapon pages so nothing can diverge.
  // Held = didn't cancel & time passed (includes no-shows); Sat = actually attended (Fathom-confirmed);
  // Trials = trials from those who attended; Sale = appointment-sourced sales.
  const fHeld = showUp?.held ?? 0;
  const fAttended = showUp?.recorded ?? 0;
  const fTrials = conv?.total.sat_trials ?? 0;
  const fSales = split?.sales.therapon ?? 0;
  const funnel = m
    ? [
        { stage: "Appointments Booked", value: m.kpis.appts_booked, pct: 100 },
        { stage: "Appointments Held", value: fHeld, pct: Math.round((fHeld / m.kpis.appts_booked) * 100) },
        { stage: "Appointments Sat", value: fAttended, pct: Math.round((fAttended / m.kpis.appts_booked) * 100) },
        { stage: "Started a Trial", value: fTrials, pct: Math.round((fTrials / m.kpis.appts_booked) * 100) },
        { stage: "Became a Sale", value: fSales, pct: Math.round((fSales / m.kpis.appts_booked) * 100) },
      ]
    : [];

  // Organic (no-appointment) path: everyone we have NO booked call for. Uses the same attribution
  // split as above, so appointment + organic sums to the totals (trials 390, customers 189).
  const orgTrials = split ? split.trials.total - split.trials.therapon : 0;
  const orgSales = split ? split.sales.total - split.sales.therapon : 0;
  const orgRate = orgTrials ? Math.round((orgSales / orgTrials) * 100) : 0;
  const organic = split
    ? [
        { stage: "Started a Trial (no appointment)", value: orgTrials, pct: 100, note: null as string | null },
        { stage: "Became a Sale", value: orgSales, pct: orgRate, note: `${orgRate}% convert` },
      ]
    : [];

  const outcomes = m
    ? [
        { label: "Held Rate", value: `${heldRate}%`, width: heldRate, color: "bg-[var(--color-positive)]" },
        { label: "Held (date passed)", value: String(m.kpis.appts_held), width: Math.round((m.kpis.appts_held / m.kpis.appts_booked) * 100), color: "bg-primary" },
        { label: "Upcoming", value: String(m.kpis.appts_upcoming), width: Math.round((m.kpis.appts_upcoming / m.kpis.appts_booked) * 100), color: "bg-slate-400" },
        { label: "Canceled", value: `${m.kpis.appts_canceled} · ${cancelRate}%`, width: Math.round((m.kpis.appts_canceled / m.kpis.appts_booked) * 100), color: "bg-[var(--color-caution)]" },
      ]
    : [];

  return (
    <div className="min-h-full os-scope bg-background p-4 text-foreground selection:bg-primary/10 sm:p-6 lg:p-10">

      <header className="mx-auto mb-5 flex max-w-7xl flex-wrap items-center justify-between gap-y-2 border-b pb-3">
        <div className="flex items-center gap-3">
          <div className="size-2.5 rounded-full bg-primary" />
          <h1 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Conversifi · Central Brain</h1>
        </div>
        <div className="flex items-center gap-4">
          {refreshing && progress ? (
            <div className="w-56">
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span className="truncate">{progress.label}</span>
                <span className="tabular-nums">{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface ring-1 ring-[var(--color-surface-ring)]">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {syncStatus && (
                <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-wider ring-1 ${syncStatus.ok ? "text-[var(--color-positive)] bg-[var(--color-positive)]/10 ring-[var(--color-positive)]/20" : "text-[var(--color-caution)] bg-[var(--color-caution)]/10 ring-[var(--color-caution)]/20"}`}
                  title={syncStatus.msg}>
                  <span aria-hidden>{syncStatus.ok ? "✓" : "✕"}</span>
                  <span>{syncStatus.ok ? `Refreshed ${syncStatus.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "Refresh failed"}</span>
                </div>
              )}
              <div className="text-right">
                <p className="font-mono text-[9px] uppercase tracking-tighter text-muted-foreground">Last sync</p>
                <p className="font-mono text-xs font-medium tabular-nums">{lastSync ? fmtWhen(lastSync) : "syncing…"}</p>
              </div>
            </div>
          )}
          <button onClick={refresh} disabled={refreshing}
            className="rounded-lg bg-foreground px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-[var(--color-primary-foreground)] transition-colors hover:bg-primary disabled:opacity-50">
            {refreshing ? "Syncing…" : "↻ Refresh"}
          </button>
        </div>
      </header>

      {err && (
        <div className="mx-auto mb-6 max-w-7xl rounded-lg bg-[var(--color-caution)]/10 p-4 font-mono text-xs text-[var(--color-caution)]">
          Could not load metrics: {err}
        </div>
      )}

      <main className="mx-auto grid max-w-7xl grid-cols-12 gap-4">
        {/* Business health — ARR + paid subscribers (the two headline metrics) */}
        <section className="col-span-12 mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Annual Run Rate</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-bold leading-tight tabular-nums">{growth ? "$" + Math.round(growth.current_arr).toLocaleString() : "—"}</p>
                  <span className="font-mono text-[9px] text-muted-foreground">{growth ? `$${Math.round(growth.current_mrr).toLocaleString()} MRR` : ""}</span>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Goal $1M · <span className="font-semibold text-primary">{growth ? `${Math.round((growth.current_arr / growth.arr_goal) * 100)}%` : ""}</span></p>
                {growth && (
                  <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-background ring-1 ring-[var(--color-surface-ring)]">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (growth.current_arr / growth.arr_goal) * 100)}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-1.5">
              <Chart data={(growth?.series ?? []).map((s) => ({ label: s.month.slice(2).replace("-", "/"), value: s.arr, sublabel: s.month }))}
                format={(n) => "$" + Math.round(n).toLocaleString()} height={84} mini zoom />
            </div>
          </Card>

          <Card className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Paid Subscribers</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-bold leading-tight tabular-nums">{growth ? growth.current_subscribers.toLocaleString() : "—"}</p>
                  <span className="font-mono text-[9px] text-muted-foreground">active paid</span>
                </div>
              </div>
              <a href="/churn" className="font-mono text-[9px] uppercase tracking-wider text-primary hover:underline">churn →</a>
            </div>
            <div className="mt-1.5">
              <Chart data={(growth?.series ?? []).map((s) => ({ label: s.month.slice(2).replace("-", "/"), value: s.subscribers, sublabel: s.month }))}
                format={(n) => Math.round(n).toLocaleString()} color="var(--color-positive)" height={84} mini zoom />
            </div>
          </Card>
        </section>

        {/* Period pills */}
        <section className="col-span-12 -mb-1 flex flex-wrap items-center gap-2">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Period</span>
          {[{ key: "all", label: "All Time" }, ...monthly.map((r) => ({ key: r.month_key, label: r.month.replace(" 2026", " ’26") }))].map((p) => (
            <button
              key={p.key}
              onClick={() => { setRange(null); setPeriod(p.key); }}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ring-1 transition-colors ${
                !range && period === p.key
                  ? "bg-primary text-[var(--color-primary-foreground)] ring-primary"
                  : "bg-surface text-muted-foreground ring-[var(--color-surface-ring)] hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </section>

        {/* Custom date range picker */}
        <section className={`col-span-12 flex flex-wrap items-center gap-2 rounded-lg border p-3 transition-colors ${range ? "border-primary/50 bg-primary/5" : "border-[var(--color-surface-ring)] bg-surface"}`}>
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">📅 Custom range</span>
          {[
            { k: "this-week", label: "This Week" },
            { k: "last-week", label: "Last Week" },
            { k: "last-7", label: "Last 7 Days" },
            { k: "last-30", label: "Last 30 Days" },
          ].map((p) => {
            const pr = rangePreset(p.k);
            const active = range?.from === pr.from && range?.to === pr.to;
            return (
              <button key={p.k} onClick={() => setRange(pr)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition-colors ${active ? "bg-primary text-[var(--color-primary-foreground)] ring-primary" : "bg-background text-muted-foreground ring-[var(--color-surface-ring)] hover:text-foreground"}`}>
                {p.label}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-[var(--color-surface-ring)]" />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">From
            <input type="date" value={range?.from ?? ""} max={range?.to || undefined}
              onChange={(e) => { const v = e.target.value; if (v) setRange((r) => ({ from: v, to: r?.to && r.to >= v ? r.to : v })); }}
              className="rounded-lg bg-background px-2 py-1.5 text-xs ring-1 ring-[var(--color-surface-ring)] outline-none focus:ring-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">To
            <input type="date" value={range?.to ?? ""} min={range?.from || undefined}
              onChange={(e) => { const v = e.target.value; if (v) setRange((r) => ({ from: r?.from && r.from <= v ? r.from : v, to: v })); }}
              className="rounded-lg bg-background px-2 py-1.5 text-xs ring-1 ring-[var(--color-surface-ring)] outline-none focus:ring-primary" />
          </label>
          {range && (
            <>
              <span className="rounded-full bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold text-primary">{fmtRange(range.from, range.to)}{rangeM ? "" : " · loading…"}</span>
              <button onClick={() => setRange(null)} className="font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground hover:underline">clear ✕</button>
            </>
          )}
        </section>

        {/* North star */}
        <section className="animate-reveal col-span-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {(m ? kpis : Array.from({ length: 6 })).map((k, i) =>
            m ? <KpiTile key={(k as Kpi).label} kpi={k as Kpi} /> : <Card key={i} className="h-[84px] animate-pulse p-3.5" />
          )}
        </section>

        {/* Funnels: appointment (top) + organic/no-appointment (bottom) */}
        <section className="animate-reveal col-span-12 space-y-4 lg:col-span-6" style={{ animationDelay: "180ms" }}>
          <Card className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Appointment → Sale Funnel</h3>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Booked a call · Since 30 Mar</span>
            </div>
            <div className="space-y-4">
              {funnel.map((r) => {
                // Show-up rate = attended ÷ held (not ÷ booked) — shown in brackets on the Sat row.
                const note = r.stage === "Appointments Sat" && showUp ? `${Math.round(showUp.rate)}% show-up` : null;
                return (
                  <div key={r.stage} className="flex items-center gap-4">
                    <div className="w-52 text-xs text-muted-foreground">
                      {r.stage}
                      {note && <span className="ml-1 font-mono text-[10px] font-medium text-[var(--color-positive)]">({note})</span>}
                    </div>
                    <div className="relative h-6 flex-1 overflow-hidden bg-slate-50">
                      <div className="h-full bg-primary/90" style={{ width: `${r.pct}%` }} />
                    </div>
                    <div className="w-16 text-right font-mono text-xs tabular-nums">{r.value.toLocaleString()}</div>
                    <div className="w-12 text-right font-mono text-[10px] text-muted-foreground">{r.pct}%</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Organic → Sale Funnel</h3>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">No booked call · self-serve</span>
            </div>
            <div className="space-y-4">
              {organic.map((r) => (
                <div key={r.stage} className="flex items-center gap-4">
                  <div className="w-52 text-xs text-muted-foreground">
                    {r.stage}
                    {r.note && <span className="ml-1 font-mono text-[10px] font-medium text-[var(--color-positive)]">({r.note})</span>}
                  </div>
                  <div className="relative h-6 flex-1 overflow-hidden bg-slate-50">
                    <div className="h-full bg-slate-400" style={{ width: `${r.pct}%` }} />
                  </div>
                  <div className="w-16 text-right font-mono text-xs tabular-nums">{r.value.toLocaleString()}</div>
                  <div className="w-12 text-right font-mono text-[10px] text-muted-foreground">{r.pct}%</div>
                </div>
              ))}
            </div>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Signed up with no booked call · {orgRate}% trial→sale vs {fTrials ? Math.round((fSales / fTrials) * 100) : 0}% on the appointment path
            </p>
          </Card>
        </section>

        {/* Monthly performance table */}
        <section className="animate-reveal col-span-12 lg:col-span-6" style={{ animationDelay: "220ms" }}>
          <Card className="h-full p-6">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Month by Month</h3>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">Click a month to filter</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Month</th>
                    {([
                      ["Booked", "New appointments booked"],
                      ["Sat", "Attended — Fathom-confirmed show-ups"],
                      ["Sales", "Successful transactions this month (includes recurring payments)"],
                      ["New", "New paying customers — first-ever payment this month"],
                      ["Cash", "Cash collected this month"],
                    ] as [string, string][]).map(([h, t]) => (
                      <th key={h} title={t} className="pb-2 text-right font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((row) => (
                    <tr key={row.month_key}
                        onClick={() => setPeriod(period === row.month_key ? "all" : row.month_key)}
                        className={`cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50/60 ${period === row.month_key ? "bg-primary/5" : ""}`}>
                      <td className="py-1.5 pr-3 text-muted-foreground">{row.month.replace(" 2026", "")}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums">{row.booked}</td>
                      <td className="py-1.5 text-right tabular-nums text-[var(--color-positive)]">{row.sat}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.transactions}</td>
                      <td className="py-1.5 text-right tabular-nums text-primary">{row.new_customers}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmtUsd(row.cash_collected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* Bottom row */}
        <section className="animate-reveal col-span-12 grid grid-cols-1 gap-6 lg:grid-cols-3" style={{ animationDelay: "260ms" }}>
          <Card className="p-6">
            <h3 className="mb-6 font-mono text-xs uppercase tracking-widest text-muted-foreground">Subscriptions</h3>
            <table className="w-full font-mono text-sm">
              <tbody>
                {m &&
                  ([
                    ["Total Customers", m.subs.total],
                    ["Active", m.subs.active],
                    ["Trialing", m.subs.trialing],
                    ["Ever Paid", m.subs.ever_paid],
                    ["Cancel Rate", `${cancelRate}%`],
                  ] as [string, string | number][]).map(([k, v]) => (
                    <tr key={k} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 text-muted-foreground">{k}</td>
                      <td className="py-2 text-right font-medium tabular-nums">{v}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>

          <Card className="p-6 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Active LinkedIn Accounts Doing Outreach</h3>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">jamal@conversifi.io</span>
            </div>
            <div className="flex items-end gap-6">
              <div>
                <div className="text-4xl font-bold tabular-nums">{m ? m.linkedin.active : "—"}</div>
                <div className="mt-1 font-mono text-[10px] uppercase text-muted-foreground">in active campaign</div>
              </div>
              <div className="flex-1">{m && <LinkedInTrend data={m.linkedin_monthly} />}</div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-4 font-mono text-[10px] uppercase text-muted-foreground">
              <div>In campaign<div className="mt-1 text-sm font-medium tabular-nums text-[var(--color-positive)]">{m?.linkedin.active}</div></div>
              <div>Idle<div className="mt-1 text-sm font-medium tabular-nums text-foreground">{m?.linkedin.idle}</div></div>
              <div>Connected<div className="mt-1 text-sm font-medium tabular-nums text-foreground">{m?.linkedin.total}</div></div>
            </div>
          </Card>

        </section>
      </main>

      <footer className="mx-auto mt-12 flex max-w-7xl items-center justify-between border-t pt-6 opacity-50">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Live · Calendly · Fathom · Stripe · Supabase · Central Brain
        </p>
        <p className="font-mono text-[10px] uppercase text-muted-foreground">
          Company-wide · <span className="text-[var(--color-positive)]">real-time</span>
        </p>
      </footer>
    </div>
  );
}

export const SalesPage = OperatingSystem;
