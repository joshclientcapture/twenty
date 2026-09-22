import { Logger } from '@nestjs/common';

import { OsSmsService } from 'src/conversifi-os/services/os-sms.service';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';

export const OS_SMS_CRON_PATTERN = '* * * * *';

// One tick a minute: queue new form leads, send what is due, answer replies.
@Processor(MessageQueue.cronQueue)
export class OsSmsCronJob {
  private readonly logger = new Logger(OsSmsCronJob.name);

  constructor(private readonly sms: OsSmsService) {}

  @Process(OsSmsCronJob.name)
  async handle(): Promise<void> {
    try {
      const result = await this.sms.tick();
      if (!('skipped' in result) && (result.queued || result.openers || result.ladder || result.replies || result.booked)) {
        this.logger.log(`sms tick: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.logger.error(`sms tick failed: ${(error as Error).message}`);
    }
  }
}
