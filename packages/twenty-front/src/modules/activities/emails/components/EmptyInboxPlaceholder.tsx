import { useComposeEmailForTargetRecord } from '@/activities/emails/hooks/useComposeEmailForTargetRecord';
import { useTargetRecord } from '@/ui/layout/contexts/useTargetRecord';
import { Trans, useLingui } from '@lingui/react/macro';
import { IconMail } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { IconMessage } from 'twenty-ui/icon';
import { themeCssVariables as themeVars } from 'twenty-ui/theme-constants';

import { SmsComposePanel } from '@/page-layout/widgets/emails/components/WidgetActionSmsCompose';
import {
  AnimatedPlaceholder,
  AnimatedPlaceholderEmptyContainer,
  AnimatedPlaceholderEmptySubTitle,
  AnimatedPlaceholderEmptyTextContainer,
  AnimatedPlaceholderEmptyTitle,
} from 'twenty-ui/feedback';

const StyledButtons = styled.div`
  display: flex;
  gap: ${themeVars.spacing[2]};
`;

// The composer is positioned relative to this slot rather than floating off the header button.
const StyledComposerSlot = styled.div`
  position: relative;
  width: 320px;
  > div {
    position: static;
    width: 100%;
  }
`;

export const EmptyInboxPlaceholder = () => {
  const { t } = useLingui();
  const targetRecord = useTargetRecord();
  const [textOpen, setTextOpen] = useState(false);
  const canText = targetRecord.targetObjectNameSingular === 'person';
  const { openComposer, loading } =
    useComposeEmailForTargetRecord(targetRecord);

  return (
    <AnimatedPlaceholderEmptyContainer>
      <AnimatedPlaceholder type="emptyInbox" />
      <AnimatedPlaceholderEmptyTextContainer>
        <AnimatedPlaceholderEmptyTitle>
          <Trans>Empty Inbox</Trans>
        </AnimatedPlaceholderEmptyTitle>
        <AnimatedPlaceholderEmptySubTitle>
          <Trans>No email or text exchange has occurred with this record yet.</Trans>
        </AnimatedPlaceholderEmptySubTitle>
      </AnimatedPlaceholderEmptyTextContainer>
      <StyledButtons>
        <Button
          Icon={IconMail}
          title={t`Send Email`}
          variant="secondary"
          onClick={openComposer}
          disabled={loading}
        />
        {canText && (
          <Button
            Icon={IconMessage}
            title="Send Text"
            variant="secondary"
            onClick={() => setTextOpen((value) => !value)}
          />
        )}
      </StyledButtons>
      {canText && textOpen && (
        <StyledComposerSlot>
          <SmsComposePanel personId={targetRecord.id} onClose={() => setTextOpen(false)} />
        </StyledComposerSlot>
      )}
    </AnimatedPlaceholderEmptyContainer>
  );
};
