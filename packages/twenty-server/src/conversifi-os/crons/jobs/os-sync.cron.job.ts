import { Injectable, Logger } from '@nestjs/common';

import { type OsSyncCronJobData } from 'src/conversifi-os/constants/os-sync-cron.constant';
import { OsSyncJob } from 'src/conversifi-os/crons/jobs/os-sync.job';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';

// The cron tick only hands the run to the OS queue; one pending run per kind at a time, so a
// slow sync never stacks up behind itself.
@Injectable()
@Processor(MessageQueue.cronQueue)
export class OsSyncCronJob {
  private readonly logger = new Logger(OsSyncCronJob.name);

  constructor(
    @InjectMessageQueue(MessageQueue.osQueue)
    private readonly osQueue: MessageQueueService,
  ) {}

  @Process(OsSyncCronJob.name)
  async handle(data: OsSyncCronJobData): Promise<void> {
    try {
      await this.osQueue.add<OsSyncCronJobData>(OsSyncJob.name, data, { id: `os-sync-run-${data.kind}` });
    } catch (error) {
      this.logger.error(`os sync ${data.kind} could not be queued: ${(error as Error).message}`);
    }
  }
}
