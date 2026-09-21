import { styled } from '@linaria/react';
import { IconLock } from 'twenty-ui/icon';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { PermissionFlagType } from '~/generated-metadata/graphql';
import { useHasPermissionFlag } from '@/settings/roles/hooks/useHasPermissionFlag';
import { PageHeader } from '@/ui/layout/page/components/PageHeader';
import { StyledPage } from '@/custom-pages/os/ui';

// The financial pages read the whole business; only workspace admins should see them.
export const useIsOsAdmin = () => useHasPermissionFlag(PermissionFlagType.WORKSPACE);

const StyledEmpty = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${t.spacing[3]};
  padding: ${t.spacing[10]} ${t.spacing[4]};
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.md};
  text-align: center;
`;

const StyledTitle = styled.div`
  color: ${t.font.color.primary};
  font-weight: ${t.font.weight.medium};
`;

type OsRestrictedProps = { title?: string };

export const OsRestricted = ({ title = 'Restricted' }: OsRestrictedProps) => (
  <StyledPage>
    <PageHeader title={title} Icon={IconLock} />
    <StyledEmpty>
      <IconLock size={20} />
      <StyledTitle>This page is for workspace admins.</StyledTitle>
      <div>Ask Jamal if you need access.</div>
    </StyledEmpty>
  </StyledPage>
);
