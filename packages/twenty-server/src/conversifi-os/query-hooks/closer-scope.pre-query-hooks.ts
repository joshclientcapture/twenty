import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import { type ResolverArgs } from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook, type WorkspaceQueryHookKey } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { ForbiddenError } from 'src/engine/core-modules/graphql/utils/graphql-errors.util';
import { CLOSER_SCOPED_OBJECTS, type CloserScopedObject, CloserScopeService, scopeFilter } from 'src/conversifi-os/query-hooks/closer-scope.service';

// Our own row scoping for closers, one hook class per object and method, made by a factory:
// reads and bulk writes get "closer email is mine" added to their filter, single-record writes
// are refused unless the record is theirs, merges are refused, and anything they create is
// stamped as theirs. Admins, members, API keys, workflows and the sync never reach these paths.
type ScopeAction = 'filter' | 'own' | 'stamp' | 'refuse';

const ACTIONS: Record<string, ScopeAction> = {
  findMany: 'filter', findOne: 'filter', groupBy: 'filter',
  updateMany: 'filter', deleteMany: 'filter', destroyMany: 'filter', restoreMany: 'filter',
  updateOne: 'own', deleteOne: 'own', destroyOne: 'own', restoreOne: 'own',
  createOne: 'stamp', createMany: 'stamp',
  mergeMany: 'refuse',
};

type AnyArgs = Record<string, unknown>;

const apply = async (scope: CloserScopeService, authContext: WorkspaceAuthContext, object: CloserScopedObject, action: ScopeAction, args: AnyArgs): Promise<AnyArgs> => {
  const email = await scope.scopeEmail(authContext);
  if (!email) return args;
  switch (action) {
    case 'filter':
      return { ...args, filter: scopeFilter(args.filter as AnyArgs | undefined, email) };
    case 'own': {
      const owned = await scope.owns(authContext.workspace.id, object, String(args.id), email);
      if (!owned) throw new ForbiddenError('This record belongs to another closer.');
      return args;
    }
    case 'stamp': {
      const closer = await scope.closerName(email);
      const stamp = (record: AnyArgs) => ({ ...record, closerEmail: email, ...(closer && object !== 'company' ? { closer } : {}) });
      return Array.isArray(args.data) ? { ...args, data: args.data.map((record) => stamp(record as AnyArgs)) } : { ...args, data: stamp(args.data as AnyArgs) };
    }
    case 'refuse':
      throw new ForbiddenError('Closers cannot merge records.');
  }
};

const makeHook = (object: CloserScopedObject, method: string, action: ScopeAction) => {
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

export const CLOSER_SCOPE_HOOKS = CLOSER_SCOPED_OBJECTS.flatMap((object) =>
  Object.entries(ACTIONS).map(([method, action]) => makeHook(object, method, action)),
);
