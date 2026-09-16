import { Module } from '@nestjs/common';

import { OsController } from 'src/conversifi-os/controllers/os.controller';
import { OsSyncCronCommand } from 'src/conversifi-os/crons/commands/os-sync.cron.command';
import { OsSyncCronJob } from 'src/conversifi-os/crons/jobs/os-sync.cron.job';
import { OsRpcService } from 'src/conversifi-os/services/os-rpc.service';
import { OsSyncService } from 'src/conversifi-os/services/os-sync.service';
import { OsUpsertService } from 'src/conversifi-os/services/os-upsert.service';

// Conversifi's ops analytics (the former "OS" Supabase project), served from the `os` schema
// of the core database. Kept outside `engine/` so upstream merges never touch it.
@Module({
  controllers: [OsController],
  providers: [OsRpcService, OsSyncService, OsUpsertService, OsSyncCronJob, OsSyncCronCommand],
  exports: [OsSyncCronCommand],
})
export class ConversifiOsModule {}
