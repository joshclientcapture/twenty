import { allowRequestsToTwentyIconsState } from '@/client-config/states/allowRequestsToTwentyIcons';
import { useNumberFormat } from '@/localization/hooks/useNumberFormat';
import { ObjectMetadataIcon } from '@/object-metadata/components/ObjectMetadataIcon';
import { useObjectMetadataItem } from '@/object-metadata/hooks/useObjectMetadataItem';
import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { useFindOneRecord } from '@/object-record/hooks/useFindOneRecord';
import { useIsRecordFieldReadOnly } from '@/object-record/read-only/hooks/useIsRecordFieldReadOnly';
import { FieldContext } from '@/object-record/record-field/ui/contexts/FieldContext';
import { useRecordShowContainerActions } from '@/object-record/record-show/hooks/useRecordShowContainerActions';
import { useRecordShowPageGroupByBreadcrumbInfo } from '@/object-record/record-show/hooks/useRecordShowPageGroupByBreadcrumbInfo';
import { useRecordShowPagePagination } from '@/object-record/record-show/hooks/useRecordShowPagePagination';
import { getRecordShowPageBreadcrumbPaginationLabel } from '@/object-record/record-show/utils/getRecordShowPageBreadcrumbPaginationLabel';
import { recordStoreIdentifierFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreIdentifierFamilySelector';
import { RecordTitleCell } from '@/object-record/record-title-cell/components/RecordTitleCell';
import { RecordTitleCellContainerType } from '@/object-record/record-title-cell/types/RecordTitleCellContainerType';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { styled } from '@linaria/react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppPath } from 'twenty-shared/types';
import { FieldMetadataType } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import { Avatar } from 'twenty-ui/data-display';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { getAbsoluteImageUrl } from '~/utils/image/getAbsoluteImageUrl';

const StyledEditableTitleContainer = styled.div`
  align-items: center;
  display: flex;
  flex-direction: row;
  overflow-x: hidden;
  width: 100%;
`;

const StyledEditableTitlePrefix = styled.div`
  align-items: center;
  color: ${themeCssVariables.font.color.tertiary};
  cursor: pointer;
  display: flex;
  flex-direction: row;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledBreadcrumbPrefixObjectIcon = styled.div`
  display: flex;
  flex-shrink: 0;
  opacity: 0.64;
`;

const StyledTitle = styled.div<{ isEmphasized: boolean }>`
  font-size: ${({ isEmphasized }) =>
    isEmphasized ? themeCssVariables.font.size.md : 'inherit'};
  font-weight: ${({ isEmphasized }) =>
    isEmphasized ? themeCssVariables.font.weight.semiBold : 'inherit'};
  max-width: 100%;
  overflow: hidden;
  width: fit-content;
`;

const StyledAvatarContainer = styled.div`
  align-items: center;
  background: ${themeCssVariables.background.transparent.light};
  border-radius: ${themeCssVariables.border.radius.sm};
  display: flex;
  flex-shrink: 0;
  justify-content: center;
  margin-right: ${themeCssVariables.spacing[0.5]};
  padding: ${themeCssVariables.spacing[1]};
`;

const StyledPaginationInformation = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
`;

export const ObjectRecordShowPageBreadcrumb = ({
  objectNameSingular,
  objectRecordId,
  objectLabel,
  labelIdentifierFieldMetadataItem,
}: {
  objectNameSingular: string;
  objectRecordId: string;
  objectLabel: string;
  labelIdentifierFieldMetadataItem?: FieldMetadataItem;
}) => {
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  const isMobile = useIsMobile();

  // Workflows carry a folder path (the Workflows page is a file explorer); the crumbs lead back into it.
  const isWorkflow = objectNameSingular === 'workflow';
  const navigate = useNavigate();
  const { loading, record } = useFindOneRecord({
    objectNameSingular,
    objectRecordId,
    recordGqlFields: {
      [labelIdentifierFieldMetadataItem?.name ?? 'name']: true,
      ...(isWorkflow ? { folder: true } : {}),
    },
  });
  const folderSegments = isWorkflow
    ? String((record as { folder?: string | null } | undefined)?.folder ?? '')
        .split('/')
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0)
    : [];

  const { objectMetadataItem } = useObjectMetadataItem({
    objectNameSingular,
  });

  const allowRequestsToTwentyIcons = useAtomStateValue(
    allowRequestsToTwentyIconsState,
  );

  const recordIdentifier = useAtomFamilySelectorValue(
    recordStoreIdentifierFamilySelector,
    {
      recordId: objectRecordId,
      allowRequestsToTwentyIcons,
    },
  );

  const { useUpdateOneObjectRecordMutation } = useRecordShowContainerActions({
    objectNameSingular,
  });

  const isLabelIdentifierReadOnly = useIsRecordFieldReadOnly({
    recordId: objectRecordId,
    objectMetadataId: objectMetadataItem.id,
    fieldMetadataId: labelIdentifierFieldMetadataItem?.id ?? '',
  });

  const { navigateToIndexView, rankInView, totalCount } =
    useRecordShowPagePagination(objectNameSingular, objectRecordId);

  const { viewName, groupValueLabel, isGroupByActive, isGroupValueLoading } =
    useRecordShowPageGroupByBreadcrumbInfo({
      objectNameSingular,
      objectRecordId,
    });

  const { formatNumber } = useNumberFormat();

  const paginationInformation = getRecordShowPageBreadcrumbPaginationLabel({
    rank: formatNumber(rankInView + 1),
    total: formatNumber(totalCount),
    isGroupByActive,
    viewName,
    isGroupValueLoading,
    groupValueLabel,
  });

  if (!loading && isInitialLoad) {
    setIsInitialLoad(false);
  }

  if (isInitialLoad && loading) {
    return null;
  }

  return (
    <StyledEditableTitleContainer data-testid="top-bar-title">
      {isMobile ? (
        isDefined(recordIdentifier) && (
          <StyledAvatarContainer>
            <Avatar
              avatarUrl={getAbsoluteImageUrl(recordIdentifier.avatarUrl)}
              placeholder={recordIdentifier.name}
              placeholderColorSeed={objectRecordId}
              size="md"
              type={recordIdentifier.avatarType}
            />
          </StyledAvatarContainer>
        )
      ) : (
        <StyledEditableTitlePrefix
          onClick={() => {
            navigateToIndexView();
          }}
        >
          <StyledBreadcrumbPrefixObjectIcon>
            <ObjectMetadataIcon objectMetadataItem={objectMetadataItem} />
          </StyledBreadcrumbPrefixObjectIcon>
          {objectLabel}
          <span>{' / '}</span>
        </StyledEditableTitlePrefix>
      )}
      {folderSegments.map((segment, index) => {
        const path = folderSegments.slice(0, index + 1).join(' / ');
        return (
          <StyledEditableTitlePrefix
            key={path}
            onClick={() => {
              navigate(
                `${AppPath.RecordIndexPage.replace(':objectNamePlural', objectMetadataItem.namePlural)}?folder=${encodeURIComponent(path)}`,
              );
            }}
          >
            {segment}
            <span>{' / '}</span>
          </StyledEditableTitlePrefix>
        );
      })}
      <StyledTitle isEmphasized={isMobile}>
        <FieldContext.Provider
          value={{
            recordId: objectRecordId,
            isLabelIdentifier: false,
            fieldDefinition: {
              type:
                labelIdentifierFieldMetadataItem?.type ||
                FieldMetadataType.TEXT,
              iconName: '',
              fieldMetadataId: labelIdentifierFieldMetadataItem?.id ?? '',
              label: labelIdentifierFieldMetadataItem?.label || '',
              metadata: {
                fieldName: labelIdentifierFieldMetadataItem?.name || '',
                objectMetadataNameSingular: objectNameSingular,
              },
              defaultValue: labelIdentifierFieldMetadataItem?.defaultValue,
            },
            useUpdateRecord: useUpdateOneObjectRecordMutation,
            isCentered: false,
            isDisplayModeFixHeight: true,
            isRecordFieldReadOnly: isLabelIdentifierReadOnly,
          }}
        >
          <RecordTitleCell
            sizeVariant={isMobile ? 'sm' : 'xs'}
            containerType={RecordTitleCellContainerType.PageHeader}
          />
        </FieldContext.Provider>
      </StyledTitle>
      {!isMobile && (
        <StyledPaginationInformation>
          {paginationInformation}
        </StyledPaginationInformation>
      )}
    </StyledEditableTitleContainer>
  );
};
