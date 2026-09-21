import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

// Members holding this role see and touch only the people, bookings and companies whose closer
// email is their own. Everything else (admins, plain members, API keys, workflows, the sync) is untouched.
export const CLOSER_ROLE_LABEL = 'Closer';
export const CLOSER_SCOPED_OBJECTS = ['person', 'booking', 'company'] as const;
export type CloserScopedObject = (typeof CLOSER_SCOPED_OBJECTS)[number];
const TABLE_BY_OBJECT: Record<CloserScopedObject, string> = { person: 'person', booking: '_booking', company: 'company' };
const CACHE_MS = 60 * 1000;

type ScopedFilter = Record<string, unknown>;
type Viewer = { workspaceId: string; userWorkspaceId?: string | null; email?: string | null };

// Adds "closer email is the viewer's" to whatever filter the query already carries.
export const scopeFilter = (filter: ScopedFilter | undefined, email: string): ScopedFilter => {
  const own: ScopedFilter = { closerEmail: { eq: email } };
  return filter && Object.keys(filter).length > 0 ? { and: [filter, own] } : own;
};

@Injectable()
export class CloserScopeService {
  private readonly roleLabels = new Map<string, { label: string; at: number }>();
  private readonly closerNames = new Map<string, { name: string; at: number }>();

  constructor(
    private readonly userRoleService: UserRoleService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // The email a viewer is limited to, or null when the viewer sees everything.
  async scopeEmail(authContext: WorkspaceAuthContext): Promise<string | null> {
    if (authContext.type !== 'user') return null;
    return this.scopeEmailFor({ workspaceId: authContext.workspace.id, userWorkspaceId: authContext.userWorkspaceId, email: authContext.user.email });
  }

  async scopeEmailFor({ workspaceId, userWorkspaceId, email }: Viewer): Promise<string | null> {
    if (!userWorkspaceId) return null;
    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({ workspaceId, userWorkspaceId });
    if ((await this.roleLabel(roleId)) !== CLOSER_ROLE_LABEL) return null;
    const normalised = (email ?? '').trim().toLowerCase();
    return normalised.length > 0 ? normalised : null;
  }

  // Whether the record a closer addresses by id is one of theirs.
  async owns(workspaceId: string, object: CloserScopedObject, id: string, email: string): Promise<boolean> {
    const rows: { closerEmail: string | null }[] = await this.dataSource.query(
      `select "closerEmail" from ${getWorkspaceSchemaName(workspaceId)}."${TABLE_BY_OBJECT[object]}" where id = $1`,
      [id],
    );
    return rows.length > 0 && (rows[0].closerEmail ?? '').toLowerCase() === email;
  }

  // The closer's display name, so records a closer creates are filed under them by name as well.
  async closerName(email: string): Promise<string> {
    const cached = this.closerNames.get(email);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.name;
    const rows: { name: string }[] = await this.dataSource.query(
      'select name from os.closers where lower(coalesce(login_email, calendly_host_email)) = $1 limit 1',
      [email],
    );
    const name = rows[0]?.name ?? '';
    this.closerNames.set(email, { name, at: Date.now() });
    return name;
  }

  private async roleLabel(roleId: string): Promise<string> {
    const cached = this.roleLabels.get(roleId);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.label;
    const rows: { label: string }[] = await this.dataSource.query('select label from core.role where id = $1', [roleId]);
    const label = rows[0]?.label ?? '';
    this.roleLabels.set(roleId, { label, at: Date.now() });
    return label;
  }
}
