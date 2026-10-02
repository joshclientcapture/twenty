import { styled } from '@linaria/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useSearchParams } from 'react-router-dom';
import { IconPhone, IconRefresh } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import {
  type CallReviewDetail,
  type CallReviewRow,
  callsBackfill,
  callsRescore,
  fetchCallReview,
  fetchCallReviews,
} from '@/custom-pages/os/data';
import { useIsOsAdmin } from '@/custom-pages/os/OsRestricted';
import {
  ACCENT,
  fmtDateTime,
  type Kpi,
  KpiTile,
  PillButton,
  StyledBars,
  StyledBody,
  StyledCard,
  StyledCardHead,
  StyledCardHint,
  StyledCardTitle,
  StyledChip,
  StyledContent,
  StyledError,
  StyledExtLink,
  StyledFootnote,
  StyledGrid4,
  StyledHeaderActions,
  StyledMuted,
  StyledPage,
  StyledReveal,
  StyledRow,
  StyledTable,
  StyledTableCard,
  StyledTextLink,
} from '@/custom-pages/os/ui';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';

type Period = 7 | 30 | 90 | 365;
type TypeFilter = 'ALL' | 'SOFTWARE' | 'DFY';

const OUTCOME_LABEL: Record<string, string> = {
  PAID_ON_CALL: 'Paid on call',
  PAYMENT_LINK_SENT: 'Payment link sent',
  TRIAL_ON_CALL: 'Trial on call',
  TRIAL_LINK_SENT: 'Trial link sent',
  FOLLOW_UP_BOOKED: 'Follow-up booked',
  NO_NEXT_STEP: 'No next step',
  NO_SHOW: 'No show',
  UNSCORED: 'Not scored',
};
const WON_OUTCOMES = new Set(['PAID_ON_CALL', 'TRIAL_ON_CALL']);
const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Reviewing',
  SCORED: 'Scored',
  SUMMARISED: 'Summary only',
  FAILED: 'Failed',
  SKIPPED: 'Skipped',
};

const outcomeTone = (outcome: string | null) =>
  outcome === 'PAID_ON_CALL' || outcome === 'TRIAL_ON_CALL'
    ? 'positive'
    : outcome === 'PAYMENT_LINK_SENT' || outcome === 'FOLLOW_UP_BOOKED'
      ? 'accent'
      : outcome === 'TRIAL_LINK_SENT'
        ? 'caution'
        : outcome === 'NO_NEXT_STEP'
          ? 'negative'
          : undefined;
const scoreTone = (score: number | null) =>
  score === null
    ? 'muted'
    : score >= 7.5
      ? 'positive'
      : score >= 5
        ? 'caution'
        : 'negative';
const typeLabel = (type: string | null) =>
  type === 'DFY' ? 'DFY' : type === 'SOFTWARE' ? 'Software' : '';

const StyledScore = styled.span`
  font-variant-numeric: tabular-nums;
  font-weight: ${t.font.weight.medium};
  &[data-tone='positive'] {
    color: ${t.tag.text.green};
  }
  &[data-tone='caution'] {
    color: ${t.tag.text.orange};
  }
  &[data-tone='negative'] {
    color: ${t.tag.text.red};
  }
  &[data-tone='muted'] {
    color: ${t.font.color.tertiary};
  }
`;

const StyledClickableRow = styled.tr`
  cursor: pointer;
  transition-duration: 100ms;
  transition-property: background-color;
  &:hover td {
    background: ${t.background.transparent.light};
  }
  &[data-selected='true'] td {
    background: ${t.background.transparent.blue};
  }
`;

const StyledHeadline = styled.blockquote`
  border-left: 3px solid ${ACCENT};
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  line-height: 1.55;
  margin: 0;
  padding: ${t.spacing[1]} 0 ${t.spacing[1]} ${t.spacing[3]};
`;

const StyledThree = styled.ol`
  color: ${t.font.color.primary};
  display: flex;
  flex-direction: column;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[2]};
  line-height: 1.5;
  margin: 0;
  padding-left: ${t.spacing[5]};
  li::marker {
    color: ${t.font.color.tertiary};
    font-variant-numeric: tabular-nums;
  }
`;

const StyledDetailGrid = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);
  @media (max-width: 960px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const StyledMeta = styled.div`
  color: ${t.font.color.tertiary};
  display: flex;
  flex-wrap: wrap;
  font-size: ${t.font.size.xs};
  gap: ${t.spacing[1]} ${t.spacing[3]};
`;

const StyledReport = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.sm};
  line-height: 1.55;
  overflow-wrap: anywhere;
  h1 {
    font-size: ${t.font.size.lg};
    font-weight: ${t.font.weight.semiBold};
    margin: 0 0 ${t.spacing[3]};
  }
  h2 {
    border-top: 1px solid ${t.border.color.light};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.semiBold};
    margin: ${t.spacing[6]} 0 ${t.spacing[3]};
    padding-top: ${t.spacing[4]};
  }
  h3 {
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.semiBold};
    margin: ${t.spacing[4]} 0 ${t.spacing[2]};
  }
  p {
    margin: 0 0 ${t.spacing[2]};
  }
  blockquote {
    background: ${t.background.secondary};
    border-left: 3px solid ${t.border.color.strong};
    border-radius: ${t.border.radius.sm};
    margin: 0 0 ${t.spacing[3]};
    padding: ${t.spacing[2]} ${t.spacing[3]};
  }
  blockquote p:last-child {
    margin-bottom: 0;
  }
  table {
    border-collapse: collapse;
    margin: 0 0 ${t.spacing[3]};
    width: 100%;
  }
  th,
  td {
    border-bottom: 1px solid ${t.border.color.light};
    padding: ${t.spacing[1]} ${t.spacing[2]};
    text-align: left;
    vertical-align: top;
  }
  th {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
  }
  ul,
  ol {
    margin: 0 0 ${t.spacing[2]};
    padding-left: ${t.spacing[5]};
  }
  li {
    margin-bottom: ${t.spacing[1]};
  }
  hr {
    border: 0;
    border-top: 1px solid ${t.border.color.light};
    margin: ${t.spacing[4]} 0;
  }
  code {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.xs};
    font-size: ${t.font.size.xs};
    padding: 0 ${t.spacing[1]};
  }
`;

const StyledPre = styled.pre`
  color: ${t.font.color.secondary};
  font-family: inherit;
  font-size: ${t.font.size.sm};
  line-height: 1.5;
  margin: 0;
  max-height: 480px;
  overflow: auto;
  white-space: pre-wrap;
`;

const sectionTone = (score: number | null | undefined) =>
  typeof score !== 'number'
    ? 'muted'
    : score >= 7.5
      ? 'positive'
      : score >= 5
        ? undefined
        : 'caution';

const CallDetail = ({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) => {
  const isAdmin = useIsOsAdmin();
  const [detail, setDetail] = useState<CallReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'REVIEW' | 'SUMMARY' | 'TRANSCRIPT'>('REVIEW');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await fetchCallReview(id));
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const rescore = async () => {
    setBusy(true);
    try {
      await callsRescore(id);
      await load();
      onChanged();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sections = detail?.scores ?? [];
  const threeThings = detail?.key_moments ?? [];

  return (
    <StyledReveal>
      <StyledCard>
        <StyledCardHead>
          <div>
            <StyledCardTitle>
              {detail?.prospect_name ?? detail?.name ?? 'Call'}
              {detail?.overall_score !== null &&
              detail?.overall_score !== undefined ? (
                <>
                  {' '}
                  <StyledScore data-tone={scoreTone(detail.overall_score)}>
                    {detail.overall_score.toFixed(1)}/10
                  </StyledScore>
                </>
              ) : null}
            </StyledCardTitle>
            {detail && (
              <StyledMeta>
                <span>{detail.closer_name ?? detail.closer_email}</span>
                <span>
                  {detail.started_at ? fmtDateTime(detail.started_at) : ''}
                </span>
                {detail.duration_minutes !== null && (
                  <span>{detail.duration_minutes} min</span>
                )}
                {detail.call_type && (
                  <span>{typeLabel(detail.call_type)} call</span>
                )}
                {detail.outcome && (
                  <StyledChip data-tone={outcomeTone(detail.outcome)}>
                    {OUTCOME_LABEL[detail.outcome] ?? detail.outcome}
                  </StyledChip>
                )}
                {detail.recording_url && (
                  <StyledExtLink
                    href={detail.recording_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Recording
                  </StyledExtLink>
                )}
                {detail.person_id && (
                  <StyledTextLink to={`/object/person/${detail.person_id}`}>
                    Open contact
                  </StyledTextLink>
                )}
              </StyledMeta>
            )}
          </div>
          <StyledRow>
            {isAdmin && (
              <PillButton
                active={false}
                title={busy ? 'Re-reviewing…' : 'Re-review'}
                onClick={rescore}
                disabled={busy}
              />
            )}
            <PillButton active={false} title="Back to list" onClick={onClose} />
          </StyledRow>
        </StyledCardHead>
        {error && <StyledError>{error}</StyledError>}
        {!detail && !error && <StyledMuted>Loading…</StyledMuted>}
        {detail && detail.status !== 'SCORED' && (
          <StyledMuted>
            {detail.status === 'PENDING'
              ? 'The review is still being written. Check back in a minute.'
              : detail.status === 'FAILED'
                ? 'The review failed. Re-review to try again.'
                : detail.status === 'SUMMARISED'
                  ? 'This closer is not scored; only the meeting summary was written.'
                  : 'This call was not reviewed.'}
          </StyledMuted>
        )}
        {detail?.verdict && <StyledHeadline>{detail.verdict}</StyledHeadline>}
        {detail && (sections.length > 0 || threeThings.length > 0) && (
          <StyledDetailGrid>
            {sections.length > 0 && (
              <div>
                <StyledCardHint>Scorecard</StyledCardHint>
                <StyledBars>
                  {sections.map((section, index) => (
                    <div data-row key={`${section.name ?? index}`}>
                      <div data-stage title={section.verdict ?? undefined}>
                        {section.name ?? `Section ${index + 1}`}
                      </div>
                      <div data-track>
                        <div
                          data-fill={sectionTone(section.score)}
                          style={{
                            width: `${typeof section.score === 'number' ? Math.max(0, Math.min(10, section.score)) * 10 : 0}%`,
                          }}
                        />
                      </div>
                      <div data-num>
                        {typeof section.score === 'number'
                          ? section.score.toFixed(1)
                          : 'n/a'}
                      </div>
                      <div data-pct />
                    </div>
                  ))}
                </StyledBars>
                {(detail.deductions ?? []).length > 0 && (
                  <StyledMuted>
                    Deductions:{' '}
                    {(detail.deductions ?? [])
                      .map(
                        (deduction) =>
                          `${deduction.breach ?? ''} (${deduction.points ?? ''})`,
                      )
                      .join(' · ')}
                  </StyledMuted>
                )}
              </div>
            )}
            {threeThings.length > 0 && (
              <div>
                <StyledCardHint>
                  Three things to change on the next call
                </StyledCardHint>
                <StyledThree>
                  {threeThings.map((thing, index) => (
                    <li key={index}>{thing}</li>
                  ))}
                </StyledThree>
              </div>
            )}
          </StyledDetailGrid>
        )}
        {detail && (
          <>
            <StyledRow>
              <PillButton
                active={tab === 'REVIEW'}
                title="Full review"
                onClick={() => setTab('REVIEW')}
              />
              <PillButton
                active={tab === 'SUMMARY'}
                title="Meeting summary"
                onClick={() => setTab('SUMMARY')}
              />
              <PillButton
                active={tab === 'TRANSCRIPT'}
                title="Transcript"
                onClick={() => setTab('TRANSCRIPT')}
              />
            </StyledRow>
            {tab === 'REVIEW' &&
              (detail.report ? (
                <StyledReport>
                  <ReactMarkdown>{detail.report}</ReactMarkdown>
                </StyledReport>
              ) : (
                <StyledMuted>No review written for this call.</StyledMuted>
              ))}
            {tab === 'SUMMARY' &&
              (detail.summary ? (
                <StyledPre>{detail.summary}</StyledPre>
              ) : (
                <StyledMuted>No summary.</StyledMuted>
              ))}
            {tab === 'TRANSCRIPT' &&
              (detail.transcript ? (
                <StyledPre>{detail.transcript}</StyledPre>
              ) : (
                <StyledMuted>No transcript.</StyledMuted>
              ))}
            {detail.confidence && (
              <StyledFootnote>
                Reviewer confidence: {detail.confidence}
              </StyledFootnote>
            )}
          </>
        )}
      </StyledCard>
    </StyledReveal>
  );
};

export const CallsPage = () => {
  const isAdmin = useIsOsAdmin();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('review');
  const [rows, setRows] = useState<CallReviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(30);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [closerFilter, setCloserFilter] = useState<string>(
    searchParams.get('closer') ?? 'ALL',
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchCallReviews(period));
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  const closers = useMemo(
    () =>
      Array.from(
        new Set(
          (rows ?? [])
            .map((row) => row.closer_name ?? row.closer_email ?? '')
            .filter(Boolean),
        ),
      ).sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (row) =>
          (typeFilter === 'ALL' || row.call_type === typeFilter) &&
          (closerFilter === 'ALL' ||
            (row.closer_name ?? row.closer_email) === closerFilter),
      ),
    [rows, typeFilter, closerFilter],
  );

  const kpis: Kpi[] = useMemo(() => {
    const scored = filtered.filter(
      (row) => typeof row.overall_score === 'number',
    );
    const average = scored.length
      ? scored.reduce((sum, row) => sum + (row.overall_score ?? 0), 0) /
        scored.length
      : null;
    const decided = filtered.filter(
      (row) =>
        row.outcome && row.outcome !== 'UNSCORED' && row.outcome !== 'NO_SHOW',
    );
    const won = decided.filter((row) => WON_OUTCOMES.has(row.outcome ?? ''));
    const nothing = decided.filter((row) => row.outcome === 'NO_NEXT_STEP');
    return [
      {
        label: 'Calls reviewed',
        value: filtered.length,
        delta:
          scored.length !== filtered.length
            ? `${scored.length} scored`
            : undefined,
      },
      {
        label: 'Average score',
        value: average === null ? '–' : average.toFixed(1),
        valueTone:
          average === null
            ? undefined
            : average >= 7.5
              ? 'positive'
              : average < 5
                ? 'caution'
                : undefined,
      },
      {
        label: 'Closed on the call',
        value: decided.length
          ? `${Math.round((won.length / decided.length) * 100)}%`
          : '–',
        delta: decided.length
          ? `${won.length} of ${decided.length}`
          : undefined,
        tone: 'positive',
      },
      {
        label: 'Left with nothing',
        value: decided.length
          ? `${Math.round((nothing.length / decided.length) * 100)}%`
          : '–',
        delta: nothing.length
          ? `${nothing.length} call${nothing.length === 1 ? '' : 's'}`
          : undefined,
        tone: nothing.length ? 'caution' : undefined,
        valueTone: nothing.length ? 'caution' : undefined,
      },
    ];
  }, [filtered]);

  const pullRecent = async () => {
    setBusy('backfill');
    setNotice(null);
    try {
      const result = await callsBackfill(period);
      const parts = Object.entries(result.results).map(
        ([status, count]) =>
          `${count} ${(STATUS_LABEL[status] ?? status).toLowerCase()}`,
      );
      setNotice(
        `Checked ${result.scanned} Fathom recording${result.scanned === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}.`,
      );
      await load();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const select = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('review', id);
    else next.delete('review');
    setSearchParams(next, { replace: true });
  };

  return (
    <StyledPage>
      <PageHeader title="Calls" Icon={IconPhone}>
        <StyledHeaderActions>
          {isAdmin && (
            <Button
              size="small"
              variant="secondary"
              title={busy === 'backfill' ? 'Pulling…' : 'Pull from Fathom'}
              onClick={pullRecent}
              disabled={busy !== null}
            />
          )}
          <Button
            size="small"
            variant="secondary"
            Icon={IconRefresh}
            title="Refresh"
            onClick={load}
            disabled={busy !== null}
          />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <StyledContent>
          {error && <StyledError>{error}</StyledError>}
          {notice && <StyledMuted>{notice}</StyledMuted>}

          {selectedId && (
            <CallDetail
              id={selectedId}
              onClose={() => select(null)}
              onChanged={load}
            />
          )}

          <StyledGrid4>
            {kpis.map((kpi) => (
              <KpiTile key={kpi.label} kpi={kpi} />
            ))}
          </StyledGrid4>

          <StyledTableCard>
            <StyledCardHead>
              <StyledCardTitle>Reviewed calls</StyledCardTitle>
              <StyledRow>
                {([7, 30, 90, 365] as Period[]).map((days) => (
                  <PillButton
                    key={days}
                    active={period === days}
                    title={days === 365 ? 'Year' : `${days} days`}
                    onClick={() => setPeriod(days)}
                  />
                ))}
                <StyledMuted>·</StyledMuted>
                {(['ALL', 'SOFTWARE', 'DFY'] as TypeFilter[]).map((key) => (
                  <PillButton
                    key={key}
                    active={typeFilter === key}
                    title={key === 'ALL' ? 'All types' : typeLabel(key)}
                    onClick={() => setTypeFilter(key)}
                  />
                ))}
                {closers.length > 1 && (
                  <>
                    <StyledMuted>·</StyledMuted>
                    <PillButton
                      active={closerFilter === 'ALL'}
                      title="All closers"
                      onClick={() => setCloserFilter('ALL')}
                    />
                    {closers.map((closer) => (
                      <PillButton
                        key={closer}
                        active={closerFilter === closer}
                        title={closer}
                        onClick={() => setCloserFilter(closer)}
                      />
                    ))}
                  </>
                )}
              </StyledRow>
            </StyledCardHead>
            <div data-scroll>
              <StyledTable>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Prospect</th>
                    <th>Closer</th>
                    <th>Type</th>
                    <th>Outcome</th>
                    <th data-right>Score</th>
                    <th data-right>Length</th>
                    <th>Headline</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <StyledClickableRow
                      key={row.id}
                      data-selected={row.id === selectedId}
                      onClick={() => select(row.id)}
                    >
                      <td data-muted>
                        {row.started_at
                          ? fmtDateTime(row.started_at)
                          : row.call_date}
                      </td>
                      <td>
                        {row.prospect_name ??
                          row.person_name ??
                          row.prospect_email ??
                          '—'}
                        {row.person_stage ? (
                          <>
                            <br />
                            <StyledMuted>{row.person_stage}</StyledMuted>
                          </>
                        ) : null}
                      </td>
                      <td data-muted>{row.closer_name ?? row.closer_email}</td>
                      <td data-muted>{typeLabel(row.call_type)}</td>
                      <td>
                        {row.status === 'SCORED' ? (
                          <StyledChip data-tone={outcomeTone(row.outcome)}>
                            {OUTCOME_LABEL[row.outcome ?? 'UNSCORED'] ??
                              row.outcome}
                          </StyledChip>
                        ) : (
                          <StyledChip>
                            {STATUS_LABEL[row.status ?? ''] ?? row.status}
                          </StyledChip>
                        )}
                      </td>
                      <td data-right>
                        <StyledScore data-tone={scoreTone(row.overall_score)}>
                          {typeof row.overall_score === 'number'
                            ? row.overall_score.toFixed(1)
                            : '–'}
                        </StyledScore>
                      </td>
                      <td data-right data-muted>
                        {row.duration_minutes !== null
                          ? `${row.duration_minutes}m`
                          : ''}
                      </td>
                      <td data-muted>
                        {row.verdict
                          ? `${row.verdict.slice(0, 140)}${row.verdict.length > 140 ? '…' : ''}`
                          : ''}
                      </td>
                    </StyledClickableRow>
                  ))}
                  {rows && filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} data-muted>
                        No reviewed calls in this period. New Fathom recordings
                        land here a few minutes after the call ends.
                      </td>
                    </tr>
                  )}
                </tbody>
              </StyledTable>
            </div>
          </StyledTableCard>

          <StyledFootnote>
            Every Fathom recording with an outside attendee is matched to its
            Calendly booking, summarised onto the contact's timeline and, for
            coached closers, reviewed against the software or DFY call standard.
            Click a row for the full report.
          </StyledFootnote>
        </StyledContent>
      </StyledBody>
    </StyledPage>
  );
};
