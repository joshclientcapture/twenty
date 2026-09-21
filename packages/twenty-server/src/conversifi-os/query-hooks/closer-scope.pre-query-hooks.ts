import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook, type WorkspaceQueryHookKey } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ForbiddenError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { CLOSER_SCOPED_OBJECTS, type CloserScopedObject, CloserScopeService, scopeFilter, scopeLinkFilter } from 'src/conversifi-os/query-hooks/closer-scope.service';

// Our own row scoping for closers, one hook class per object and method, made by a factory.
// Scoped objects (person, booking, company): reads and bulk writes get "closer email is mine"
// added to their filter, single-record writes are refused unless the record is theirs and keep
// the closer stamp, creates are stamped, duplicates lookups and merges are refused.
// Link objects (notes, tasks, timeline, participants, attachments, favourites) are readable only
// where they point at the closer's own person or company, or at nothing scoped at all.
// Admins, members, API keys, workflows and the sync never reach these paths.
type ScopeAction = 'filter' | 'own' | 'stamp' | 'refuse' | 'link';

const SCOPED_ACTIONS: Record<string, ScopeAction> = {
  findMany: 'filter', findOne: 'filter', groupBy: 'filter',
  updateMany: 'filter', deleteMany: 'filter', destroyMany: 'filter', restoreMany: 'filter',
  updateOne: 'own', deleteOne: 'own', destroyOne: 'own', restoreOne: 'own',
  createOne: 'stamp', createMany: 'stamp',
  findDuplicates: 'refuse', mergeMany: 'refuse',
};

// Which scoped relations each link object carries; a relation that does not exist on the object
// would break the query, so the list is explicit.
// Participants point at a person through a plain relation; the target objects use morph relations
// named targetPerson / targetCompany / targetBooking (their id columns are targetPersonId and so on).
const MORPH_LINKS = ['targetPerson', 'targetCompany', 'targetBooking'];
export const LINK_OBJECTS: Record<string, string[]> = {
  messageParticipant: ['person'],
  calendarEventParticipant: ['person'],
  timelineActivity: MORPH_LINKS,
  noteTarget: MORPH_LINKS,
  taskTarget: MORPH_LINKS,
  attachment: MORPH_LINKS,
  favorite: MORPH_LINKS,
};
const LINK_ACTIONS: Record<string, ScopeAction> = { findMany: 'link', findOne: 'link', groupBy: 'link' };

type AnyArgs = Record<string, unknown>;

const apply = async (scope: CloserScopeService, authContext: WorkspaceAuthContext, object: string, action: ScopeAction, args: AnyArgs): Promise<AnyArgs> => {
  const email = await scope.scopeEmail(authContext);
  if (!email) return args;
  switch (action) {
    case 'filter':
      return { ...args, filter: scopeFilter(args.filter as AnyArgs | undefined, email) };
    case 'link':
      return { ...args, filter: scopeLinkFilter(args.filter as AnyArgs | undefined, email, LINK_OBJECTS[object] ?? ['person']) };
    case 'own': {
      const owned = await scope.owns(authContext.workspace.id, object as CloserScopedObject, String(args.id), email);
      if (!owned) throw new ForbiddenError('This record belongs to another closer.');
      // The record stays theirs: re-assigning it would move it out of their own scope.
      return args.data && typeof args.data === 'object' ? { ...args, data: await stamped(scope, object, args.data as AnyArgs, email) } : args;
    }
    case 'stamp':
      return Array.isArray(args.data)
        ? { ...args, data: await Promise.all(args.data.map((record) => stamped(scope, object, record as AnyArgs, email))) }
        : { ...args, data: await stamped(scope, object, args.data as AnyArgs, email) };
    case 'refuse':
      throw new ForbiddenError('Closers cannot look up or merge records outside their own.');
  }
};

const stamped = async (scope: CloserScopeService, object: string, record: AnyArgs, email: string): Promise<AnyArgs> => {
  const closer = object === 'company' ? '' : await scope.closerName(email);
  return { ...record, closerEmail: email, ...(closer ? { closer } : {}) };
};

const makeHook = (object: string, method: string, action: ScopeAction) => {
  @WorkspaceQueryHook(`${object}.${method}` as WorkspaceQueryHookKey)
  class CloserScopeHook implements WorkspacePreQueryHookInstance {
    constructor(private readonly scope: CloserScopeService) {}

    async execute(authContext: WorkspaceAuthContext, _objectName: string, payload: ResolverArgs): Promise<ResolverArgs> {
      return (await apply(this.scope, authContext, object, action, payload as unknown as AnyArgs)) as unknown as ResolverArgs;
    }
  }
  Object.defineProperty(CloserScopeHook, 'name', { value: `CloserScope_${object}_${method}` });
  return CloserScopeHook;
};

export const CLOSER_SCOPE_HOOKS = [
  ...CLOSER_SCOPED_OBJECTS.flatMap((object) => Object.entries(SCOPED_ACTIONS).map(([method, action]) => makeHook(object, method, action))),
  ...Object.keys(LINK_OBJECTS).flatMap((object) => Object.entries(LINK_ACTIONS).map(([method, action]) => makeHook(object, method, action))),
];
