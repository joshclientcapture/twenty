import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import { ViewFilterOperand } from 'twenty-shared/types';
import { isDefined } from 'twenty-shared/utils';
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconFolderSymlink,
  IconPencil,
  IconTrash,
} from 'twenty-ui/icon';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { useRemoveRecordFilter } from '@/object-record/record-filter/hooks/useRemoveRecordFilter';
import { useUpsertRecordFilter } from '@/object-record/record-filter/hooks/useUpsertRecordFilter';
import { useRecordIndexContextOrThrow } from '@/object-record/record-index/contexts/RecordIndexContext';
import { selectedRowIdsComponentSelector } from '@/object-record/record-table/states/selectors/selectedRowIdsComponentSelector';
import { useAtomComponentSelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomComponentSelectorValue';

type WorkflowRow = {
  __typename: 'Workflow';
  id: string;
  name: string;
  folder: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
};

type FolderRow = {
  __typename: 'WorkflowFolder';
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
};

type FolderNode = {
  path: string;
  name: string;
  children: FolderNode[];
  ownCount: number;
  totalCount: number;
};

export const FOLDER_SEPARATOR = ' / ';
const FILTER_ID = 'workflow-folder-tree';
const SELECTED_KEY = 'workflow-folder-tree:selected';
const COLLAPSED_KEY = 'workflow-folder-tree:collapsed';
const UNFILED = '__unfiled__';

const readStorage = <TValue,>(key: string, fallback: TValue): TValue => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TValue) : fallback;
  } catch {
    return fallback;
  }
};
const writeStorage = (key: string, value: unknown) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows may refuse; the tree still works for the session.
  }
};

export const normalizeFolderPath = (value: string) =>
  value
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join(FOLDER_SEPARATOR);

const parentOf = (path: string) => {
  const segments = path.split(FOLDER_SEPARATOR);
  segments.pop();
  return segments.join(FOLDER_SEPARATOR);
};

const isWithin = (folder: string | null, path: string) =>
  isDefined(folder) && (folder === path || folder.startsWith(path + FOLDER_SEPARATOR));

const buildTree = (paths: string[], workflows: WorkflowRow[]): FolderNode[] => {
  const byPath = new Map<string, FolderNode>();
  const ensure = (path: string): FolderNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const node: FolderNode = { path, name: path.split(FOLDER_SEPARATOR).pop() ?? path, children: [], ownCount: 0, totalCount: 0 };
    byPath.set(path, node);
    const parent = parentOf(path);
    if (parent) ensure(parent).children.push(node);
    return node;
  };
  for (const path of paths) ensure(path);
  for (const workflow of workflows) {
    const folder = workflow.folder ? normalizeFolderPath(workflow.folder) : '';
    if (!folder) continue;
    ensure(folder).ownCount += 1;
    let cursor: string | null = folder;
    while (cursor) {
      const node = byPath.get(cursor);
      if (node) node.totalCount += 1;
      cursor = parentOf(cursor) || null;
    }
  }
  const sortNodes = (nodes: FolderNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((node) => sortNodes(node.children));
  };
  const roots = [...byPath.values()].filter((node) => !parentOf(node.path));
  sortNodes(roots);
  return roots;
};

// A folder tree for the Workflows page: folders come from each workflow's "folder" path, the
// selection filters the table through the normal view filters, and selected rows can be moved.
export const WorkflowFolderTree = () => {
  const { recordIndexId, objectMetadataItem } = useRecordIndexContextOrThrow();
  const folderField = objectMetadataItem.fields.find((field) => field.name === 'folder');
  const { upsertRecordFilter } = useUpsertRecordFilter(recordIndexId);
  const { removeRecordFilter } = useRemoveRecordFilter(recordIndexId);
  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord: createFolderRecord } = useCreateOneRecord<FolderRow>({ objectNameSingular: 'workflowFolder' });
  const { deleteOneRecord: deleteFolderRecord } = useDeleteOneRecord({ objectNameSingular: 'workflowFolder' });
  // Folders are records, so an empty folder is visible to everyone until it is deleted.
  const { records: folderRecords } = useFindManyRecords<FolderRow>({
    objectNameSingular: 'workflowFolder',
    recordGqlFields: { id: true, name: true },
    limit: 500,
  });
  const selectedRowIds = useAtomComponentSelectorValue(selectedRowIdsComponentSelector, recordIndexId);

  const { records: workflows } = useFindManyRecords<WorkflowRow>({
    objectNameSingular: 'workflow',
    recordGqlFields: { id: true, name: true, folder: true },
    limit: 500,
  });

  const [selected, setSelected] = useState<string>(() => readStorage(SELECTED_KEY, ''));
  const [collapsed, setCollapsed] = useState<string[]>(() => readStorage(COLLAPSED_KEY, []));
  const [editing, setEditing] = useState<{ mode: 'new' | 'rename'; path: string; draft: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const folderPaths = useMemo(() => folderRecords.map((record) => normalizeFolderPath(record.name)).filter(Boolean), [folderRecords]);
  const roots = useMemo(() => buildTree(folderPaths, workflows), [folderPaths, workflows]);
  const unfiledCount = workflows.filter((workflow) => !workflow.folder || !normalizeFolderPath(workflow.folder)).length;

  // The filter lives in the view bar state, so the table, search and other filters keep working.
  useEffect(() => {
    if (!folderField) return;
    if (selected === '') {
      removeRecordFilter({ recordFilterId: FILTER_ID });
      return;
    }
    upsertRecordFilter({
      id: FILTER_ID,
      fieldMetadataId: folderField.id,
      type: 'TEXT',
      label: 'Folder',
      operand: selected === UNFILED ? ViewFilterOperand.IS_EMPTY : ViewFilterOperand.CONTAINS,
      value: selected === UNFILED ? '' : selected,
      displayValue: selected === UNFILED ? 'No folder' : selected,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, folderField?.id]);

  const select = (path: string) => {
    setSelected(path);
    writeStorage(SELECTED_KEY, path);
  };
  const toggleCollapsed = (path: string) => {
    const next = collapsed.includes(path) ? collapsed.filter((item) => item !== path) : [...collapsed, path];
    setCollapsed(next);
    writeStorage(COLLAPSED_KEY, next);
  };
  const ensureFolderRecord = async (path: string) => {
    if (folderRecords.some((record) => normalizeFolderPath(record.name) === path)) return;
    await createFolderRecord({ name: path });
  };
  const renameFolderRecords = async (oldPath: string, newPath: string) => {
    for (const record of folderRecords) {
      const current = normalizeFolderPath(record.name);
      if (!isWithin(current, oldPath)) continue;
      await updateOneRecord({ objectNameSingular: 'workflowFolder', idToUpdate: record.id, updateOneRecordInput: { name: newPath + current.slice(oldPath.length) } });
    }
  };
  const deleteFolderRecords = async (path: string) => {
    for (const record of folderRecords) {
      if (isWithin(normalizeFolderPath(record.name), path)) await deleteFolderRecord(record.id);
    }
  };

  const moveWorkflows = async (ids: string[], folder: string) => {
    setBusy(true);
    try {
      for (const id of ids) {
        await updateOneRecord({ objectNameSingular: 'workflow', idToUpdate: id, updateOneRecordInput: { folder: folder || null } });
      }
    } finally {
      setBusy(false);
    }
  };

  const commitEdit = async () => {
    if (!editing) return;
    const draft = normalizeFolderPath(editing.draft);
    if (!draft) {
      setEditing(null);
      return;
    }
    if (editing.mode === 'new') {
      const path = editing.path ? `${editing.path}${FOLDER_SEPARATOR}${draft}` : draft;
      setBusy(true);
      try {
        await ensureFolderRecord(path);
      } finally {
        setBusy(false);
      }
      select(path);
    } else {
      const oldPath = editing.path;
      const newPath = parentOf(oldPath) ? `${parentOf(oldPath)}${FOLDER_SEPARATOR}${draft}` : draft;
      if (newPath !== oldPath) {
        const affected = workflows.filter((workflow) => isWithin(workflow.folder ? normalizeFolderPath(workflow.folder) : null, oldPath));
        setBusy(true);
        try {
          for (const workflow of affected) {
            const current = normalizeFolderPath(workflow.folder ?? '');
            await updateOneRecord({ objectNameSingular: 'workflow', idToUpdate: workflow.id, updateOneRecordInput: { folder: newPath + current.slice(oldPath.length) } });
          }
        } finally {
          setBusy(false);
        }
        setBusy(true);
        try {
          await renameFolderRecords(oldPath, newPath);
          await ensureFolderRecord(newPath);
        } finally {
          setBusy(false);
        }
        if (isWithin(selected, oldPath)) select(newPath + selected.slice(oldPath.length));
      }
    }
    setEditing(null);
  };

  const deleteFolder = async (path: string) => {
    // Workflows inside move up one level; nothing is ever deleted but the folder name.
    const parent = parentOf(path);
    const affected = workflows.filter((workflow) => isWithin(workflow.folder ? normalizeFolderPath(workflow.folder) : null, path));
    setBusy(true);
    try {
      for (const workflow of affected) {
        const current = normalizeFolderPath(workflow.folder ?? '');
        const rest = current.slice(path.length).replace(new RegExp(`^${FOLDER_SEPARATOR.trim()}\\s*`), '');
        const target = [parent, rest.trim()].filter(Boolean).join(FOLDER_SEPARATOR);
        await updateOneRecord({ objectNameSingular: 'workflow', idToUpdate: workflow.id, updateOneRecordInput: { folder: target || null } });
      }
    } finally {
      setBusy(false);
    }
    setBusy(true);
    try {
      await deleteFolderRecords(path);
    } finally {
      setBusy(false);
    }
    if (isWithin(selected, path)) select(parent);
  };

  const renderNode = (node: FolderNode, depth: number) => {
    const isCollapsed = collapsed.includes(node.path);
    const isSelected = selected === node.path;
    return (
      <div key={node.path}>
        <StyledRow data-selected={isSelected} data-depth={depth} onClick={() => select(node.path)} title={node.path}>
          <StyledCaret
            data-visible={node.children.length > 0}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(node.path);
            }}
          >
            {isCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
          </StyledCaret>
          {isSelected ? <IconFolderOpen size={14} /> : <IconFolder size={14} />}
          {editing?.mode === 'rename' && editing.path === node.path ? (
            <StyledInput
              autoFocus
              value={editing.draft}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
              onBlur={() => void commitEdit()}
            />
          ) : (
            <StyledName>{node.name}</StyledName>
          )}
          <StyledCount>{node.totalCount}</StyledCount>
          <StyledActions onClick={(event) => event.stopPropagation()}>
            {selectedRowIds.length > 0 && (
              <StyledIconButton title={`Move ${selectedRowIds.length} selected here`} disabled={busy} onClick={() => void moveWorkflows(selectedRowIds, node.path)}>
                <IconFolderSymlink size={13} />
              </StyledIconButton>
            )}
            <StyledIconButton title="New subfolder" onClick={() => setEditing({ mode: 'new', path: node.path, draft: '' })}>
              <IconFolderPlus size={13} />
            </StyledIconButton>
            <StyledIconButton title="Rename" onClick={() => setEditing({ mode: 'rename', path: node.path, draft: node.name })}>
              <IconPencil size={13} />
            </StyledIconButton>
            <StyledIconButton title="Delete folder (workflows move up a level)" disabled={busy} onClick={() => void deleteFolder(node.path)}>
              <IconTrash size={13} />
            </StyledIconButton>
          </StyledActions>
        </StyledRow>
        {editing?.mode === 'new' && editing.path === node.path && (
          <StyledRow data-depth={depth + 1} data-selected={false}>
            <StyledCaret data-visible={false} />
            <IconFolder size={14} />
            <StyledInput
              autoFocus
              placeholder="Folder name"
              value={editing.draft}
              onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
              onBlur={() => void commitEdit()}
            />
          </StyledRow>
        )}
        {!isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  if (!folderField) return null;

  return (
    <StyledPanel>
      <StyledHeader>
        <span>Folders</span>
        <StyledIconButton title="New folder" onClick={() => setEditing({ mode: 'new', path: '', draft: '' })}>
          <IconFolderPlus size={14} />
        </StyledIconButton>
      </StyledHeader>
      <StyledScroll>
        <StyledRow data-selected={selected === ''} data-depth={0} onClick={() => select('')}>
          <StyledCaret data-visible={false} />
          <IconFolderOpen size={14} />
          <StyledName>All workflows</StyledName>
          <StyledCount>{workflows.length}</StyledCount>
        </StyledRow>
        {editing?.mode === 'new' && editing.path === '' && (
          <StyledRow data-depth={0} data-selected={false}>
            <StyledCaret data-visible={false} />
            <IconFolder size={14} />
            <StyledInput
              autoFocus
              placeholder="Folder name"
              value={editing.draft}
              onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
              onBlur={() => void commitEdit()}
            />
          </StyledRow>
        )}
        {roots.map((node) => renderNode(node, 0))}
        <StyledRow data-selected={selected === UNFILED} data-depth={0} onClick={() => select(UNFILED)}>
          <StyledCaret data-visible={false} />
          <IconFolder size={14} />
          <StyledName>No folder</StyledName>
          <StyledCount>{unfiledCount}</StyledCount>
          <StyledActions onClick={(event) => event.stopPropagation()}>
            {selectedRowIds.length > 0 && (
              <StyledIconButton title={`Remove ${selectedRowIds.length} selected from their folder`} disabled={busy} onClick={() => void moveWorkflows(selectedRowIds, '')}>
                <IconFolderSymlink size={13} />
              </StyledIconButton>
            )}
          </StyledActions>
        </StyledRow>
      </StyledScroll>
      <StyledFooter>
        {selectedRowIds.length > 0
          ? `${selectedRowIds.length} selected: use the move icon on a folder`
          : 'Tick workflows in the table, then move them from here'}
      </StyledFooter>
    </StyledPanel>
  );
};

const StyledPanel = styled.aside`
  border-right: 1px solid ${t.border.color.light};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  height: 100%;
  min-width: 0;
  width: 232px;
`;

const StyledHeader = styled.div`
  align-items: center;
  color: ${t.font.color.light};
  display: flex;
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.semiBold};
  justify-content: space-between;
  letter-spacing: 0.04em;
  padding: ${t.spacing[2]} ${t.spacing[2]} ${t.spacing[1]} ${t.spacing[3]};
  text-transform: uppercase;
`;

const StyledScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 ${t.spacing[1]};
`;

const StyledRow = styled.div`
  align-items: center;
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.secondary};
  cursor: pointer;
  display: flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[1]};
  height: 28px;
  padding-left: calc(${t.spacing[1]} + var(--depth, 0) * 14px);
  padding-right: ${t.spacing[1]};
  transition: background-color 120ms ease-out;
  user-select: none;

  &[data-depth='1'] { --depth: 1; }
  &[data-depth='2'] { --depth: 2; }
  &[data-depth='3'] { --depth: 3; }
  &[data-depth='4'] { --depth: 4; }

  @media (hover: hover) {
    &:hover {
      background-color: ${t.background.transparent.light};
    }
  }

  &[data-selected='true'] {
    background-color: ${t.background.transparent.medium};
    color: ${t.font.color.primary};
  }

  &:active {
    transform: scale(0.99);
  }
`;

const StyledCaret = styled.span`
  align-items: center;
  color: ${t.font.color.light};
  display: inline-flex;
  flex-shrink: 0;
  height: 14px;
  justify-content: center;
  width: 14px;

  &[data-visible='false'] {
    visibility: hidden;
  }
`;

const StyledName = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledCount = styled.span`
  color: ${t.font.color.light};
  flex-shrink: 0;
  font-size: ${t.font.size.xs};
  font-variant-numeric: tabular-nums;
`;

const StyledActions = styled.span`
  display: none;
  flex-shrink: 0;
  gap: 2px;

  ${StyledRow}:hover & {
    display: inline-flex;
  }
`;

const StyledIconButton = styled.button`
  align-items: center;
  background: none;
  border: none;
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.light};
  cursor: pointer;
  display: inline-flex;
  height: 20px;
  justify-content: center;
  padding: 0;
  width: 20px;

  &:hover {
    background-color: ${t.background.transparent.medium};
    color: ${t.font.color.primary};
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const StyledInput = styled.input`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  flex: 1;
  font-size: ${t.font.size.sm};
  height: 22px;
  min-width: 0;
  outline: none;
  padding: 0 ${t.spacing[1]};
`;

const StyledFooter = styled.div`
  border-top: 1px solid ${t.border.color.light};
  color: ${t.font.color.light};
  font-size: ${t.font.size.xs};
  line-height: 1.4;
  padding: ${t.spacing[2]} ${t.spacing[3]};
`;
