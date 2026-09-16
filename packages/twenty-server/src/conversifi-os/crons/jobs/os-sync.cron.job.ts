import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { OS_SYNC_CRON_SCHEDULES, type OsSyncCronJobData } from 'src/conversifi-os/constants/os-sync-cron.constant';
import { OsSyncService } from 'src/conversifi-os/services/os-sync.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';

@Injectable()
@Processor(MessageQueue.cronQueue)
export class OsSyncCronJob {
  private readonly logger = new Logger(OsSyncCronJob.name);

  constructor(
    private readonly osSyncService: OsSyncService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Process(OsSyncCronJob.name)
  async handle(data: OsSyncCronJobData): Promise<void> {
    const schedule = OS_SYNC_CRON_SCHEDULES.find((candidate) => candidate.kind === data.kind);
    if (!schedule) {
      this.logger.warn(`unknown os sync kind ${data.kind}`);
      return;
    }
    if (schedule.kind === 'rentals') {
      await this.dataSource.query(`select os.refresh_rental_account_status()`);
      return;
    }
    const results = await this.osSyncService.runSteps(schedule.steps, schedule.calendlyWindowDays);
    const failed = results.filter((result) => !result.ok);
    if (failed.length) {
      this.logger.error(`os sync ${data.kind}: ${failed.map((result) => `${result.step}: ${result.error}`).join('; ')}`);
    } else {
      this.logger.log(`os sync ${data.kind} ok (${results.map((result) => result.step).join(', ')})`);
    }
  }
}
