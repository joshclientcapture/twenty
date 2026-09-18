import { Module } from '@nestjs/common';

import { OsSyncCommand } from 'src/conversifi-os/commands/os-sync.command';
import { OsController } from 'src/conversifi-os/controllers/os.controller';
import { OsCalendlyWebhookController } from 'src/conversifi-os/controllers/os-calendly-webhook.controller';
import { OsIntakeController } from 'src/conversifi-os/controllers/os-intake.controller';
import { OsIntakeService } from 'src/conversifi-os/services/os-intake.service';
import { OsSyncCronCommand } from 'src/conversifi-os/crons/commands/os-sync.cron.command';
import { OsSyncCronJob } from 'src/conversifi-os/crons/jobs/os-sync.cron.job';
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
import { WorkspaceCacheStorageModule } from 'src/engine/workspace-cache-storage/workspace-cache-storage.module';

// Conversifi's ops analytics (the former "OS" Supabase project), served from the `os` schema
// of the core database. Kept outside `engine/` so upstream merges never touch it.
@Module({
  // JwtAuthGuard resolves AccessTokenService and WorkspaceCacheStorageService from here.
  imports: [TokenModule, WorkspaceCacheStorageModule, ApiKeyModule],
  controllers: [OsController, OsIntakeController, OsCalendlyWebhookController],
  providers: [OsRpcService, OsSyncService, OsUpsertService, OsBookingsService, TwentyApiService, OsContactsImportService, OsLifecycleService, OsIntakeService, OsSyncCronJob, OsSyncCronCommand, OsSyncCommand, OsApiKeyCommand, OsImportContactsCommand],
  exports: [OsSyncCronCommand, OsSyncCommand, OsApiKeyCommand, OsImportContactsCommand],
})
export class ConversifiOsModule {}
