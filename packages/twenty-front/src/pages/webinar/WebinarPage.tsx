import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconPresentation, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { Chart } from '@/custom-pages/os/Chart';
import { MultiChart } from '@/custom-pages/os/MultiChart';
import {
  ACCENT,
  addDays,
  isoDate,
  PillButton,
  POSITIVE,
  StyledBody,
  StyledCard,
  StyledCardHead,
  StyledCardHint,
  StyledCardTitle,
  StyledChip,
  StyledContent,
  StyledDivider,
  StyledError,
  StyledField,
  StyledFootnote,
  StyledGrid2,
  StyledGrid3,
  StyledGrid5,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledNotice,
  StyledPage,
  StyledReveal,
  StyledRow,
  StyledTile,
} from '@/custom-pages/os/ui';
import { useConfirm } from '@/custom-pages/os/useConfirm';
import {
  deleteWebinarPerson,
  deleteWebinarStageMember,
  fetchWebinarFunnel,
  fetchWebinarStageMembers,
  type WebinarFunnel,
  type WebinarMember,
} from '@/custom-pages/os/data';
import { OsRestricted, useIsOsAdmin } from '@/custom-pages/os/OsRestricted';

type RangeKey = 'today' | '7' | '30' | '90' | 'all' | 'custom';
type Range = { from: string | null; to: string | null };

const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7', label: '7D' },
  { key: '30', label: '30D' },
  { key: '90', label: '90D' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom' },
];
const rangeFor = (key: RangeKey, custom: Range): Range => {
  const today = isoDate(new Date());
  if (key === 'all') return { from: null, to: null };
  if (key === 'today') return { from: today, to: today };
  if (key === 'custom') return custom;
  return { from: isoDate(addDays(new Date(), -(Number(key) - 1))), to: today };
};
const pct = (num: number, den: number) =>
  den > 0 ? Math.round((num / den) * 1000) / 10 : null;
const nf = (n: number | null | undefined) => (n ?? 0).toLocaleString('en-GB');
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString()}`;
const dayLabel = (day: string) =>
  new Date(day + 'T00:00:00').toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
  });
const slotFmt = (s: string) =>
  new Date(s).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const EMPTY: WebinarFunnel = {
  shared: {
    registered: 0,
    entered: 0,
    due: 0,
    showed: 0,
    upcoming: 0,
    rescheduled: 0,
  },
  offer: { reached_offer: 0, offer_click: 0, paid: 0 },
  trial: { trial_click: 0, trial_started: 0, paid: 0 },
  outcomes: {
    trialing_now: 0,
    trial_started: 0,
    paying_any: 0,
    paying_monthly: 0,
    paying_yearly: 0,
    mrr_cents: 0,
  },
  daily: [],
};

// Stages backed by webinar_events rows can have a person removed; the Stripe-derived ones cannot.
const DELETABLE_STAGES = new Set([
  'registered',
  'entered',
  'reached_offer',
  'offer_click',
  'trial_click',
  'offer_paid',
]);

type Stage = {
  key: string;
  title: string;
  hint: string;
  value: number;
  highlight?: boolean;
};

const StyledFunnel = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  button[data-stage] {
    background: none;
    border: 0;
    border-radius: ${t.border.radius.sm};
    color: inherit;
    cursor: pointer;
    display: grid;
    font: inherit;
    gap: 2px ${t.spacing[3]};
    grid-template-columns: minmax(0, 1fr) auto;
    padding: ${t.spacing[2]};
    text-align: left;
    transition-property: background-color, transform;
    transition-duration: 120ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }
  button[data-stage]:hover {
    background: ${t.background.tertiary};
  }
  button[data-stage]:active {
    transform: scale(0.96);
  }
  button[data-stage]:focus-visible {
    outline: 2px solid ${t.color.blue};
    outline-offset: 2px;
  }
  div[data-title] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.medium};
  }
  div[data-hint] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
  div[data-nums] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  div[data-nums] b {
    font-weight: ${t.font.weight.semiBold};
  }
  div[data-nums] span {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    margin-left: ${t.spacing[2]};
  }
  div[data-bar] {
    background: ${t.background.tertiary};
    border-radius: 2px;
    grid-column: 1 / -1;
    height: 4px;
    overflow: hidden;
  }
  div[data-bar] > div {
    height: 100%;
  }
`;

const StyledRates = styled.div`
  display: grid;
  gap: ${t.spacing[2]};
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: ${t.spacing[3]};
  @media (max-width: 720px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  div[data-rate] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.sm};
    padding: ${t.spacing[2]};
  }
  div[data-rate][data-hi] {
    background: color-mix(in srgb, ${POSITIVE} 10%, transparent);
  }
  div[data-k] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
  div[data-v] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.lg};
    font-weight: ${t.font.weight.semiBold};
    font-variant-numeric: tabular-nums;
  }
  div[data-rate][data-hi] div[data-v] {
    color: ${POSITIVE};
  }
`;

const StyledMembers = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 420px;
  overflow: auto;
  div[data-row] {
    align-items: center;
    border-radius: ${t.border.radius.sm};
    display: grid;
    gap: ${t.spacing[3]};
    grid-template-columns: minmax(0, 1fr) auto auto;
    padding: ${t.spacing[1]} ${t.spacing[2]};
  }
  div[data-row]:hover,
  div[data-row]:focus-within {
    background: ${t.background.tertiary};
  }
  div[data-row] div[data-actions] {
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms cubic-bezier(0.2, 0, 0, 1);
  }
  div[data-row]:hover div[data-actions],
  div[data-row]:focus-within div[data-actions] {
    opacity: 1;
  }
  @media (hover: none) {
    div[data-row] div[data-actions] {
      opacity: 1;
    }
  }
  span[data-name] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.medium};
  }
  span[data-email] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    margin-left: ${t.spacing[2]};
  }
  span[data-when] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    white-space: nowrap;
  }
  span[data-when][data-future] {
    color: ${ACCENT};
  }
`;

const FunnelCard = ({
  title,
  sub,
  base,
  rates,
  stages,
  onStage,
}: {
  title: string;
  sub: string;
  base: number;
  rates: { label: string; value: number | null; hi?: boolean }[];
  stages: Stage[];
  onStage: (stage: Stage) => void;
}) => {
  const denom = base > 0 ? base : Math.max(stages[0]?.value ?? 0, 1);
  return (
    <StyledCard>
      <StyledCardHead>
        <div>
          <StyledCardTitle>{title}</StyledCardTitle>
          <StyledCardHint>{sub}</StyledCardHint>
        </div>
      </StyledCardHead>
      <StyledRates>
        {rates.map((r) => (
          <div key={r.label} data-rate data-hi={r.hi ? '' : undefined}>
            <div data-k>{r.label}</div>
            <div data-v>{r.value == null ? '—' : `${r.value}%`}</div>
          </div>
        ))}
      </StyledRates>
      <StyledFunnel>
        {stages.map((s, i) => {
          const ofRun = i === 0 ? null : pct(s.value, denom);
          const step = i <= 1 ? null : pct(s.value, stages[i - 1].value);
          const width = Math.min(
            100,
            Math.max(2, Math.round((s.value / denom) * 100)),
          );
          return (
            <button
              key={s.key}
              data-stage
              title="Click to see the people at this stage"
              onClick={() => onStage(s)}
            >
              <div>
                <div data-title>{s.title}</div>
                <div data-hint>{s.hint}</div>
              </div>
              <div data-nums>
                <b>{nf(s.value)}</b>
                {ofRun != null && (
                  <span>
                    <b>{ofRun}%</b>
                    {step != null && ` · ${step}% step`}
                  </span>
                )}
              </div>
              <div data-bar>
                <div
                  style={{
                    width: `${width}%`,
                    background: s.highlight ? POSITIVE : ACCENT,
                  }}
                />
              </div>
            </button>
          );
        })}
      </StyledFunnel>
      <StyledFootnote>
        Bold % = of {nf(base)} session{base === 1 ? '' : 's'} run · step = vs
        previous stage
      </StyledFootnote>
    </StyledCard>
  );
};

const WebinarPageContent = () => {
  const { confirm, ConfirmHost } = useConfirm('webinar');
  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [custom, setCustom] = useState<Range>({ from: null, to: null });
  const range = useMemo(() => rangeFor(rangeKey, custom), [rangeKey, custom]);
  const [funnel, setFunnel] = useState<WebinarFunnel | null>(null);
  const [allTime, setAllTime] = useState<WebinarFunnel | null>(null);
  const [noData, setNoData] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ stage: string; label: string } | null>(
    null,
  );
  const [members, setMembers] = useState<WebinarMember[] | null>(null);
  const [membersError, setMembersError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadFunnel = () =>
    fetchWebinarFunnel(range.from, range.to)
      .then((f) => {
        setFunnel(f);
        setNoData(false);
      })
      .catch(() => {
        setFunnel(EMPTY);
        setNoData(true);
      });
  useEffect(() => {
    setFunnel(null);
    loadFunnel(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [range.from, range.to]);
  useEffect(() => {
    fetchWebinarFunnel(null, null)
      .then(setAllTime)
      .catch(() => setAllTime(EMPTY));
  }, []);
  useEffect(() => {
    if (!drill) return;
    setMembers(null);
    setMembersError(false);
    fetchWebinarStageMembers(drill.stage, range.from, range.to)
      .then(setMembers)
      .catch(() => setMembersError(true));
  }, [drill, range.from, range.to]);

  const f = funnel ?? EMPTY;
  const due = f.shared.due;
  const showUp = pct(f.shared.showed, due);
  const open = (stage: string, label: string) => setDrill({ stage, label });

  const offerStages: Stage[] = [
    {
      key: 'registered',
      title: 'Registered',
      hint: 'booked a session',
      value: f.shared.registered,
    },
    {
      key: 'entered',
      title: 'Showed up',
      hint:
        f.shared.upcoming > 0
          ? `of ${nf(due)} session${due === 1 ? '' : 's'} run`
          : 'reached the live room',
      value: f.shared.entered,
    },
    {
      key: 'reached_offer',
      title: 'Saw the offer',
      hint: 'watched to the pitch',
      value: f.offer.reached_offer,
    },
    {
      key: 'offer_click',
      title: 'Clicked offer',
      hint: 'opened the $599 flow',
      value: f.offer.offer_click,
    },
    {
      key: 'offer_paid',
      title: '$599 paid',
      hint: 'bought the yearly offer',
      value: f.offer.paid,
      highlight: true,
    },
  ];
  const trialStages: Stage[] = [
    offerStages[0],
    offerStages[1],
    {
      key: 'trial_click',
      title: 'Clicked start trial',
      hint: 'hit trial on the webinar',
      value: f.trial.trial_click,
    },
    {
      key: 'trial_started',
      title: 'Trial started',
      hint: 'created the trial account',
      value: f.trial.trial_started,
    },
    {
      key: 'trial_paid',
      title: 'Paying',
      hint: 'converted to a paying plan',
      value: f.trial.paid,
      highlight: true,
    },
  ];

  const removeFromStage = async (m: WebinarMember) => {
    if (
      !drill ||
      !(await confirm({
        title: `Remove ${m.email} from "${drill.label}"?`,
        message: 'This deletes their event for this stage.',
        confirmText: 'Remove',
        danger: true,
      }))
    )
      return;
    setBusy(m.email);
    try {
      await deleteWebinarStageMember(
        drill.stage,
        m.email,
        range.from,
        range.to,
      );
      setMembers((rows) => rows?.filter((r) => r.email !== m.email) ?? null);
      await loadFunnel();
    } catch (e) {
      setErr('Failed: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const deletePerson = async (m: WebinarMember) => {
    if (
      !drill ||
      !(await confirm({
        title: `Delete ${m.email} from the entire webinar funnel?`,
        message: `This removes them from every stage, across all time, not just "${drill.label}" or the current date range. Use this for dummy or test leads. Cannot be undone.`,
        confirmText: 'Delete everywhere',
        danger: true,
      }))
    )
      return;
    setBusy(m.email);
    try {
      const removed = await deleteWebinarPerson(m.email);
      if (removed === 0) setErr(`Nothing removed for ${m.email}.`);
      setMembers((rows) => rows?.filter((r) => r.email !== m.email) ?? null);
      await loadFunnel();
    } catch (e) {
      setErr('Failed: ' + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const copyEmails = () => {
    if (members?.length)
      navigator.clipboard?.writeText(members.map((m) => m.email).join(', '));
  };

  const dailyLabels = f.daily.map((d) => dayLabel(d.day));
  const growthSeries = useMemo(() => {
    let sum = 0;
    return [...(allTime?.daily ?? [])]
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => {
        sum += d.registered;
        return {
          label: dayLabel(d.day),
          value: sum,
          sublabel: dayLabel(d.day),
        };
      });
  }, [allTime]);

  const outcomeTiles = [
    {
      key: 'trialing_now',
      label: 'Trialing now',
      value: f.outcomes.trialing_now,
      sub: 'in a trial today',
    },
    {
      key: 'trial_started',
      label: 'Trial started',
      value: f.outcomes.trial_started,
      sub: 'ever started a trial',
    },
    {
      key: 'paying_monthly',
      label: 'Paying monthly',
      value: f.outcomes.paying_monthly,
      sub: 'monthly plan',
    },
    {
      key: 'paying_yearly',
      label: 'Paying yearly',
      value: f.outcomes.paying_yearly,
      sub: 'incl. the $599',
    },
    {
      key: 'paying_any',
      label: 'Paying, any plan',
      value: f.outcomes.paying_any,
      sub: `the real payoff · ${usd(f.outcomes.mrr_cents)}/mo MRR`,
      hi: true,
    },
  ];

  return (
    <StyledPage>
      <ConfirmHost />
      <PageHeader title="Webinar" Icon={IconPresentation}>
        <StyledHeaderActions>
          <StyledMuted>Evergreen webinar funnel</StyledMuted>
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme
          baseColor={'var(--t-background-tertiary)'}
          highlightColor={'var(--t-background-transparent-lighter)'}
          borderRadius={4}
        >
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}
            {noData && (
              <StyledNotice>No webinar events for this range yet.</StyledNotice>
            )}

            <StyledRow>
              <StyledLabel>Range</StyledLabel>
              {RANGES.map((r) => (
                <PillButton
                  key={r.key}
                  active={rangeKey === r.key}
                  title={r.label}
                  onClick={() => setRangeKey(r.key)}
                />
              ))}
              {rangeKey === 'custom' && (
                <>
                  <StyledDivider />
                  <StyledField>
                    <input
                      type="date"
                      value={custom.from ?? ''}
                      onChange={(e) =>
                        setCustom((c) => ({
                          ...c,
                          from: e.target.value || null,
                        }))
                      }
                    />
                  </StyledField>
                  <StyledMuted>→</StyledMuted>
                  <StyledField>
                    <input
                      type="date"
                      value={custom.to ?? ''}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, to: e.target.value || null }))
                      }
                    />
                  </StyledField>
                </>
              )}
            </StyledRow>

            <StyledGrid3>
              <StyledTile
                data-clickable=""
                role="button"
                tabIndex={0}
                onClick={() => open('registered', 'Registered')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open('registered', 'Registered');
                  }
                }}
                title="Click to see the people behind this number"
                style={{ cursor: 'pointer' }}
              >
                <div data-label>
                  <span>Registered</span>
                </div>
                <div data-value="">
                  {funnel ? nf(f.shared.registered) : <Skeleton width={50} />}
                </div>
                <div data-delta="">
                  {f.shared.upcoming > 0
                    ? `${nf(f.shared.upcoming)} still upcoming`
                    : 'booked a session'}
                </div>
              </StyledTile>
              <StyledTile
                data-clickable=""
                role="button"
                tabIndex={0}
                onClick={() => open('entered', 'Showed up')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    open('entered', 'Showed up');
                  }
                }}
                title="Click to see the people behind this number"
                style={{ cursor: 'pointer' }}
              >
                <div data-label>
                  <span>Showed up</span>
                </div>
                <div data-value="">
                  {funnel ? nf(f.shared.entered) : <Skeleton width={50} />}
                </div>
                <div data-delta="">reached the live room</div>
              </StyledTile>
              <StyledTile>
                <div data-label>
                  <span>Show-up rate</span>
                </div>
                <div data-value="positive">
                  {funnel ? (
                    showUp == null ? (
                      '—'
                    ) : (
                      `${showUp}%`
                    )
                  ) : (
                    <Skeleton width={50} />
                  )}
                </div>
                <div data-delta="">
                  {due === 0
                    ? 'no sessions have run yet'
                    : `of ${nf(due)} session${due === 1 ? '' : 's'} that have run`}
                </div>
              </StyledTile>
            </StyledGrid3>

            {drill && (
              <StyledReveal>
                <StyledCard>
                  <StyledCardHead>
                    <div>
                      <StyledCardTitle>{drill.label}</StyledCardTitle>
                      <StyledCardHint>
                        {members
                          ? `${members.length} ${members.length === 1 ? 'person' : 'people'}`
                          : membersError
                            ? 'Could not load this stage.'
                            : 'Loading…'}{' '}
                        · hover a row to remove
                      </StyledCardHint>
                    </div>
                    <StyledRow>
                      {!!members?.length && (
                        <Button
                          size="small"
                          variant="secondary"
                          title="Copy emails"
                          onClick={copyEmails}
                        />
                      )}
                      <Button
                        size="small"
                        variant="tertiary"
                        Icon={IconX}
                        title="Close"
                        onClick={() => setDrill(null)}
                      />
                    </StyledRow>
                  </StyledCardHead>
                  <StyledMembers>
                    {members?.length === 0 && (
                      <StyledMuted>No one at this stage yet.</StyledMuted>
                    )}
                    {members?.map((m) => {
                      const future = m.slot
                        ? new Date(m.slot) > new Date()
                        : false;
                      return (
                        <div key={m.email} data-row>
                          <div>
                            <span data-name>
                              {m.name || m.email.split('@')[0]}
                            </span>
                            {m.rescheduled && (
                              <StyledChip
                                data-tone="caution"
                                title={`Re-booked ${m.bookings} times, showing their latest session`}
                                style={{ marginLeft: 6 }}
                              >
                                rescheduled ×{m.bookings}
                              </StyledChip>
                            )}
                            <span data-email>{m.email}</span>
                          </div>
                          <span data-when data-future={future ? '' : undefined}>
                            {m.slot
                              ? `${slotFmt(m.slot)} · ${future ? 'upcoming session' : 'session'}`
                              : m.at
                                ? dayLabel(m.at.slice(0, 10))
                                : ''}
                          </span>
                          <div data-actions>
                            {DELETABLE_STAGES.has(drill.stage) && (
                              <Button
                                size="small"
                                variant="tertiary"
                                title={
                                  busy === m.email ? '…' : 'Remove from stage'
                                }
                                disabled={busy === m.email}
                                onClick={() => removeFromStage(m)}
                              />
                            )}
                            <Button
                              size="small"
                              variant="tertiary"
                              accent="danger"
                              title="Delete everywhere"
                              disabled={busy === m.email}
                              onClick={() => deletePerson(m)}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </StyledMembers>
                </StyledCard>
              </StyledReveal>
            )}

            <StyledGrid2>
              <FunnelCard
                title="Offer path"
                sub="The $599 yearly, closed live"
                base={due}
                onStage={(s) => open(s.key, `Offer path · ${s.title}`)}
                rates={[
                  {
                    label: 'Showed up / run',
                    value: pct(f.shared.showed, due),
                  },
                  {
                    label: 'Watched offer / run',
                    value: pct(f.offer.reached_offer, due),
                  },
                  {
                    label: 'Clicked offer / run',
                    value: pct(f.offer.offer_click, due),
                  },
                  {
                    label: 'Purchased / run',
                    value: pct(f.offer.paid, due),
                    hi: true,
                  },
                ]}
                stages={offerStages}
              />
              <FunnelCard
                title="Trial path"
                sub="Free trial to a paying plan"
                base={due}
                onStage={(s) => open(s.key, `Trial path · ${s.title}`)}
                rates={[
                  {
                    label: 'Showed up / run',
                    value: pct(f.shared.showed, due),
                  },
                  {
                    label: 'Clicked trial / run',
                    value: pct(f.trial.trial_click, due),
                  },
                  {
                    label: 'Trial started / run',
                    value: pct(f.trial.trial_started, due),
                  },
                  {
                    label: 'Paying / run',
                    value: pct(f.trial.paid, due),
                    hi: true,
                  },
                ]}
                stages={trialStages}
              />
            </StyledGrid2>

            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Outcomes</StyledCardTitle>
                <StyledCardHint>
                  All attendees in range, joined by email to Stripe
                </StyledCardHint>
              </StyledCardHead>
              <StyledGrid5>
                {outcomeTiles.map((o) => (
                  <StyledTile
                    key={o.key}
                    data-clickable=""
                    role="button"
                    tabIndex={0}
                    onClick={() => open(o.key, o.label)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open(o.key, o.label);
                      }
                    }}
                    title="Click to see the people behind this number"
                    style={{ cursor: 'pointer' }}
                  >
                    <div data-label>
                      <span>{o.label}</span>
                    </div>
                    <div data-value={o.hi ? 'positive' : ''}>
                      {funnel ? nf(o.value) : <Skeleton width={40} />}
                    </div>
                    <div data-delta="">{o.sub}</div>
                  </StyledTile>
                ))}
              </StyledGrid5>
            </StyledCard>

            <StyledGrid2>
              <StyledCard>
                <StyledCardHead>
                  <StyledCardTitle>Daily</StyledCardTitle>
                  <StyledCardHint>
                    Registered vs showed, per day in range
                  </StyledCardHint>
                </StyledCardHead>
                {f.daily.length === 0 ? (
                  <StyledMuted>No days in range yet.</StyledMuted>
                ) : (
                  <MultiChart
                    labels={dailyLabels}
                    series={[
                      {
                        key: 'registered',
                        label: 'Registered',
                        color: ACCENT,
                        values: f.daily.map((d) => d.registered),
                      },
                      {
                        key: 'entered',
                        label: 'Showed',
                        color: POSITIVE,
                        dashed: true,
                        values: f.daily.map((d) => d.entered),
                      },
                    ]}
                    format={(n) => String(Math.round(n))}
                    height={200}
                  />
                )}
              </StyledCard>
              <StyledCard>
                <StyledCardHead>
                  <div>
                    <StyledCardTitle>Registration growth</StyledCardTitle>
                    <StyledCardHint>
                      Total registrations over time, all time, ignores the range
                      above
                    </StyledCardHint>
                  </div>
                  <StyledMuted>
                    {allTime ? `${nf(allTime.shared.registered)} total` : ''}
                  </StyledMuted>
                </StyledCardHead>
                {growthSeries.length === 0 ? (
                  <StyledMuted>No registrations yet.</StyledMuted>
                ) : (
                  <Chart
                    data={growthSeries}
                    format={(n) => `${Math.round(n)} registered`}
                    height={200}
                  />
                )}
              </StyledCard>
            </StyledGrid2>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};

// Financial pages are admin only; members get the same page shell with a lock.
export const WebinarPage = () => (useIsOsAdmin() ? <WebinarPageContent /> : <OsRestricted title="Webinar" />);
