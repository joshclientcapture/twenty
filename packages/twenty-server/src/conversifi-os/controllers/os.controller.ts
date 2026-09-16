import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common';

import { ApiPath } from 'twenty-shared/types';

import { OsRpcService } from 'src/conversifi-os/services/os-rpc.service';
import { OS_FAST_STEPS, OS_SYNC_STEPS, type OsSyncStep, OsSyncService } from 'src/conversifi-os/services/os-sync.service';
import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { UserAuthGuard } from 'src/engine/guards/user-auth.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';

// Mounted outside `/rest` on purpose so the REST core middleware (object metadata hydration)
// never runs for these calls; the guards alone decide access.
@Controller(ApiPath.Os)
@UseGuards(JwtAuthGuard, WorkspaceAuthGuard, UserAuthGuard, NoPermissionGuard)
export class OsController {
  constructor(
    private readonly rpc: OsRpcService,
    private readonly sync: OsSyncService,
  ) {}

  @Post('rpc/:functionName')
  async callFunction(
    @Param('functionName') functionName: string,
    @Body() body: Record<string, unknown> | undefined,
  ) {
    return { data: await this.rpc.call(functionName, body ?? {}) };
  }

  @Post('sync/:step')
  async runSync(@Param('step') step: string) {
    if (step === 'all') return { results: await this.sync.runSteps(OS_SYNC_STEPS) };
    if (step === 'fast') return { results: await this.sync.runSteps(OS_FAST_STEPS, 3) };
    if (!OS_SYNC_STEPS.includes(step as OsSyncStep)) throw new BadRequestException(`unknown sync step ${step}`);
    return { results: [await this.sync.runStep(step as OsSyncStep)] };
  }
}
