import { styled } from '@linaria/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconMessageCircle, IconRefresh } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import {
  fetchSmsThread,
  fetchSmsThreads,
  type SmsMessage,
  type SmsThread,
  type SmsThreadDetail,
  smsInboxAction,
  smsInboxReply,
} from '@/custom-pages/os/data';
import { PillButton, StyledBody, StyledCard, StyledChip, StyledError, StyledHeaderActions, StyledMuted, StyledPage, StyledTextLink } from '@/custom-pages/os/ui';

const POLL_MS = 15000;

type Filter = 'attention' | 'live' | 'human' | 'booked' | 'all';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'attention', label: 'Needs a reply' },
  { key: 'human', label: 'With a human' },
  { key: 'live', label: 'Melanie on it' },
  { key: 'booked', label: 'Booked' },
  { key: 'all', label: 'All' },
];

const STATUS_LABEL: Record<string, { label: string; tone?: 'positive' | 'caution' | 'accent' }> = {
  queued: { label: 'Queued' },
  opener_sent: { label: 'Melanie chasing', tone: 'accent' },
  replied: { label: 'Melanie replying', tone: 'accent' },
  handed_off: { label: 'Human', tone: 'caution' },
  booked: { label: 'Booked', tone: 'positive' },
  stopped: { label: 'Stopped' },
  opted_out: { label: 'Opted out' },
};

const ROUTE_LABEL: Record<string, string> = { dfy: 'DFY', demo: 'Demo', agency: 'Agency' };

const matches = (thread: SmsThread, filter: Filter) => {
  if (filter === 'all') return true;
  if (filter === 'attention') return thread.needs_attention;
  if (filter === 'human') return thread.status === 'handed_off';
  if (filter === 'live') return thread.status === 'opener_sent' || thread.status === 'replied';
  return thread.status === 'booked';
};

const when = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const StyledLayout = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: 360px minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const StyledList = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
`;

const StyledThreadRow = styled.button`
  align-items: flex-start;
  background: transparent;
  border: 0;
  border-bottom: 1px solid ${t.border.color.light};
  color: ${t.font.color.primary};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font-family: inherit;
  gap: ${t.spacing[1]};
  padding: ${t.spacing[3]} ${t.spacing[3]};
  text-align: left;
  transition: background 120ms ease-out;
  width: 100%;
  &:hover {
    background: ${t.background.transparent.light};
  }
  &[data-active='true'] {
    background: ${t.background.transparent.medium};
  }
`;

const StyledRowTop = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[2]};
  width: 100%;
`;

const StyledName = styled.span`
  flex: 1;
  font-weight: ${t.font.weight.medium};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledPreview = styled.span`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
`;

const StyledDot = styled.span`
  background: ${t.color.red};
  border-radius: 50%;
  display: inline-block;
  height: 8px;
  width: 8px;
`;

const StyledConversation = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const StyledMessages = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${t.spacing[2]};
  min-height: 0;
  overflow-y: auto;
  padding: ${t.spacing[3]} 0;
`;

const StyledBubble = styled.div`
  border-radius: ${t.border.radius.md};
  font-size: ${t.font.size.md};
  line-height: 1.45;
  max-width: 78%;
  padding: ${t.spacing[2]} ${t.spacing[3]};
  white-space: pre-wrap;
  word-break: break-word;
  &[data-side='in'] {
    align-self: flex-start;
    background: ${t.background.tertiary};
  }
  &[data-side='ai'] {
    align-self: flex-end;
    background: ${t.background.transparent.blue};
    border: 1px solid ${t.border.color.medium};
  }
  &[data-side='human'] {
    align-self: flex-end;
    background: ${t.background.transparent.success};
    border: 1px solid ${t.border.color.medium};
  }
`;

const StyledBubbleMeta = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin-top: 2px;
`;

const StyledComposer = styled.div`
  border-top: 1px solid ${t.border.color.light};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  padding-top: ${t.spacing[3]};
`;

const StyledTextarea = styled.textarea`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-family: inherit;
  font-size: ${t.font.size.md};
  min-height: 72px;
  padding: ${t.spacing[2]};
  resize: vertical;
  &:focus {
    border-color: ${t.color.blue};
    outline: none;
  }
`;

const StyledActions = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: flex;
  flex: 1;
  justify-content: center;
  min-height: 240px;
`;

const sideOf = (message: SmsMessage) => (message.direction === 'in' ? 'in' : message.kind === 'human' ? 'human' : 'ai');
const senderOf = (message: SmsMessage, name: string) => (message.direction === 'in' ? name : message.kind === 'human' ? 'You' : 'Melanie');

export const SmsPage = () => {
  const [threads, setThreads] = useState<SmsThread[] | null>(null);
  const [filter, setFilter] = useState<Filter>('attention');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SmsThreadDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const list = await fetchSmsThreads();
      setThreads(list);
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await fetchSmsThread(id));
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const timer = window.setInterval(() => {
      loadThreads();
      if (selectedId) loadDetail(selectedId);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads, loadDetail, selectedId]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [detail?.messages.length, selectedId]);

  const visible = useMemo(() => (threads ?? []).filter((thread) => matches(thread, filter)), [threads, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((entry) => [entry.key, (threads ?? []).filter((thread) => matches(thread, entry.key)).length])) as Record<Filter, number>, [threads]);

  // The first filter with anything in it is the useful default when the page opens.
  useEffect(() => {
    if (threads && counts.attention === 0 && filter === 'attention') setFilter(counts.human ? 'human' : counts.live ? 'live' : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads === null]);

  const send = async () => {
    if (!selectedId || !draft.trim()) return;
    setBusy(true);
    try {
      const result = await smsInboxReply(selectedId, draft.trim());
      if (!result.ok) throw new Error(result.reason || 'could not send');
      setDraft('');
      await Promise.all([loadDetail(selectedId), loadThreads()]);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: 'bot' | 'stop') => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const result = await smsInboxAction(selectedId, action);
      if (!result.ok) throw new Error(result.reason || 'could not update');
      await Promise.all([loadDetail(selectedId), loadThreads()]);
    } catch (actionError) {
      setError((actionError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = detail ? STATUS_LABEL[detail.status] ?? { label: detail.status } : null;
  const botLive = detail?.status === 'opener_sent' || detail?.status === 'replied';

  return (
    <StyledPage>
      <PageHeader title="SMS" Icon={IconMessageCircle}>
        <StyledHeaderActions>
          <Button size="small" variant="secondary" Icon={IconRefresh} title="Refresh" onClick={() => { loadThreads(); if (selectedId) loadDetail(selectedId); }} />
        </StyledHeaderActions>
      </PageHeader>
      <StyledBody>
        {error && <StyledError>{error}</StyledError>}
        <StyledLayout>
          <StyledCard style={{ display: 'flex', flexDirection: 'column', minHeight: 0, padding: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 12, borderBottom: `1px solid var(--t-border-color-light)` }}>
              {FILTERS.map((entry) => (
                <PillButton key={entry.key} active={filter === entry.key} onClick={() => setFilter(entry.key)} title={`${entry.label}${counts[entry.key] ? ` (${counts[entry.key]})` : ''}`} />
              ))}
            </div>
            <StyledList>
              {threads === null && <StyledEmpty>Loading…</StyledEmpty>}
              {threads !== null && visible.length === 0 && <StyledEmpty>Nothing here</StyledEmpty>}
              {visible.map((thread) => {
                const label = STATUS_LABEL[thread.status] ?? { label: thread.status };
                return (
                  <StyledThreadRow key={thread.id} type="button" data-active={thread.id === selectedId} onClick={() => setSelectedId(thread.id)}>
                    <StyledRowTop>
                      {thread.needs_attention && <StyledDot />}
                      <StyledName>{thread.name}</StyledName>
                      <StyledChip>{ROUTE_LABEL[thread.route] ?? thread.route}</StyledChip>
                      <StyledChip data-tone={label.tone}>{label.label}</StyledChip>
                    </StyledRowTop>
                    <StyledPreview>
                      {thread.last_direction === 'in' ? '' : 'Melanie: '}
                      {thread.last_body ?? 'No messages yet'}
                    </StyledPreview>
                    <StyledMuted style={{ fontSize: 11 }}>{when(thread.last_at)}{thread.closer ? ` · ${thread.closer}` : ''}</StyledMuted>
                  </StyledThreadRow>
                );
              })}
            </StyledList>
          </StyledCard>

          <StyledCard style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            {!detail && <StyledEmpty>Pick a conversation</StyledEmpty>}
            {detail && status && (
              <StyledConversation style={{ flex: 1 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBottom: 12, borderBottom: `1px solid var(--t-border-color-light)` }}>
                  <StyledTextLink to={`/object/person/${detail.person_id}`} style={{ fontWeight: 600, fontSize: 15 }}>{detail.name}</StyledTextLink>
                  <StyledMuted>{detail.phone}</StyledMuted>
                  <StyledChip>{ROUTE_LABEL[detail.route] ?? detail.route}</StyledChip>
                  <StyledChip data-tone={status.tone}>{status.label}</StyledChip>
                  {detail.closer && <StyledMuted>Closer {detail.closer}</StyledMuted>}
                  {detail.handoff_reason && detail.status === 'handed_off' && <StyledMuted>Why: {detail.handoff_reason}</StyledMuted>}
                </div>
                <StyledMessages>
                  {detail.messages.length === 0 && <StyledEmpty>No messages yet</StyledEmpty>}
                  {detail.messages.map((message) => (
                    <StyledBubble key={message.id} data-side={sideOf(message)}>
                      {message.body}
                      <StyledBubbleMeta>
                        {senderOf(message, detail.name)} · {when(message.at)}
                        {message.status && message.status !== 'dry-run' && message.direction === 'out' ? ` · ${message.status}` : ''}
                        {message.status === 'dry-run' ? ' · not sent (dry run)' : ''}
                      </StyledBubbleMeta>
                    </StyledBubble>
                  ))}
                  <div ref={bottomRef} />
                </StyledMessages>
                <StyledComposer>
                  <StyledTextarea
                    value={draft}
                    placeholder={detail.status === 'opted_out' ? 'This person opted out' : botLive ? 'Type to take over from Melanie…' : 'Reply as Melanie…'}
                    disabled={busy || detail.status === 'opted_out'}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
                    }}
                  />
                  <StyledActions>
                    <Button size="small" variant="primary" accent="blue" title={botLive ? 'Send and take over' : 'Send'} disabled={busy || !draft.trim() || detail.status === 'opted_out'} onClick={send} />
                    {detail.status === 'handed_off' && <Button size="small" variant="secondary" title="Hand back to Melanie" disabled={busy} onClick={() => act('bot')} />}
                    {detail.status === 'stopped' && <Button size="small" variant="secondary" title="Let Melanie continue" disabled={busy} onClick={() => act('bot')} />}
                    {detail.status !== 'stopped' && detail.status !== 'opted_out' && <Button size="small" variant="secondary" accent="danger" title="Stop texting" disabled={busy} onClick={() => act('stop')} />}
                    <StyledMuted style={{ marginLeft: 'auto', fontSize: 12 }}>Ctrl+Enter to send · texts go from {detail.from_number ?? 'the Twilio number'}</StyledMuted>
                  </StyledActions>
                </StyledComposer>
              </StyledConversation>
            )}
          </StyledCard>
        </StyledLayout>
      </StyledBody>
    </StyledPage>
  );
};
