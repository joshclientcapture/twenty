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
  StyledChip,
  StyledContent,
  StyledError,
  StyledHeaderActions,
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

// auto-fill keeps empty tracks, so one closer still gets a card-sized column rather than the full row.
const StyledCloserGrid = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
`;

const StyledCloserCard = styled.div`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  padding: ${t.spacing[4]};
  position: relative;
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
  div[data-actions] {
    display: flex;
    gap: ${t.spacing[1]};
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

/* Closer editor: one narrow column, labels above inputs, actions pinned at the bottom. */
const StyledEditorCard = styled.form`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[4]};
  max-width: 480px;
  padding: ${t.spacing[4]};
  h3 {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.semiBold};
    margin: 0;
  }
  p {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.sm};
    line-height: 1.5;
    margin: ${t.spacing[1]} 0 0;
  }
`;

const StyledFields = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
`;

const StyledFormField = styled.label`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[1]};
  span[data-label] {
    color: ${t.font.color.secondary};
    font-size: ${t.font.size.sm};
    font-weight: ${t.font.weight.medium};
  }
  span[data-hint] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
  }
  input {
    background: ${t.background.primary};
    border: 1px solid ${t.border.color.medium};
    border-radius: ${t.border.radius.sm};
    box-sizing: border-box;
    color: ${t.font.color.primary};
    font-family: inherit;
    font-size: ${t.font.size.md};
    height: 32px;
    outline: none;
    padding: 0 ${t.spacing[2]};
    transition: border-color 120ms ${EASE_OUT};
    width: 100%;
  }
  input:focus { border-color: ${t.border.color.blue}; }
  input[type='number'] { width: 120px; }
`;

const StyledToggle = styled.label`
  align-items: center;
  color: ${t.font.color.primary};
  cursor: pointer;
  display: flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[2]};
  input { accent-color: ${t.color.blue}; height: 14px; margin: 0; width: 14px; }
  span[data-hint] { color: ${t.font.color.tertiary}; }
`;

const StyledActions = styled.div`
  align-items: center;
  border-top: 1px solid ${t.border.color.light};
  display: flex;
  gap: ${t.spacing[2]};
  padding-top: ${t.spacing[3]};
`;

type CloserForm = { name: string; email: string; loginEmail: string; differentLogin: boolean; commissionRate: string; commissioned: boolean };

const EMPTY_FORM: CloserForm = { name: '', email: '', loginEmail: '', differentLogin: false, commissionRate: '10', commissioned: true };

const formFromCloser = (closer: Closer): CloserForm => {
  const workEmail = closer.fathomEmail ?? closer.calendlyHostEmail ?? closer.email ?? '';
  const differentLogin = !!closer.email && closer.email.toLowerCase() !== workEmail.toLowerCase();
  return {
    name: closer.name,
    email: workEmail,
    loginEmail: differentLogin ? closer.email ?? '' : '',
    differentLogin,
    commissionRate: String(Math.round(closer.commissionRate * 1000) / 10),
    commissioned: closer.commissioned,
  };
};

// The work email is the Fathom recorder, the Calendly host and (normally) the CRM login all at once.
const uniqueCloserId = (name: string, taken: Closer[]) => {
  const base = slugifyCloserId(name) || 'closer';
  let candidate = base;
  let suffix = 2;
  while (taken.some((closer) => closer.id === candidate)) candidate = `${base}${suffix++}`;
  return candidate;
};

export const ClosersPage = () => {
  const navigate = useNavigate();
  const isAdmin = useHasPermissionFlag(PermissionFlagType.WORKSPACE);
  const currentUser = useAtomStateValue(currentUserState);
  const [closers, setClosers] = useState<Closer[] | null>(null);
  const [stats, setStats] = useState<Record<string, CloserStats>>({});
  const [editor, setEditor] = useState<{ closer: Closer | null } | null>(null);
  const [form, setForm] = useState<CloserForm>(EMPTY_FORM);
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

  const openNew = () => { setForm(EMPTY_FORM); setEditor({ closer: null }); };
  const openEdit = (closer: Closer) => { setForm(formFromCloser(closer)); setEditor({ closer }); };
  const closeEditor = () => { setEditor(null); setForm(EMPTY_FORM); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const rate = Number(form.commissionRate);
      const workEmail = form.email.trim() || null;
      await upsertCloser({
        id: editor?.closer?.id ?? uniqueCloserId(form.name, closers ?? []),
        name: form.name.trim(),
        email: (form.differentLogin ? form.loginEmail.trim() : workEmail) || null,
        fathomEmail: workEmail,
        calendlyHostEmail: workEmail,
        commissionRate: Number.isFinite(rate) ? rate / 100 : null,
        commissioned: form.commissioned,
        active: true,
      });
      closeEditor();
      await load();
    } catch (e) {
      setErr('Failed to save closer: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // Removing deactivates rather than deletes, so past sales and commission stay attributed.
  const remove = async (closer: Closer) => {
    if (!window.confirm(`Remove ${closer.name} from Closers? Their history is kept; they just stop appearing here.`)) return;
    setErr(null);
    try {
      await upsertCloser({ id: closer.id, name: closer.name, active: false });
      if (editor?.closer?.id === closer.id) closeEditor();
      await load();
    } catch (e) {
      setErr('Failed to remove closer: ' + (e as Error).message);
    }
  };

  const active = (closers ?? []).filter((c) => c.active);
  const editing = editor?.closer ?? null;

  return (
    <StyledPage>
      <PageHeader title="Closers" Icon={IconUsers}>
        <StyledHeaderActions>
          <StyledMuted>{closers ? `${active.length} active` : ''}</StyledMuted>
          {isAdmin && <Button size="small" variant="secondary" Icon={IconPlus} title="Add closer" onClick={() => (editor && !editing ? closeEditor() : openNew())} />}
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        <SkeletonTheme baseColor={'var(--t-background-tertiary)'} highlightColor={'var(--t-background-transparent-lighter)'} borderRadius={4}>
          <StyledContent>
            {err && <StyledError>{err}</StyledError>}

            {editor && (
              <StyledReveal>
                <StyledEditorCard onSubmit={submit}>
                  <div>
                    <h3>{editing ? `Edit ${editing.name}` : 'New closer'}</h3>
                    <p>Their work email is what Fathom records under and what Calendly books on, so it links their calls, bookings and sales automatically.</p>
                  </div>
                  <StyledFields>
                    <StyledFormField>
                      <span data-label>Full name</span>
                      <input required autoFocus value={form.name} placeholder="Sam Carter" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    </StyledFormField>
                    <StyledFormField>
                      <span data-label>Work email</span>
                      <input required type="email" value={form.email} placeholder="sam@conversifi.io" onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    </StyledFormField>
                    <StyledToggle>
                      <input type="checkbox" checked={form.differentLogin} onChange={(e) => setForm((f) => ({ ...f, differentLogin: e.target.checked }))} />
                      <span>Logs into the CRM with a different email</span>
                    </StyledToggle>
                    {form.differentLogin && (
                      <StyledFormField>
                        <span data-label>CRM login email</span>
                        <input type="email" value={form.loginEmail} placeholder="sam@clientcapture.io" onChange={(e) => setForm((f) => ({ ...f, loginEmail: e.target.value }))} />
                        <span data-hint>With a login linked they only see their own page.</span>
                      </StyledFormField>
                    )}
                    <StyledToggle>
                      <input type="checkbox" checked={form.commissioned} onChange={(e) => setForm((f) => ({ ...f, commissioned: e.target.checked }))} />
                      <span>On commission</span>
                    </StyledToggle>
                    {form.commissioned && (
                      <StyledFormField>
                        <span data-label>Commission %</span>
                        <input type="number" min={0} max={100} step={0.5} value={form.commissionRate} onChange={(e) => setForm((f) => ({ ...f, commissionRate: e.target.value }))} />
                        <span data-hint>Of every payment attributed to them.</span>
                      </StyledFormField>
                    )}
                  </StyledFields>
                  <StyledActions>
                    <Button type="submit" size="small" variant="primary" accent="blue" title={saving ? 'Saving…' : editing ? 'Save changes' : 'Add closer'} disabled={saving || !form.name.trim() || !form.email.trim()} />
                    <Button size="small" variant="tertiary" title="Cancel" onClick={closeEditor} />
                    {editing && <div style={{ marginLeft: 'auto' }}><Button size="small" variant="tertiary" title="Remove" onClick={() => remove(editing)} /></div>}
                  </StyledActions>
                </StyledEditorCard>
              </StyledReveal>
            )}

            {closers && active.length === 0 && <StyledNotice>No closers yet.</StyledNotice>}

            <StyledCloserGrid>
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
                        {!closer.calendlyHostEmail && <StyledChip data-tone="caution" title="No work email linked, so appointments stay at zero">No calendar</StyledChip>}
                        {isAdmin && (
                          <div data-actions onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                            <Button size="small" variant="tertiary" title="Edit" onClick={() => openEdit(closer)} />
                            <Button size="small" variant="tertiary" title="Remove" onClick={() => remove(closer)} />
                          </div>
                        )}
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
                    <StyledMuted>{closer.fathomEmail ?? closer.email ?? 'No work email linked'}</StyledMuted>
                  </StyledCloserCard>
                );
              })}
            </StyledCloserGrid>
          </StyledContent>
        </SkeletonTheme>
      </StyledBody>
    </StyledPage>
  );
};
