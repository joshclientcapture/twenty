import { Module } from '@nestjs/common';

import { OsSyncCommand } from 'src/conversifi-os/commands/os-sync.command';
import { OsController } from 'src/conversifi-os/controllers/os.controller';
import { OsCalendlyWebhookController } from 'src/conversifi-os/controllers/os-calendly-webhook.controller';
import { OsWhopWebhookController } from 'src/conversifi-os/controllers/os-whop-webhook.controller';
import { OsSmsWebhookController } from 'src/conversifi-os/controllers/os-sms-webhook.controller';
import { OsHooksController } from 'src/conversifi-os/controllers/os-hooks.controller';
import { OsSmsService } from 'src/conversifi-os/services/os-sms.service';
import { OsWorkflowTestService } from 'src/conversifi-os/services/os-workflow-test.service';
import { OsDfyBillingService } from 'src/conversifi-os/services/os-dfy-billing.service';
import { OsAirwallexService } from 'src/conversifi-os/services/os-airwallex.service';
import { OsAirwallexWebhookController } from 'src/conversifi-os/controllers/os-airwallex-webhook.controller';
import { ToolModule } from 'src/engine/core-modules/tool/tool.module';
import { OsSmsCronJob } from 'src/conversifi-os/crons/jobs/os-sms.cron.job';
import { OsSmsBackfillCommand } from 'src/conversifi-os/commands/os-sms-backfill.command';
import { OsWhopService } from 'src/conversifi-os/services/os-whop.service';
import { OsIntakeController } from 'src/conversifi-os/controllers/os-intake.controller';
import { OsIntakeService } from 'src/conversifi-os/services/os-intake.service';
import { OsSyncCronCommand } from 'src/conversifi-os/crons/commands/os-sync.cron.command';
import { OsSyncCronJob } from 'src/conversifi-os/crons/jobs/os-sync.cron.job';
import { OsSyncJob } from 'src/conversifi-os/crons/jobs/os-sync.job';
import { OsRpcService } from 'src/conversifi-os/services/os-rpc.service';
import { OsSyncService } from 'src/conversifi-os/services/os-sync.service';
import { OsUpsertService } from 'src/conversifi-os/services/os-upsert.service';
import { OsBookingsService } from 'src/conversifi-os/services/os-bookings.service';
import { TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';
import { OsApiKeyCommand } from 'src/conversifi-os/commands/os-api-key.command';
import { OsImportContactsCommand } from 'src/conversifi-os/commands/os-import-contacts.command';
import { OsContactsImportService } from 'src/conversifi-os/services/os-contacts-import.service';
import { OsLifecycleService } from 'src/conversifi-os/services/os-lifecycle.service';
import { ApiKeyModule } from 'src/engine/core-modules/api-key/api-key.module';
import { TokenModule } from 'src/engine/core-modules/auth/token/token.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { CLOSER_SCOPE_HOOKS } from 'src/conversifi-os/query-hooks/closer-scope.pre-query-hooks';
import { PERSON_SUPPRESSION_HOOKS, PersonSuppressionService } from 'src/conversifi-os/query-hooks/person-suppression.post-query-hooks';
import { CloserScopeModule } from 'src/conversifi-os/query-hooks/closer-scope.module';
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

// Conversifi's ops analytics (the former "OS" Supabase project), served from the `os` schema
// of the core database. Kept outside `engine/` so upstream merges never touch it.
@Module({
  // JwtAuthGuard resolves AccessTokenService and WorkspaceCacheStorageService from here.
  imports: [TokenModule, WorkspaceCacheStorageModule, ApiKeyModule, PermissionsModule, CloserScopeModule, ToolModule],
  controllers: [OsController, OsIntakeController, OsCalendlyWebhookController, OsWhopWebhookController, OsSmsWebhookController, OsHooksController, OsAirwallexWebhookController],
  providers: [OsRpcService, OsSyncService, OsUpsertService, OsWhopService, OsSmsService, OsWorkflowTestService, OsDfyBillingService, OsAirwallexService, OsSmsCronJob, OsSmsBackfillCommand, OsBookingsService, TwentyApiService, OsContactsImportService, OsLifecycleService, OsIntakeService, OsSyncCronJob, OsSyncJob, OsSyncCronCommand, OsSyncCommand, OsApiKeyCommand, OsImportContactsCommand, ...CLOSER_SCOPE_HOOKS, PersonSuppressionService, ...PERSON_SUPPRESSION_HOOKS],
  exports: [OsSyncCronCommand, OsSyncCommand, OsApiKeyCommand, OsImportContactsCommand, OsSmsBackfillCommand],
})
export class ConversifiOsModule {}
