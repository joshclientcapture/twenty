import { BadRequestException, Body, Controller, ForbiddenException, Param, Post, UseGuards } from '@nestjs/common';

import { InjectDataSource } from '@nestjs/typeorm';

import { PermissionFlagType } from 'twenty-shared/constants';
import { ApiPath } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

import { isOsReadFunction, OS_RPC_CLOSER_FUNCTIONS } from 'src/conversifi-os/constants/os-rpc-allow-list.constant';
import { OsRpcService } from 'src/conversifi-os/services/os-rpc.service';
import { OS_FAST_STEPS, OS_SYNC_STEPS, type OsSyncStep, OsSyncService } from 'src/conversifi-os/services/os-sync.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { CustomPermissionGuard } from 'src/engine/guards/custom-permission.guard';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { PermissionsService } from 'src/engine/metadata-modules/permissions/permissions.service';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

// Mounted outside `/rest` on purpose so the REST core middleware (object metadata hydration)
// never runs for these calls; the guards alone decide access. Reads are open to members,
// writes and syncs need the workspace admin permission (checked per call, see requireAccess).
@Controller(ApiPath.Os)
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard, UserAuthGuard, CustomPermissionGuard)
export class OsController {
  constructor(
    private readonly rpc: OsRpcService,
    private readonly sync: OsSyncService,
    private readonly permissions: PermissionsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('rpc/:functionName')
  async callFunction(
    @Param('functionName') functionName: string,
    @Body() body: Record<string, unknown> | undefined,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: { email?: string | null },
  ) {
    if (!isOsReadFunction(functionName)) {
      const allowedAsCloser = OS_RPC_CLOSER_FUNCTIONS.has(functionName) && (await this.isCloser(user.email));
      if (!allowedAsCloser) await this.requireAdmin(workspace.id, userWorkspaceId);
    }
    return { data: await this.rpc.call(functionName, body ?? {}) };
  }

  @Post('sync/:step')
  async runSync(
    @Param('step') step: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
  ) {
    await this.requireAdmin(workspace.id, userWorkspaceId);
    if (step === 'all') return { results: await this.sync.runSteps(OS_SYNC_STEPS) };
    if (step === 'fast') return { results: await this.sync.runSteps(OS_FAST_STEPS, 3) };
    if (!OS_SYNC_STEPS.includes(step as OsSyncStep)) throw new BadRequestException(`unknown sync step ${step}`);
    return { results: [await this.sync.runStep(step as OsSyncStep)] };
  }

  private async requireAdmin(workspaceId: string, userWorkspaceId: string) {
    const allowed = await this.permissions.userHasWorkspaceSettingPermission({ userWorkspaceId, workspaceId, setting: PermissionFlagType.WORKSPACE });
    if (!allowed) throw new ForbiddenException('This action needs the workspace admin permission.');
  }

  private async isCloser(email: string | null | undefined) {
    if (!email) return false;
    const rows: { id: string }[] = await this.dataSource.query(
      'select id from os.closers where active and lower(login_email) = lower($1) limit 1',
      [email],
    );
    return rows.length > 0;
  }
}
