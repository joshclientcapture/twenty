import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import { IconPlus, IconUsers } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { currentUserState } from '@/auth/states/currentUserState';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { PermissionFlagType } from '~/generated-metadata/graphql';
import {
  CAUTION,
  EASE_OUT,
  fmtUsd,
  fmtUsd2,
  POSITIVE,
  PRESS_SCALE,
  StyledBody,
  StyledCard,
  StyledCardHead,
  StyledCardHint,
  StyledCardTitle,
  StyledChip,
  StyledContent,
  StyledError,
  StyledField,
  StyledGrid3,
  StyledHeaderActions,
  StyledLabel,
  StyledMuted,
  StyledNotice,
  StyledPage,
  StyledReveal,
  StyledRow,
} from '@/custom-pages/os/ui';
import {
  type Closer,
  type CloserCommission,
  type CloserSales,
  fetchCloserCommission,
  fetchClosers,
  fetchCloserSales,
  fetchCloserShowUp,
  findOwnCloser,
  slugifyCloserId,
  upsertCloser,
} from '@/custom-pages/os/closers';
import { type ShowUp } from '@/custom-pages/os/data';

type CloserStats = { showUp: ShowUp | null; sales: CloserSales | null; commission: CloserCommission | null };

const StyledCloserCard = styled.div`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  padding: ${t.spacing[4]};
  transition: border-color 120ms ${EASE_OUT}, transform 120ms ${EASE_OUT}, background 120ms ${EASE_OUT};
  @media (hover: hover) {
    &:hover { border-color: ${t.border.color.strong}; background: ${t.background.tertiary}; }
  }
  &:active { transform: scale(${PRESS_SCALE}); }
  &:focus-visible { outline: 2px solid ${t.color.blue}; outline-offset: 2px; }
  h3 {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.semiBold};
    margin: 0;
  }
  div[data-stats] {
    display: grid;
    gap: ${t.spacing[2]} ${t.spacing[3]};
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  div[data-k] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
  div[data-v] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.lg};
    font-weight: ${t.font.weight.semiBold};
    font-variant-numeric: tabular-nums;
    line-height: 1.3;
  }
  div[data-v='positive'] { color: ${POSITIVE}; }
  div[data-v='caution'] { color: ${CAUTION}; }
`;

const StyledForm = styled.form`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(2, minmax(0, 1fr));
  @media (max-width: 640px) { grid-template-columns: 1fr; }
  label[data-check] {
    align-items: center;
    display: flex;
    font-size: ${t.font.size.sm};
    gap: ${t.spacing[2]};
  }
  div[data-span] { grid-column: 1 / -1; }
`;

const EMPTY_FORM = { name: '', id: '', email: '', fathomEmail: '', calendlyHostEmail: '', commissionRate: '10', commissioned: true };

export const ClosersPage = () => {
  const navigate = useNavigate();
  const isAdmin = useHasPermissionFlag(PermissionFlagType.WORKSPACE);
  const currentUser = useAtomStateValue(currentUserState);
  const [closers, setClosers] = useState<Closer[] | null>(null);
  const [stats, setStats] = useState<Record<string, CloserStats>>({});
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const list = await fetchClosers();
    setClosers(list);
    for (const closer of list.filter((c) => c.active)) {
      const [showUp, sales, commission] = await Promise.all([
        fetchCloserShowUp(closer.id).catch(() => null),
        fetchCloserSales(closer.id).catch(() => null),
        fetchCloserCommission(closer.id).catch(() => null),
      ]);
      setStats((previous) => ({ ...previous, [closer.id]: { showUp, sales, commission } }));
    }
  };
  useEffect(() => { load().catch((e) => setErr((e as Error).message)); }, []);

  const ownCloser = closers ? findOwnCloser(closers, currentUser?.email) : null;
  if (closers && !isAdmin && ownCloser) return <Navigate to={`/closers/${ownCloser.id}`} replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const rate = Number(form.commissionRate);
      await upsertCloser({
        id: form.id || slugifyCloserId(form.name),
        name: form.name,
        email: form.email || null,
        fathomEmail: form.fathomEmail || null,
        calendlyHostEmail: form.calendlyHostEmail || null,
        commissionRate: Number.isFinite(rate) ? rate / 100 : null,
        commissioned: form.commissioned,
      });
      setForm(EMPTY_FORM);
      setAdding(false);
      await load();
    } catch (e) {
      setErr('Failed to save closer: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const active = (closers ?? []).filter((c) => c.active);

  return (
    <StyledPage>
      <PageHeader title="Closers" Icon={IconUsers}>
        <StyledHeaderActions>
          <StyledMuted>{closers ? `${active.length} active` : ''}</StyledMuted>
          {isAdmin && <Button size="small" variant="secondary" Icon={IconPlus} title="Add closer" onClick={() => setAdding((v) => !v)} />}
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            {adding && (
              <StyledReveal>
                <StyledCard>
                  <StyledCardHead>
                    <StyledCardTitle>New closer</StyledCardTitle>
                    <StyledCardHint>Fathom email must match what their recordings are recorded by. Calendly host email links their bookings.</StyledCardHint>
                  </StyledCardHead>
                  <StyledForm onSubmit={submit}>
                    <StyledField>
                      <StyledLabel>Full name</StyledLabel>
                      <input required value={form.name} placeholder="e.g. Sam Carter" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, id: f.id || slugifyCloserId(e.target.value) }))} />
                    </StyledField>
                    <StyledField>
                      <StyledLabel>Id (slug)</StyledLabel>
                      <input required pattern="[a-z0-9_-]+" value={form.id} placeholder="sam" onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
                    </StyledField>
                    <StyledField>
                      <StyledLabel>CRM login email</StyledLabel>
                      <input type="email" value={form.email} placeholder="they only see their own page" onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    </StyledField>
                    <StyledField>
                      <StyledLabel>Fathom recorder email</StyledLabel>
                      <input type="email" value={form.fathomEmail} placeholder="as shown on their recordings" onChange={(e) => setForm((f) => ({ ...f, fathomEmail: e.target.value }))} />
                    </StyledField>
                    <StyledField>
                      <StyledLabel>Calendly host email</StyledLabel>
                      <input type="email" value={form.calendlyHostEmail} placeholder="the Calendly user their bookings land on" onChange={(e) => setForm((f) => ({ ...f, calendlyHostEmail: e.target.value }))} />
                    </StyledField>
                    <StyledField>
                      <StyledLabel>Commission %</StyledLabel>
                      <input type="number" min={0} max={100} step={0.5} value={form.commissionRate} onChange={(e) => setForm((f) => ({ ...f, commissionRate: e.target.value }))} />
                    </StyledField>
                    <label data-check>
                      <input type="checkbox" checked={form.commissioned} onChange={(e) => setForm((f) => ({ ...f, commissioned: e.target.checked }))} />
                      <span>On commission</span>
                    </label>
                    <div data-span>
                      <StyledRow>
                        <Button type="submit" size="small" variant="primary" accent="blue" title={saving ? 'Saving…' : 'Add closer'} disabled={saving || !form.name.trim()} />
                        <Button size="small" variant="tertiary" title="Cancel" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }} />
                        <StyledMuted>Calendly bookings for a new host start syncing once their host is added to the server's Calendly list.</StyledMuted>
                      </StyledRow>
                    </div>
                  </StyledForm>
                </StyledCard>
              </StyledReveal>
            )}

            {closers && active.length === 0 && <StyledNotice>No closers yet.</StyledNotice>}

            <StyledGrid3>
              {!closers && Array.from({ length: 2 }).map((_, i) => (
                <StyledCard key={i} style={{ minHeight: 160, justifyContent: 'space-between' }}>
                  <Skeleton width={120} height={14} />
                  <Skeleton width={90} height={22} />
                  <Skeleton width={90} height={22} />
                </StyledCard>
              ))}
              {active.map((closer) => {
                const s = stats[closer.id];
                const rate = s?.showUp?.rate ?? null;
                return (
                  <StyledCloserCard key={closer.id} role="link" tabIndex={0}
                    onClick={() => navigate(`/closers/${closer.id}`)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/closers/${closer.id}`); } }}>
                    <StyledRow style={{ justifyContent: 'space-between' }}>
                      <h3>{closer.name}</h3>
                      <StyledRow>
                        <StyledChip data-tone={closer.commissioned ? 'accent' : undefined}>{closer.commissioned ? `${Math.round(closer.commissionRate * 100)}% commission` : 'No commission'}</StyledChip>
                        {!closer.calendlyHostEmail && <StyledChip data-tone="caution" title="No Calendly host linked, appointments stay at zero">No calendar</StyledChip>}
                      </StyledRow>
                    </StyledRow>
                    <div data-stats>
                      <div><div data-k>Sales closed</div><div data-v>{s?.sales ? s.sales.total.toLocaleString() : <Skeleton width={40} />}</div></div>
                      <div><div data-k>Cash collected</div><div data-v>{s?.commission ? fmtUsd(s.commission.revenue) : <Skeleton width={60} />}</div></div>
                      <div><div data-k>Still active</div><div data-v="positive">{s?.sales ? `${s.sales.active} · ${fmtUsd(s.sales.mrr)}/mo` : <Skeleton width={70} />}</div></div>
                      <div><div data-k>Show-up rate</div><div data-v={rate != null ? (rate >= 55 ? 'positive' : 'caution') : ''}>{s?.showUp ? (rate != null ? `${rate}%` : '—') : <Skeleton width={40} />}</div></div>
                      {closer.commissioned && (
                        <div><div data-k>Commission outstanding</div><div data-v={s?.commission && s.commission.outstanding > 0 ? 'caution' : 'positive'}>{s?.commission ? fmtUsd2(s.commission.outstanding) : <Skeleton width={60} />}</div></div>
                      )}
                    </div>
                    <StyledMuted>{closer.email ?? 'No CRM login linked'}</StyledMuted>
                  </StyledCloserCard>
                );
              })}
            </StyledGrid3>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
