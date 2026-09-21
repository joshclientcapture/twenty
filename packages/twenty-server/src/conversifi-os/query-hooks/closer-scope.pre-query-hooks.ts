import { type WorkspacePreQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';
import {
  type FindManyResolverArgs,
  type FindOneResolverArgs,
  type GroupByResolverArgs,
} from 'src/engine/api/graphql/workspace-resolver-builder/interfaces/workspace-resolvers-builder.interface';

import { WorkspaceQueryHook } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { CloserScopeService, scopeFilter } from 'src/conversifi-os/query-hooks/closer-scope.service';

// Our own row scoping for closers: every read of People and Bookings by a member holding the
// Closer role gets "closer email is mine" added on the server, so lists, views, single records
// and group-bys never carry another closer's leads. One class per hook key, as Twenty requires.
type FilteredArgs = FindManyResolverArgs | FindOneResolverArgs | GroupByResolverArgs;

const scopeArgs = async <TArgs extends FilteredArgs>(scope: CloserScopeService, authContext: WorkspaceAuthContext, args: TArgs): Promise<TArgs> => {
  const email = await scope.scopeEmail(authContext);
  if (!email) return args;
  return { ...args, filter: scopeFilter(args.filter as Record<string, unknown> | undefined, email) } as TArgs;
};

@WorkspaceQueryHook('person.findMany')
export class PersonFindManyCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: FindManyResolverArgs): Promise<FindManyResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

@WorkspaceQueryHook('person.findOne')
export class PersonFindOneCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: FindOneResolverArgs): Promise<FindOneResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

@WorkspaceQueryHook('person.groupBy')
export class PersonGroupByCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: GroupByResolverArgs): Promise<GroupByResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

@WorkspaceQueryHook('booking.findMany')
export class BookingFindManyCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: FindManyResolverArgs): Promise<FindManyResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

@WorkspaceQueryHook('booking.findOne')
export class BookingFindOneCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: FindOneResolverArgs): Promise<FindOneResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

@WorkspaceQueryHook('booking.groupBy')
export class BookingGroupByCloserScopeHook implements WorkspacePreQueryHookInstance {
  constructor(private readonly scope: CloserScopeService) {}
  execute(authContext: WorkspaceAuthContext, _objectName: string, payload: GroupByResolverArgs): Promise<GroupByResolverArgs> {
    return scopeArgs(this.scope, authContext, payload);
  }
}

export const CLOSER_SCOPE_HOOKS = [
  PersonFindManyCloserScopeHook,
  PersonFindOneCloserScopeHook,
  PersonGroupByCloserScopeHook,
  BookingFindManyCloserScopeHook,
  BookingFindOneCloserScopeHook,
  BookingGroupByCloserScopeHook,
];
