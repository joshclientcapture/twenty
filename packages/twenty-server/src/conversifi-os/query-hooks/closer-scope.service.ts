import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { UserRoleService } from 'src/engine/metadata-modules/user-role/user-role.service';

// Members holding this role see only the people and bookings whose closer email is their own.
export const CLOSER_ROLE_LABEL = 'Closer';
const ROLE_LABEL_CACHE_MS = 60 * 1000;

type ScopedFilter = Record<string, unknown>;

// Adds "closer email is the viewer's" to whatever filter the query already carries.
export const scopeFilter = (filter: ScopedFilter | undefined, email: string): ScopedFilter => {
  const own: ScopedFilter = { closerEmail: { eq: email } };
  return filter && Object.keys(filter).length > 0 ? { and: [filter, own] } : own;
};

@Injectable()
export class CloserScopeService {
  private readonly roleLabels = new Map<string, { label: string; at: number }>();

  constructor(
    private readonly userRoleService: UserRoleService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // The email a viewer is limited to, or null when the viewer sees everything (admins, members,
  // API keys, workflows and the sync all pass through untouched).
  async scopeEmail(authContext: WorkspaceAuthContext): Promise<string | null> {
    if (authContext.type !== 'user') return null;
    const roleId = await this.userRoleService.getRoleIdForUserWorkspace({
      workspaceId: authContext.workspace.id,
      userWorkspaceId: authContext.userWorkspaceId,
    });
    if ((await this.roleLabel(roleId)) !== CLOSER_ROLE_LABEL) return null;
    const email = (authContext.user.email ?? '').trim().toLowerCase();
    return email.length > 0 ? email : null;
  }

  private async roleLabel(roleId: string): Promise<string | null> {
    const cached = this.roleLabels.get(roleId);
    if (cached && Date.now() - cached.at < ROLE_LABEL_CACHE_MS) return cached.label;
    const rows: { label: string }[] = await this.dataSource.query('select label from core.role where id = $1', [roleId]);
    const label = rows[0]?.label ?? '';
    this.roleLabels.set(roleId, { label, at: Date.now() });
    return label;
  }
}
