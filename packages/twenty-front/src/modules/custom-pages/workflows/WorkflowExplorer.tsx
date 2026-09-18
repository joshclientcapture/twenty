import { styled } from '@linaria/react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { isDefined } from 'twenty-shared/utils';
import { Tag } from 'twenty-ui/data-display';
import {
  IconArrowBackUp,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconFolderSymlink,
  IconPencil,
  IconSearch,
  IconSettingsAutomation,
  IconTrash,
} from 'twenty-ui/icon';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { useCreateOneRecord } from '@/object-record/hooks/useCreateOneRecord';
import { useDeleteManyRecords } from '@/object-record/hooks/useDeleteManyRecords';
import { useDeleteOneRecord } from '@/object-record/hooks/useDeleteOneRecord';
import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';

type WorkflowRow = {
  __typename: 'Workflow';
  id: string;
  name: string;
  folder: string | null;
  statuses: string[] | null;
  position: number | null;
  updatedAt: string;
  createdAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
};

type FolderRow = {
  __typename: 'WorkflowFolder';
  id: string;
  name: string;
  position: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
};

type FolderItem = { path: string; name: string; position: number | null };

type Menu =
  | { kind: 'folder'; path: string; x: number; y: number }
  | { kind: 'workflow'; ids: string[]; x: number; y: number }
  | { kind: 'background'; x: number; y: number };

type Editing = { mode: 'new' | 'rename'; path: string; draft: string } | null;

type DropZone = 'into' | 'before' | 'after';
type DropTarget = { key: string; zone: DropZone } | null;
type DragPayload = { workflows?: string[]; folder?: string };
type RowKind = 'folder' | 'workflow' | 'container';

export const FOLDER_SEPARATOR = ' / ';
const QUERY_KEY = 'folder';
const DRAG_MIME = 'application/x-workflow-ids';

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

const lastSegment = (path: string) =>
  path.split(FOLDER_SEPARATOR).pop() ?? path;

const isWithin = (folder: string, path: string) =>
  path === '' || folder === path || folder.startsWith(path + FOLDER_SEPARATOR);

const folderOf = (workflow: WorkflowRow) =>
  normalizeFolderPath(workflow.folder ?? '');

const statusMeta = (
  statuses: string[] | null,
): { label: string; color: 'green' | 'yellow' | 'gray' } => {
  if (statuses?.includes('ACTIVE')) return { label: 'Active', color: 'green' };
  if (statuses?.includes('DRAFT')) return { label: 'Draft', color: 'yellow' };
  return { label: 'Off', color: 'gray' };
};

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
};

// Manual order first (lowest position on top), unordered items after, alphabetically.
const byPositionThenName = <
  TItem extends { position: number | null; name: string },
>(
  a: TItem,
  b: TItem,
) => {
  if (a.position !== null && b.position !== null && a.position !== b.position)
    return a.position - b.position;
  if (a.position !== null && b.position === null) return -1;
  if (a.position === null && b.position !== null) return 1;
  return a.name.localeCompare(b.name);
};

// Positions are floats: an item dropped between two neighbours takes their midpoint, so one write
// per moved item. Callers number unordered items first so the midpoint has real neighbours.
const positionBetween = (
  ordered: { position: number | null }[],
  anchorIndex: number,
  zone: 'before' | 'after',
) => {
  const index = zone === 'before' ? anchorIndex : anchorIndex + 1;
  const previous = index > 0 ? ordered[index - 1].position : null;
  const next = index < ordered.length ? ordered[index].position : null;
  if (previous !== null && next !== null)
    return { position: (previous + next) / 2, next };
  if (previous !== null) return { position: previous + 1, next };
  if (next !== null) return { position: next - 1, next };
  return { position: 0, next };
};

// A file-explorer view of the Workflows object: folders are rows you open, workflows drag onto
// folders (or onto the "up" row), drop between rows to reorder, and right-click menus cover move,
// rename, create and delete.
export const WorkflowExplorer = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const current = normalizeFolderPath(searchParams.get(QUERY_KEY) ?? '');

  const { updateOneRecord } = useUpdateOneRecord();
  const { createOneRecord: createFolderRecord } = useCreateOneRecord<FolderRow>(
    { objectNameSingular: 'workflowFolder' },
  );
  const { deleteOneRecord: deleteFolderRecord } = useDeleteOneRecord({
    objectNameSingular: 'workflowFolder',
  });
  const { deleteManyRecords: deleteWorkflows } = useDeleteManyRecords({
    objectNameSingular: 'workflow',
  });
  const {
    records: workflows,
    loading,
    refetch: refetchWorkflows,
  } = useFindManyRecords<WorkflowRow>({
    objectNameSingular: 'workflow',
    recordGqlFields: {
      id: true,
      name: true,
      folder: true,
      statuses: true,
      position: true,
      updatedAt: true,
    },
    limit: 500,
  });
  const { records: folderRecords, refetch: refetchFolders } =
    useFindManyRecords<FolderRow>({
      objectNameSingular: 'workflowFolder',
      recordGqlFields: { id: true, name: true, position: true },
      limit: 500,
    });

  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [busy, setBusy] = useState(false);
  const [lastClicked, setLastClicked] = useState<string | null>(null);

  const folderRecordByPath = useMemo(() => {
    const map = new Map<string, FolderRow>();
    for (const record of folderRecords) {
      const path = normalizeFolderPath(record.name);
      if (path) map.set(path, record);
    }
    return map;
  }, [folderRecords]);

  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>(folderRecordByPath.keys());
    for (const workflow of workflows) {
      const path = folderOf(workflow);
      if (path) paths.add(path);
    }
    // Every ancestor of a known path is a folder too.
    for (const path of [...paths]) {
      let cursor = parentOf(path);
      while (cursor) {
        paths.add(cursor);
        cursor = parentOf(cursor);
      }
    }
    return [...paths].sort((a, b) => a.localeCompare(b));
  }, [folderRecordByPath, workflows]);

  const countIn = (path: string) =>
    workflows.filter(
      (workflow) =>
        isWithin(folderOf(workflow), path) && folderOf(workflow) !== '',
    ).length;

  const query = search.trim().toLowerCase();
  const childFolders: FolderItem[] = query
    ? []
    : allFolderPaths
        .filter((path) => parentOf(path) === current)
        .map((path) => ({
          path,
          name: lastSegment(path),
          position: folderRecordByPath.get(path)?.position ?? null,
        }))
        .sort(byPositionThenName);
  const visibleWorkflows = (
    query
      ? workflows.filter((workflow) =>
          workflow.name.toLowerCase().includes(query),
        )
      : workflows.filter((workflow) => folderOf(workflow) === current)
  )
    .slice()
    .sort(byPositionThenName);

  const open = (path: string) => {
    setSelected([]);
    setEditing(null);
    setMenu(null);
    const next = new URLSearchParams(searchParams);
    if (path) next.set(QUERY_KEY, path);
    else next.delete(QUERY_KEY);
    setSearchParams(next, { replace: false });
  };

  useEffect(() => {
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(null);
        setEditing(null);
      }
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', escape);
    };
  }, []);

  // Every mutation ends with a refetch so the list reflects the change at once.
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      await Promise.all([refetchWorkflows(), refetchFolders()]);
      setBusy(false);
    }
  };

  const setWorkflow = (id: string, input: Record<string, unknown>) =>
    updateOneRecord({
      objectNameSingular: 'workflow',
      idToUpdate: id,
      updateOneRecordInput: input,
    });
  const setFolderRecord = (id: string, input: Record<string, unknown>) =>
    updateOneRecord({
      objectNameSingular: 'workflowFolder',
      idToUpdate: id,
      updateOneRecordInput: input,
    });

  const ensureFolderRecord = async (path: string): Promise<{ id: string }> => {
    const existing = folderRecordByPath.get(path);
    if (isDefined(existing)) return existing;
    return createFolderRecord({ name: path });
  };

  const moveWorkflows = (ids: string[], folder: string) =>
    run(async () => {
      for (const id of ids) {
        const workflow = workflows.find((candidate) => candidate.id === id);
        if (!workflow || folderOf(workflow) === folder) continue;
        await setWorkflow(id, { folder: folder || null });
      }
      setSelected([]);
    });

  const reorderWorkflows = (
    ids: string[],
    anchorId: string,
    zone: 'before' | 'after',
  ) =>
    run(async () => {
      const list = visibleWorkflows
        .filter((workflow) => !ids.includes(workflow.id))
        .map((workflow) => ({ id: workflow.id, position: workflow.position }));
      const anchorIndex = list.findIndex(
        (workflow) => workflow.id === anchorId,
      );
      if (anchorIndex < 0) return;
      for (const [index, workflow] of list.entries()) {
        if (workflow.position === null) {
          workflow.position = index;
          await setWorkflow(workflow.id, { position: index });
        }
      }
      const { position, next } = positionBetween(list, anchorIndex, zone);
      const step = next !== null ? (next - position) / (ids.length + 1) : 1;
      let cursor = position;
      for (const id of ids) {
        await setWorkflow(id, { position: cursor });
        cursor += step;
      }
    });

  const removeWorkflows = (ids: string[]) =>
    run(async () => {
      await deleteWorkflows({ recordIdsToDelete: ids });
      setSelected([]);
    });

  const renameFolder = async (oldPath: string, newPath: string) => {
    if (oldPath === newPath || !newPath) return;
    for (const workflow of workflows) {
      const folder = folderOf(workflow);
      if (!folder || !isWithin(folder, oldPath)) continue;
      await setWorkflow(workflow.id, {
        folder: newPath + folder.slice(oldPath.length),
      });
    }
    for (const record of folderRecords) {
      const folder = normalizeFolderPath(record.name);
      if (!folder || !isWithin(folder, oldPath)) continue;
      await setFolderRecord(record.id, {
        name: newPath + folder.slice(oldPath.length),
      });
    }
    if (!folderRecordByPath.has(newPath) && !folderRecordByPath.has(oldPath)) {
      await createFolderRecord({ name: newPath });
    }
    if (isWithin(current, oldPath) && current !== '')
      open(newPath + current.slice(oldPath.length));
  };

  const moveFolder = (path: string, targetParent: string) =>
    run(async () => {
      if (path === targetParent || isWithin(targetParent, path)) return;
      const newPath = targetParent
        ? `${targetParent}${FOLDER_SEPARATOR}${lastSegment(path)}`
        : lastSegment(path);
      await renameFolder(path, newPath);
    });

  const reorderFolder = (
    path: string,
    anchorPath: string,
    zone: 'before' | 'after',
  ) =>
    run(async () => {
      const list = childFolders
        .filter((folder) => folder.path !== path)
        .map((folder) => ({ path: folder.path, position: folder.position }));
      const anchorIndex = list.findIndex(
        (folder) => folder.path === anchorPath,
      );
      if (anchorIndex < 0) return;
      for (const [index, folder] of list.entries()) {
        if (folder.position === null) {
          folder.position = index;
          const record = await ensureFolderRecord(folder.path);
          await setFolderRecord(record.id, { position: index });
        }
      }
      const record = await ensureFolderRecord(path);
      await setFolderRecord(record.id, {
        position: positionBetween(list, anchorIndex, zone).position,
      });
    });

  const createFolder = (parent: string, name: string) =>
    run(async () => {
      const path = parent ? `${parent}${FOLDER_SEPARATOR}${name}` : name;
      if (!allFolderPaths.includes(path))
        await createFolderRecord({ name: path });
    });

  const deleteFolder = (path: string) =>
    run(async () => {
      // Contents move up one level; only the folder name disappears.
      const parent = parentOf(path);
      for (const workflow of workflows) {
        const folder = folderOf(workflow);
        if (!folder || !isWithin(folder, path)) continue;
        const rest = folder.slice(path.length).replace(/^\s*\/\s*/, '');
        const target = [parent, rest].filter(Boolean).join(FOLDER_SEPARATOR);
        await setWorkflow(workflow.id, { folder: target || null });
      }
      for (const record of folderRecords) {
        const folder = normalizeFolderPath(record.name);
        if (folder && isWithin(folder, path))
          await deleteFolderRecord(record.id);
      }
      if (isWithin(current, path) && current !== '') open(parent);
    });

  const commitEdit = async () => {
    if (!editing) return;
    const draft = normalizeFolderPath(editing.draft);
    const snapshot = editing;
    setEditing(null);
    if (!draft) return;
    if (snapshot.mode === 'new') await createFolder(snapshot.path, draft);
    else {
      const parent = parentOf(snapshot.path);
      await run(() =>
        renameFolder(
          snapshot.path,
          parent ? `${parent}${FOLDER_SEPARATOR}${draft}` : draft,
        ),
      );
    }
  };

  const toggleSelect = (id: string, event: React.MouseEvent) => {
    const ordered = visibleWorkflows.map((workflow) => workflow.id);
    if (event.shiftKey && lastClicked) {
      const from = ordered.indexOf(lastClicked);
      const to = ordered.indexOf(id);
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        setSelected([
          ...new Set([...selected, ...ordered.slice(start, end + 1)]),
        ]);
        return;
      }
    }
    setLastClicked(id);
    if (event.ctrlKey || event.metaKey) {
      setSelected(
        selected.includes(id)
          ? selected.filter((item) => item !== id)
          : [...selected, id],
      );
      return;
    }
    setSelected(selected.length === 1 && selected[0] === id ? [] : [id]);
  };

  const onDragStart = (event: React.DragEvent, id: string) => {
    const ids = selected.includes(id) ? selected : [id];
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ workflows: ids }));
    event.dataTransfer.effectAllowed = 'move';
  };
  const onFolderDragStart = (event: React.DragEvent, path: string) => {
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify({ folder: path }));
    event.dataTransfer.effectAllowed = 'move';
  };

  // Where on the row the pointer is: the outer thirds reorder, the middle of a folder moves into it.
  const zoneFor = (event: React.DragEvent, kind: RowKind): DropZone => {
    if (kind === 'container') return 'into';
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (kind === 'workflow') return ratio < 0.5 ? 'before' : 'after';
    if (ratio < 0.3) return 'before';
    if (ratio > 0.7) return 'after';
    return 'into';
  };
  const applyDrop = (
    payload: DragPayload,
    key: string,
    kind: RowKind,
    zone: DropZone,
  ) => {
    if (kind === 'container' || zone === 'into') {
      if (payload.workflows) void moveWorkflows(payload.workflows, key);
      if (payload.folder) void moveFolder(payload.folder, key);
      return;
    }
    if (
      kind === 'workflow' &&
      payload.workflows &&
      !payload.workflows.includes(key)
    ) {
      void reorderWorkflows(payload.workflows, key, zone);
    }
    if (kind === 'folder' && payload.folder && payload.folder !== key) {
      void reorderFolder(payload.folder, key, zone);
    }
    // A workflow dropped at the edge of a folder still goes into that folder.
    if (kind === 'folder' && payload.workflows) {
      void moveWorkflows(payload.workflows, key);
    }
  };
  const dragOverFor =
    (key: string, kind: RowKind) => (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      const zone = zoneFor(event, kind);
      if (dropTarget?.key !== key || dropTarget.zone !== zone)
        setDropTarget({ key, zone });
    };
  const dragLeaveFor = (key: string) => () => {
    if (dropTarget?.key === key) setDropTarget(null);
  };
  const dropFor =
    (key: string, kind: RowKind, target = key) =>
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const zone = zoneFor(event, kind);
      setDropTarget(null);
      const raw = event.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      applyDrop(JSON.parse(raw) as DragPayload, target, kind, zone);
    };
  const dropState = (key: string) =>
    dropTarget?.key === key ? dropTarget.zone : undefined;

  const crumbs = current ? current.split(FOLDER_SEPARATOR) : [];
  const menuFolders = allFolderPaths.filter((path) => path !== current);
  const upKey = `up:${parentOf(current)}`;

  const editorRow = (mode: 'new' | 'rename', depthPath: string) => (
    <StyledRow data-kind="folder" data-editing="true">
      <StyledCell data-col="name">
        <IconFolder size={16} />
        <StyledInput
          autoFocus
          placeholder="Folder name"
          value={editing?.draft ?? ''}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            editing && setEditing({ ...editing, draft: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitEdit();
          }}
          onBlur={() => void commitEdit()}
          data-mode={mode}
          data-path={depthPath}
        />
      </StyledCell>
    </StyledRow>
  );

  return (
    <StyledExplorer
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ kind: 'background', x: event.clientX, y: event.clientY });
      }}
      onClick={() => {
        setSelected([]);
      }}
    >
      <StyledToolbar onClick={(event) => event.stopPropagation()}>
        <StyledCrumbs>
          <StyledCrumb
            data-active={current === ''}
            onClick={() => open('')}
            onDragOver={dragOverFor('', 'container')}
            onDragLeave={dragLeaveFor('')}
            onDrop={dropFor('', 'container')}
            data-drop={dropState('')}
          >
            <IconSettingsAutomation size={14} />
            Workflows
          </StyledCrumb>
          {crumbs.map((segment, index) => {
            const path = crumbs.slice(0, index + 1).join(FOLDER_SEPARATOR);
            return (
              <StyledCrumbGroup key={path}>
                <IconChevronRight size={12} />
                <StyledCrumb
                  data-active={path === current}
                  onClick={() => open(path)}
                  onDragOver={dragOverFor(path, 'container')}
                  onDragLeave={dragLeaveFor(path)}
                  onDrop={dropFor(path, 'container')}
                  data-drop={dropState(path)}
                >
                  {segment}
                </StyledCrumb>
              </StyledCrumbGroup>
            );
          })}
        </StyledCrumbs>
        <StyledSearch>
          <IconSearch size={14} />
          <input
            placeholder="Search all workflows"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </StyledSearch>
        <StyledToolButton
          onClick={() => setEditing({ mode: 'new', path: current, draft: '' })}
          title="New folder here"
        >
          <IconFolderPlus size={14} />
          New folder
        </StyledToolButton>
      </StyledToolbar>

      <StyledHeader>
        <StyledCell data-col="name">Name</StyledCell>
        <StyledCell data-col="status">Status</StyledCell>
        <StyledCell data-col="updated">Updated</StyledCell>
      </StyledHeader>

      <StyledList>
        {current !== '' && !query && (
          <StyledRow
            data-kind="up"
            data-drop={dropState(upKey)}
            onDragOver={dragOverFor(upKey, 'container')}
            onDragLeave={dragLeaveFor(upKey)}
            onDrop={dropFor(upKey, 'container', parentOf(current))}
            onDoubleClick={() => open(parentOf(current))}
            onClick={(event) => {
              event.stopPropagation();
              open(parentOf(current));
            }}
          >
            <StyledCell data-col="name">
              <IconArrowBackUp size={16} />
              <StyledMuted>..</StyledMuted>
            </StyledCell>
          </StyledRow>
        )}
        {editing?.mode === 'new' &&
          editing.path === current &&
          editorRow('new', current)}
        {childFolders.map(({ path }) =>
          editing?.mode === 'rename' && editing.path === path ? (
            <div key={path}>{editorRow('rename', path)}</div>
          ) : (
            <StyledRow
              key={path}
              data-kind="folder"
              data-drop={dropState(path)}
              draggable
              onDragStart={(event) => onFolderDragStart(event, path)}
              onDragOver={dragOverFor(path, 'folder')}
              onDragLeave={dragLeaveFor(path)}
              onDrop={dropFor(path, 'folder')}
              onClick={(event) => {
                event.stopPropagation();
                open(path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({
                  kind: 'folder',
                  path,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <StyledCell data-col="name">
                <IconFolder size={16} />
                <StyledName>{lastSegment(path)}</StyledName>
              </StyledCell>
              <StyledCell data-col="status">
                <StyledMuted>
                  {countIn(path)} workflow{countIn(path) === 1 ? '' : 's'}
                </StyledMuted>
              </StyledCell>
              <StyledCell data-col="updated" />
            </StyledRow>
          ),
        )}
        {visibleWorkflows.map((workflow) => {
          const status = statusMeta(workflow.statuses);
          const isSelected = selected.includes(workflow.id);
          return (
            <StyledRow
              key={workflow.id}
              data-kind="workflow"
              data-selected={isSelected}
              data-drop={dropState(workflow.id)}
              draggable
              onDragStart={(event) => onDragStart(event, workflow.id)}
              onDragOver={dragOverFor(workflow.id, 'workflow')}
              onDragLeave={dragLeaveFor(workflow.id)}
              onDrop={dropFor(workflow.id, 'workflow')}
              onClick={(event) => {
                event.stopPropagation();
                toggleSelect(workflow.id, event);
              }}
              onDoubleClick={() => navigate(`/object/workflow/${workflow.id}`)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const ids = isSelected ? selected : [workflow.id];
                if (!isSelected) setSelected([workflow.id]);
                setMenu({
                  kind: 'workflow',
                  ids,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
            >
              <StyledCell data-col="name">
                <IconSettingsAutomation size={16} />
                <StyledName>{workflow.name}</StyledName>
                {query && folderOf(workflow) && (
                  <StyledMuted>{folderOf(workflow)}</StyledMuted>
                )}
              </StyledCell>
              <StyledCell data-col="status">
                <Tag color={status.color} text={status.label} />
              </StyledCell>
              <StyledCell data-col="updated">
                <StyledMuted>{relativeTime(workflow.updatedAt)}</StyledMuted>
              </StyledCell>
            </StyledRow>
          );
        })}
        {!loading &&
          childFolders.length === 0 &&
          visibleWorkflows.length === 0 && (
            <StyledEmpty>
              {query
                ? 'No workflow matches that search.'
                : 'This folder is empty. Drag workflows here or right-click for options.'}
            </StyledEmpty>
          )}
      </StyledList>

      <StyledStatusBar>
        {busy
          ? 'Saving…'
          : selected.length > 0
            ? `${selected.length} selected · drag between rows to reorder, onto a folder to move, or right-click`
            : `${visibleWorkflows.length} workflow${visibleWorkflows.length === 1 ? '' : 's'}${childFolders.length ? `, ${childFolders.length} folder${childFolders.length === 1 ? '' : 's'}` : ''} · drag to reorder`}
      </StyledStatusBar>

      {menu && (
        <StyledMenu
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {menu.kind === 'background' && (
            <StyledMenuItem
              onClick={() => {
                setMenu(null);
                setEditing({ mode: 'new', path: current, draft: '' });
              }}
            >
              <IconFolderPlus size={14} /> New folder
            </StyledMenuItem>
          )}
          {menu.kind === 'folder' && (
            <>
              <StyledMenuItem
                onClick={() => {
                  setMenu(null);
                  open(menu.path);
                }}
              >
                <IconFolder size={14} /> Open
              </StyledMenuItem>
              <StyledMenuItem
                onClick={() => {
                  setMenu(null);
                  setEditing({
                    mode: 'rename',
                    path: menu.path,
                    draft: lastSegment(menu.path),
                  });
                }}
              >
                <IconPencil size={14} /> Rename
              </StyledMenuItem>
              <StyledMenuItem
                onClick={() => {
                  setMenu(null);
                  open(menu.path);
                  setEditing({ mode: 'new', path: menu.path, draft: '' });
                }}
              >
                <IconFolderPlus size={14} /> New subfolder
              </StyledMenuItem>
              <StyledMenuLabel>Move to</StyledMenuLabel>
              {current !== '' && (
                <StyledMenuItem
                  onClick={() => {
                    setMenu(null);
                    void moveFolder(menu.path, parentOf(current));
                  }}
                >
                  <IconArrowBackUp size={14} /> Up one level
                </StyledMenuItem>
              )}
              {menuFolders
                .filter(
                  (path) =>
                    path !== menu.path &&
                    !isWithin(path, menu.path) &&
                    parentOf(menu.path) !== path,
                )
                .map((path) => (
                  <StyledMenuItem
                    key={path}
                    onClick={() => {
                      setMenu(null);
                      void moveFolder(menu.path, path);
                    }}
                  >
                    <IconFolderSymlink size={14} /> {path}
                  </StyledMenuItem>
                ))}
              {parentOf(menu.path) !== '' && (
                <StyledMenuItem
                  onClick={() => {
                    setMenu(null);
                    void moveFolder(menu.path, '');
                  }}
                >
                  <IconFolderSymlink size={14} /> Workflows (top level)
                </StyledMenuItem>
              )}
              <StyledMenuSeparator />
              <StyledMenuItem
                data-danger="true"
                onClick={() => {
                  setMenu(null);
                  void deleteFolder(menu.path);
                }}
              >
                <IconTrash size={14} /> Delete folder (keeps workflows)
              </StyledMenuItem>
            </>
          )}
          {menu.kind === 'workflow' && (
            <>
              {menu.ids.length === 1 && (
                <StyledMenuItem
                  onClick={() => {
                    setMenu(null);
                    navigate(`/object/workflow/${menu.ids[0]}`);
                  }}
                >
                  <IconSettingsAutomation size={14} /> Open
                </StyledMenuItem>
              )}
              <StyledMenuLabel>
                Move {menu.ids.length > 1 ? `${menu.ids.length} workflows` : ''}{' '}
                to
              </StyledMenuLabel>
              {current !== '' && (
                <StyledMenuItem
                  onClick={() => {
                    setMenu(null);
                    void moveWorkflows(menu.ids, '');
                  }}
                >
                  <IconFolderSymlink size={14} /> Workflows (top level)
                </StyledMenuItem>
              )}
              {menuFolders.map((path) => (
                <StyledMenuItem
                  key={path}
                  onClick={() => {
                    setMenu(null);
                    void moveWorkflows(menu.ids, path);
                  }}
                >
                  <IconFolderSymlink size={14} /> {path}
                </StyledMenuItem>
              ))}
              <StyledMenuSeparator />
              <StyledMenuItem
                onClick={() => {
                  setMenu(null);
                  setEditing({ mode: 'new', path: current, draft: '' });
                }}
              >
                <IconFolderPlus size={14} /> New folder
              </StyledMenuItem>
              <StyledMenuItem
                data-danger="true"
                onClick={() => {
                  setMenu(null);
                  void removeWorkflows(menu.ids);
                }}
              >
                <IconTrash size={14} /> Delete
                {menu.ids.length > 1 ? ` ${menu.ids.length} workflows` : ''}
              </StyledMenuItem>
            </>
          )}
        </StyledMenu>
      )}
    </StyledExplorer>
  );
};

const StyledExplorer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  position: relative;
  width: 100%;
`;

const StyledToolbar = styled.div`
  align-items: center;
  border-bottom: 1px solid ${t.border.color.light};
  display: flex;
  gap: ${t.spacing[3]};
  min-height: 40px;
  padding: 0 ${t.spacing[3]};
`;

const StyledCrumbs = styled.div`
  align-items: center;
  display: flex;
  flex: 1;
  gap: ${t.spacing[1]};
  min-width: 0;
  overflow: hidden;
`;

const StyledCrumbGroup = styled.span`
  align-items: center;
  color: ${t.font.color.light};
  display: inline-flex;
  gap: ${t.spacing[1]};
`;

const StyledCrumb = styled.span`
  align-items: center;
  border: 1px solid transparent;
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.secondary};
  cursor: pointer;
  display: inline-flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[1]};
  padding: 2px ${t.spacing[1]};
  white-space: nowrap;

  &[data-active='true'] {
    color: ${t.font.color.primary};
    font-weight: ${t.font.weight.medium};
  }

  &[data-drop='into'] {
    background-color: ${t.background.transparent.medium};
    border-color: ${t.color.blue};
  }

  @media (hover: hover) {
    &:hover {
      background-color: ${t.background.transparent.light};
    }
  }
`;

const StyledSearch = styled.label`
  align-items: center;
  background: ${t.background.transparent.lighter};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.light};
  display: flex;
  gap: ${t.spacing[1]};
  height: 26px;
  padding: 0 ${t.spacing[2]};
  width: 220px;

  input {
    background: transparent;
    border: none;
    color: ${t.font.color.primary};
    flex: 1;
    font-size: ${t.font.size.sm};
    min-width: 0;
    outline: none;
  }
`;

const StyledToolButton = styled.button`
  align-items: center;
  background: ${t.background.transparent.lighter};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.secondary};
  cursor: pointer;
  display: inline-flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[1]};
  height: 26px;
  padding: 0 ${t.spacing[2]};
  transition: background-color 120ms ease-out;
  white-space: nowrap;

  &:hover {
    background-color: ${t.background.transparent.medium};
    color: ${t.font.color.primary};
  }

  &:active {
    transform: scale(0.96);
  }
`;

const StyledHeader = styled.div`
  border-bottom: 1px solid ${t.border.color.light};
  color: ${t.font.color.light};
  display: flex;
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.medium};
  height: 28px;
  padding: 0 ${t.spacing[3]};
`;

const StyledList = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${t.spacing[1]} ${t.spacing[3]};
`;

const StyledRow = styled.div`
  align-items: center;
  border: 1px solid transparent;
  border-radius: ${t.border.radius.sm};
  box-shadow: 0 0 0 0 transparent;
  color: ${t.font.color.primary};
  cursor: default;
  display: flex;
  font-size: ${t.font.size.md};
  height: 34px;
  position: relative;
  transition: background-color 100ms ease-out;
  user-select: none;

  &[data-kind='folder'],
  &[data-kind='up'] {
    cursor: pointer;
  }

  &[data-kind='workflow'] {
    cursor: grab;
  }

  @media (hover: hover) {
    &:hover {
      background-color: ${t.background.transparent.light};
    }
  }

  &[data-selected='true'] {
    background-color: ${t.background.transparent.medium};
  }

  &[data-drop='into'] {
    background-color: ${t.background.transparent.medium};
    border-color: ${t.color.blue};
  }

  /* Reorder indicator: a 2px line on the edge the item will land on. */
  &[data-drop='before'] {
    box-shadow: 0 -2px 0 0 ${t.color.blue};
  }

  &[data-drop='after'] {
    box-shadow: 0 2px 0 0 ${t.color.blue};
  }
`;

const StyledCell = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[2]};
  min-width: 0;
  padding: 0 ${t.spacing[2]};

  &[data-col='name'] {
    flex: 1;
  }

  &[data-col='status'] {
    flex-shrink: 0;
    width: 140px;
  }

  &[data-col='updated'] {
    flex-shrink: 0;
    width: 110px;
  }
`;

const StyledName = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledMuted = styled.span`
  color: ${t.font.color.light};
  font-size: ${t.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledInput = styled.input`
  background: ${t.background.primary};
  border: 1px solid ${t.color.blue};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  height: 26px;
  outline: none;
  padding: 0 ${t.spacing[2]};
  width: 320px;
`;

const StyledEmpty = styled.div`
  color: ${t.font.color.light};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[8]} ${t.spacing[2]};
  text-align: center;
`;

const StyledStatusBar = styled.div`
  border-top: 1px solid ${t.border.color.light};
  color: ${t.font.color.light};
  font-size: ${t.font.size.xs};
  padding: ${t.spacing[1]} ${t.spacing[3]};
`;

const StyledMenu = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-shadow: ${t.boxShadow.strong};
  max-height: 60vh;
  min-width: 220px;
  overflow-y: auto;
  padding: ${t.spacing[1]};
  position: fixed;
  z-index: 100;
`;

const StyledMenuItem = styled.div`
  align-items: center;
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.primary};
  cursor: pointer;
  display: flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[2]};
  height: 28px;
  padding: 0 ${t.spacing[2]};

  &:hover {
    background-color: ${t.background.transparent.light};
  }

  &[data-danger='true'] {
    color: ${t.font.color.danger};
  }
`;

const StyledMenuLabel = styled.div`
  color: ${t.font.color.light};
  font-size: ${t.font.size.xs};
  padding: ${t.spacing[2]} ${t.spacing[2]} ${t.spacing[1]};
  text-transform: uppercase;
`;

const StyledMenuSeparator = styled.div`
  background: ${t.border.color.light};
  height: 1px;
  margin: ${t.spacing[1]} 0;
`;
