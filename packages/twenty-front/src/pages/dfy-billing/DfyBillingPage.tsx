import { styled } from '@linaria/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { IconFileText, IconRefresh } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import {
  type DfyBilling,
  type DfyEngagementRow,
  type DfyInstalmentRow,
  type DfyNewEngagement,
  dfyCreateEngagement,
  dfyEngagementAction,
  dfyInstalmentAction,
  fetchDfyBilling,
} from '@/custom-pages/os/data';
import { OsRestricted, useIsOsAdmin } from '@/custom-pages/os/OsRestricted';
import { OsSelect } from '@/custom-pages/os/OsSelect';
import {
  fmtDate,
  fmtUsd,
  fmtUsd2,
  type Kpi,
  KpiTile,
  PillButton,
  StyledBody,
  StyledCard,
  StyledCardHead,
  StyledCardHint,
  StyledCardTitle,
  StyledContent,
  StyledError,
  StyledFootnote,
  StyledGrid5,
  StyledHeaderActions,
  StyledMuted,
  StyledPage,
  StyledRow,
  StyledTable,
  StyledTableCard,
} from '@/custom-pages/os/ui';
import { useConfirm } from '@/custom-pages/os/useConfirm';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';

type InstalmentFilter = 'OPEN' | 'OVERDUE' | 'PAID' | 'ALL';

const StyledForm = styled.form`
  display: grid;
  gap: ${t.spacing[2]};
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  align-items: end;
`;

const StyledFieldBlock = styled.label`
  color: ${t.font.color.tertiary};
  display: flex;
  flex-direction: column;
  font-size: ${t.font.size.xs};
  gap: ${t.spacing[1]};
`;

const StyledInput = styled.input`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-family: inherit;
  font-size: ${t.font.size.sm};
  height: 28px;
  padding: 0 ${t.spacing[2]};
  &:focus {
    border-color: ${t.color.blue};
    outline: none;
  }
`;

const StyledStatus = styled.span`
  border-radius: ${t.border.radius.sm};
  display: inline-block;
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.medium};
  padding: 1px ${t.spacing[2]};
  &[data-tone='good'] {
    background: ${t.tag.background.green};
    color: ${t.tag.text.green};
  }
  &[data-tone='warn'] {
    background: ${t.tag.background.orange};
    color: ${t.tag.text.orange};
  }
  &[data-tone='bad'] {
    background: ${t.tag.background.red};
    color: ${t.tag.text.red};
  }
  &[data-tone='info'] {
    background: ${t.tag.background.blue};
    color: ${t.tag.text.blue};
  }
  &[data-tone='muted'] {
    background: ${t.background.tertiary};
    color: ${t.font.color.tertiary};
  }
`;

const StyledActions = styled.div`
  display: flex;
  gap: ${t.spacing[1]};
  justify-content: flex-end;
`;

const engagementTone = (status: DfyEngagementRow['status']) =>
  status === 'LIVE' ? 'good' : status === 'PAUSED' ? 'warn' : status === 'CHURNED' ? 'bad' : status === 'PENDING' ? 'info' : 'muted';
const instalmentTone = (status: DfyInstalmentRow['status']) =>
  status === 'PAID' ? 'good' : status === 'OVERDUE' || status === 'FAILED' ? 'bad' : status === 'INVOICED' || status === 'PENDING' ? 'info' : 'muted';
const planLabel = (plan: DfyEngagementRow['plan']) => (plan === 'TWO_PAY' ? '2 payments' : plan === 'PIF' ? 'Paid in full' : '');
const methodLabel = (method: DfyInstalmentRow['method']) => (method === 'DEBIT' ? 'Direct debit' : method === 'PUSH' ? 'Bank transfer' : '');
const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

const EMPTY_FORM: DfyNewEngagement = { personEmail: '', package: '', priceUsd: 0, plan: 'TWO_PAY', method: 'PUSH' };

const DfyBillingPageContent = () => {
  const [billing, setBilling] = useState<DfyBilling | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<InstalmentFilter>('OPEN');
  const [form, setForm] = useState<DfyNewEngagement>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const { confirm, ConfirmHost } = useConfirm('dfy-billing');

  const load = useCallback(async () => {
    try {
      setBilling(await fetchDfyBilling());
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
      await load();
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const kpis: Kpi[] = useMemo(() => {
    if (!billing) return [];
    return [
      { label: 'Due this week', value: fmtUsd(billing.due_this_week) },
      { label: 'Overdue', value: fmtUsd(billing.overdue), delta: billing.overdue_count ? `${billing.overdue_count} instalment${billing.overdue_count === 1 ? '' : 's'}` : 'none', tone: billing.overdue_count ? 'caution' : 'positive', valueTone: billing.overdue_count ? 'caution' : undefined },
      { label: 'Collected this month', value: fmtUsd(billing.collected_this_month), valueTone: 'positive' },
      { label: 'Live engagements', value: billing.live, delta: billing.paused ? `${billing.paused} paused` : undefined, tone: billing.paused ? 'caution' : undefined },
      { label: 'Renewals in 30 days', value: billing.renewals_30d },
    ];
  }, [billing]);

  const instalments = useMemo(() => {
    const rows = billing?.instalments ?? [];
    if (filter === 'OPEN') return rows.filter((row) => ['SCHEDULED', 'INVOICED', 'PENDING', 'OVERDUE'].includes(row.status));
    if (filter === 'OVERDUE') return rows.filter((row) => row.status === 'OVERDUE');
    if (filter === 'PAID') return rows.filter((row) => row.status === 'PAID').sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''));
    return rows;
  }, [billing, filter]);

  const clientOf = (row: DfyInstalmentRow) => billing?.engagements.find((engagement) => engagement.id === row.engagement_id);

  const forecastMonths = useMemo(() => Object.entries(billing?.forecast ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(0, 6), [billing]);

  const submitEngagement = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.personEmail?.trim() || !form.package.trim() || !(form.priceUsd > 0)) {
      setError('Client email, package and price are required.');
      return;
    }
    await run('create', async () => {
      await dfyCreateEngagement({ ...form, personEmail: form.personEmail?.trim(), package: form.package.trim() });
      setForm(EMPTY_FORM);
      setShowForm(false);
    });
  };

  const markPaid = async (row: DfyInstalmentRow) => {
    const reference = await confirm({
      title: `Mark ${row.name} as paid`,
      message: `${fmtUsd2(row.amount)} for ${clientOf(row)?.client ?? 'this client'}. This writes the ledger row, counts commission and posts the Discord card.`,
      confirmText: 'Mark paid',
      input: { placeholder: 'Bank or Airwallex reference (optional)', label: 'Reference' },
    });
    if (reference === false) return;
    await run(row.id, () => dfyInstalmentAction(row.id, 'paid', { reference: reference || null, method: row.method ?? 'PUSH' }));
  };

  const cancelInstalment = async (row: DfyInstalmentRow) => {
    const reason = await confirm({ title: `Cancel ${row.name}`, message: 'The instalment is kept for the record but no longer chased or forecast.', confirmText: 'Cancel instalment', danger: true, input: { placeholder: 'Why (optional)' } });
    if (reason === false) return;
    await run(row.id, () => dfyInstalmentAction(row.id, 'cancel', { reason: reason || null }));
  };

  const goLive = async (engagement: DfyEngagementRow) => {
    const date = await confirm({ title: `Go live: ${engagement.client ?? engagement.name}`, message: 'Starts the 90-day term today unless you give another date. The renewal is created for the last day of the term.', confirmText: 'Go live', input: { placeholder: 'YYYY-MM-DD (blank = today)', label: 'Live from' } });
    if (date === false) return;
    await run(engagement.id, () => dfyEngagementAction(engagement.id, 'live', date ? { goLiveDate: date } : {}));
  };

  const pause = async (engagement: DfyEngagementRow) => {
    const reason = await confirm({ title: `Pause ${engagement.client ?? engagement.name}`, message: 'Delivery stops and the term clock stops with it. Resuming pushes the end date and renewal out by the days lost.', confirmText: 'Pause', danger: true, input: { placeholder: 'Reason (optional)' } });
    if (reason === false) return;
    await run(engagement.id, () => dfyEngagementAction(engagement.id, 'pause', { reason: reason || null }));
  };

  return (
    <StyledPage>
      <ConfirmHost />
      <PageHeader title="DFY Billing" Icon={IconFileText}>
        <StyledHeaderActions>
          <Button size="small" variant="secondary" title={showForm ? 'Close' : 'New engagement'} onClick={() => setShowForm((value) => !value)} />
          <Button size="small" variant="secondary" Icon={IconRefresh} title="Refresh" onClick={load} disabled={busy !== null} />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <StyledContent>
          {error && <StyledError>{error}</StyledError>}

          {showForm && (
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>New DFY engagement</StyledCardTitle>
                <StyledCardHint>Instalment 1 is due on signing. A two-payment plan gets instalment 2 forty-five days after instalment 1 is paid. The renewal is added at go-live.</StyledCardHint>
              </StyledCardHead>
              <StyledForm onSubmit={submitEngagement}>
                <StyledFieldBlock>
                  Client email
                  <StyledInput value={form.personEmail ?? ''} onChange={(event) => setForm({ ...form, personEmail: event.target.value })} placeholder="client@company.com" />
                </StyledFieldBlock>
                <StyledFieldBlock>
                  Package
                  <StyledInput value={form.package} onChange={(event) => setForm({ ...form, package: event.target.value })} placeholder="e.g. 90-day outreach, 60 appointments" />
                </StyledFieldBlock>
                <StyledFieldBlock>
                  Price (USD)
                  <StyledInput type="number" min={1} step={1} value={form.priceUsd || ''} onChange={(event) => setForm({ ...form, priceUsd: Number(event.target.value) })} />
                </StyledFieldBlock>
                <StyledFieldBlock>
                  Volume promised
                  <StyledInput type="number" min={0} step={1} value={form.volumeTarget ?? ''} onChange={(event) => setForm({ ...form, volumeTarget: event.target.value ? Number(event.target.value) : undefined })} placeholder="e.g. 60" />
                </StyledFieldBlock>
                <OsSelect id="dfy-plan" label="Plan" value={form.plan} options={[{ value: 'TWO_PAY', label: 'Two payments (now + 45 days)' }, { value: 'PIF', label: 'Pay in full' }]} onChange={(plan) => setForm({ ...form, plan })} />
                <OsSelect id="dfy-method" label="Collection" value={form.method ?? 'PUSH'} options={[{ value: 'PUSH', label: 'Bank transfer (client sends)' }, { value: 'DEBIT', label: 'Direct debit (business account)' }]} onChange={(method) => setForm({ ...form, method })} />
                <StyledFieldBlock>
                  Signed on
                  <StyledInput type="date" value={form.contractDate ?? ''} onChange={(event) => setForm({ ...form, contractDate: event.target.value || undefined })} />
                </StyledFieldBlock>
                <Button size="small" variant="primary" accent="blue" title={busy === 'create' ? 'Creating…' : 'Create'} type="submit" disabled={busy !== null} />
              </StyledForm>
            </StyledCard>
          )}

          <StyledGrid5>{kpis.map((kpi) => <KpiTile key={kpi.label} kpi={kpi} />)}</StyledGrid5>

          <StyledTableCard>
            <StyledCardHead>
              <StyledCardTitle>Engagements</StyledCardTitle>
              <StyledCardHint>Money runs from the day they sign, the work from the day they go live. Pause when an instalment is a week overdue; the daily tick does it if nobody has.</StyledCardHint>
            </StyledCardHead>
            <div data-scroll>
              <StyledTable>
                <thead>
                  <tr>
                    <th>Client</th><th>Package</th><th>Plan</th><th>Status</th><th>Signed</th><th>Live</th><th>Ends</th><th data-right>Paid / price</th><th>Next due</th><th data-right>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(billing?.engagements ?? []).map((engagement) => (
                    <tr key={engagement.id}>
                      <td>{engagement.client ?? '—'}<br /><StyledMuted>{engagement.client_email ?? ''}</StyledMuted></td>
                      <td>{engagement.package ?? engagement.name}{engagement.volume_target ? <><br /><StyledMuted>{engagement.volume_delivered ?? 0} of {engagement.volume_target} delivered</StyledMuted></> : null}</td>
                      <td>{planLabel(engagement.plan)}</td>
                      <td><StyledStatus data-tone={engagementTone(engagement.status)}>{titleCase(engagement.status)}</StyledStatus>{engagement.days_paused ? <><br /><StyledMuted>{engagement.days_paused} days paused</StyledMuted></> : null}</td>
                      <td data-muted>{fmtDate(engagement.contract_date)}</td>
                      <td data-muted>{fmtDate(engagement.go_live_date)}</td>
                      <td data-muted>{fmtDate(engagement.end_date)}</td>
                      <td data-right>{fmtUsd(engagement.paid_total)} / {fmtUsd(engagement.price)}</td>
                      <td data-muted>{engagement.next_due ? fmtDate(engagement.next_due) : '—'}{engagement.overdue_count ? <> <StyledStatus data-tone="bad">{engagement.overdue_count} overdue</StyledStatus></> : null}</td>
                      <td data-right>
                        <StyledActions>
                          {engagement.status === 'PENDING' && <PillButton active title="Go live" onClick={() => goLive(engagement)} disabled={busy !== null} />}
                          {engagement.status === 'LIVE' && <PillButton active={false} title="Pause" onClick={() => pause(engagement)} disabled={busy !== null} />}
                          {engagement.status === 'PAUSED' && <PillButton active title="Resume" onClick={() => run(engagement.id, () => dfyEngagementAction(engagement.id, 'resume'))} disabled={busy !== null} />}
                        </StyledActions>
                      </td>
                    </tr>
                  ))}
                  {billing && billing.engagements.length === 0 && <tr><td colSpan={10} data-muted>No DFY engagements yet. Create one above when a deal closes.</td></tr>}
                </tbody>
              </StyledTable>
            </div>
          </StyledTableCard>

          <StyledTableCard>
            <StyledCardHead>
              <StyledCardTitle>Instalments</StyledCardTitle>
              <StyledRow>
                {(['OPEN', 'OVERDUE', 'PAID', 'ALL'] as InstalmentFilter[]).map((key) => (
                  <PillButton key={key} active={filter === key} title={titleCase(key)} onClick={() => setFilter(key)} />
                ))}
              </StyledRow>
            </StyledCardHead>
            <div data-scroll>
              <StyledTable>
                <thead>
                  <tr>
                    <th>Client</th><th>Instalment</th><th data-right>Amount</th><th>Due</th><th>Status</th><th>Collection</th><th>Reference</th><th>Paid</th><th data-right>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instalments.map((row) => {
                    const engagement = clientOf(row);
                    const open = !['PAID', 'CANCELLED'].includes(row.status);
                    return (
                      <tr key={row.id}>
                        <td>{engagement?.client ?? '—'}<br /><StyledMuted>{engagement?.package ?? ''}</StyledMuted></td>
                        <td>{row.name}</td>
                        <td data-right>{fmtUsd2(row.amount)}</td>
                        <td data-muted>{fmtDate(row.due_date)}</td>
                        <td><StyledStatus data-tone={instalmentTone(row.status)}>{titleCase(row.status)}</StyledStatus></td>
                        <td data-muted>{methodLabel(row.method)}</td>
                        <td data-muted>{row.reference ?? ''}</td>
                        <td data-muted>{row.status === 'PAID' ? `${fmtUsd2(row.paid_amount)} · ${fmtDate(row.paid_at)}` : ''}</td>
                        <td data-right>
                          <StyledActions>
                            {open && row.status === 'SCHEDULED' && <PillButton active={false} title="Invoice now" onClick={() => run(row.id, () => dfyInstalmentAction(row.id, 'invoice'))} disabled={busy !== null} />}
                            {open && <PillButton active title="Mark paid" onClick={() => markPaid(row)} disabled={busy !== null} />}
                            {open && <PillButton active={false} title="Cancel" onClick={() => cancelInstalment(row)} disabled={busy !== null} />}
                          </StyledActions>
                        </td>
                      </tr>
                    );
                  })}
                  {billing && instalments.length === 0 && <tr><td colSpan={9} data-muted>Nothing here.</td></tr>}
                </tbody>
              </StyledTable>
            </div>
          </StyledTableCard>

          {forecastMonths.length > 0 && (
            <StyledCard>
              <StyledCardHead>
                <StyledCardTitle>Scheduled cash by month</StyledCardTitle>
                <StyledCardHint>Open instalments and renewals by due month. Paid rows drop out as they land.</StyledCardHint>
              </StyledCardHead>
              <StyledTable>
                <thead><tr>{forecastMonths.map(([month]) => <th key={month}>{month}</th>)}</tr></thead>
                <tbody><tr>{forecastMonths.map(([month, total]) => <td key={month}>{fmtUsd(total)}</td>)}</tr></tbody>
              </StyledTable>
            </StyledCard>
          )}

          <StyledFootnote>
            Paid instalments land in the sales ledger as DFY cash with 10% closer commission, and the Discord card fires on each one. Direct debit through Airwallex marks instalments paid automatically once the account is connected; bank transfers are marked here when the money shows.
          </StyledFootnote>
        </StyledContent>
      </StyledBody>
    </StyledPage>
  );
};

export const DfyBillingPage = () => (useIsOsAdmin() ? <DfyBillingPageContent /> : <OsRestricted title="DFY Billing" />);
