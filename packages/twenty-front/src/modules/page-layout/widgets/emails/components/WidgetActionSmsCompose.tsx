import { styled } from '@linaria/react';
import { useState } from 'react';
import { IconMessage } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { osPost } from '@/custom-pages/os/transport';
import { WidgetActionEmailCompose } from '@/page-layout/widgets/emails/components/WidgetActionEmailCompose';
import { WidgetCardHeaderActionButton } from '@/page-layout/widgets/widget-card/components/WidgetCardHeaderActionButton';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';

const StyledAnchor = styled.div`
  position: relative;
`;

const StyledPanel = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-shadow: ${t.boxShadow.strong};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  padding: ${t.spacing[3]};
  position: absolute;
  right: 0;
  top: calc(100% + ${t.spacing[1]});
  width: 320px;
  z-index: 20;
`;

const StyledTitle = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
`;

const StyledTextarea = styled.textarea`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-family: inherit;
  font-size: ${t.font.size.md};
  min-height: 84px;
  padding: ${t.spacing[2]};
  resize: vertical;
  &:focus {
    border-color: ${t.color.blue};
    outline: none;
  }
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[2]};
  justify-content: flex-end;
`;

const StyledNote = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin-right: auto;
`;

const StyledError = styled.div`
  color: ${t.color.red};
  font-size: ${t.font.size.xs};
`;

// Sends a text to the person from the Twilio number. The reply lands in this same Messages tab, and
// Melanie stops answering that conversation once a human has written in it.
export const WidgetActionSmsCompose = () => {
  const targetRecord = useTargetRecord();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  if (targetRecord.targetObjectNameSingular !== 'person') return null;

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await osPost<{ ok: string; reason: string; dryRun?: string }>('sms-inbox/text', { personId: targetRecord.id, body: body.trim() });
      if (!result.ok) throw new Error(result.reason || 'could not send');
      setSent(result.dryRun ? 'Logged (texting is still in dry run)' : 'Sent');
      setBody('');
      window.setTimeout(() => {
        setSent(null);
        setOpen(false);
      }, 1500);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <StyledAnchor>
      <WidgetCardHeaderActionButton Icon={IconMessage} label="Send text" onClick={() => setOpen((value) => !value)} />
      {open && (
        <StyledPanel onClick={(event) => event.stopPropagation()}>
          <StyledTitle>Text this person</StyledTitle>
          <StyledTextarea
            autoFocus
            value={body}
            placeholder="Type your text…"
            disabled={busy}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
              if (event.key === 'Escape') setOpen(false);
            }}
          />
          {error && <StyledError>{error}</StyledError>}
          <StyledRow>
            <StyledNote>{sent ?? `${body.length} characters · Ctrl+Enter to send`}</StyledNote>
            <Button size="small" variant="secondary" title="Cancel" disabled={busy} onClick={() => setOpen(false)} />
            <Button size="small" variant="primary" accent="blue" title="Send" disabled={busy || !body.trim()} onClick={send} />
          </StyledRow>
        </StyledPanel>
      )}
    </StyledAnchor>
  );
};

// The Messages widget offers both channels: email through Twenty's composer, text through Twilio.
export const WidgetActionMessages = () => (
  <>
    <WidgetActionEmailCompose />
    <WidgetActionSmsCompose />
  </>
);
