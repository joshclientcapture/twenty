import { Command, CommandRunner } from 'nest-commander';

import { OS_SYNC_CRON_SCHEDULES, type OsSyncCronJobData } from 'src/conversifi-os/constants/os-sync-cron.constant';
import { OS_SMS_CRON_PATTERN, OsSmsCronJob } from 'src/conversifi-os/crons/jobs/os-sms.cron.job';
import { OsSyncCronJob } from 'src/conversifi-os/crons/jobs/os-sync.cron.job';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';

@Command({
  name: 'cron:os:sync',
  description: 'Registers the Conversifi OS sync schedules (Stripe, Fathom, Calendly, Unipile, prod, ledger)',
})
export class OsSyncCronCommand extends CommandRunner {
  constructor(
    @InjectMessageQueue(MessageQueue.cronQueue)
    private readonly messageQueueService: MessageQueueService,
  ) {
    super();
  }

  async run(): Promise<void> {
    for (const schedule of OS_SYNC_CRON_SCHEDULES) {
      await this.messageQueueService.addCron<OsSyncCronJobData>({
        jobName: OsSyncCronJob.name,
        jobId: `os-sync-${schedule.kind}`,
        data: { kind: schedule.kind },
        options: { repeat: { pattern: schedule.pattern } },
      });
    }
    await this.messageQueueService.addCron<Record<string, never>>({
      jobName: OsSmsCronJob.name,
      jobId: 'os-sms-tick',
      data: {},
      options: { repeat: { pattern: OS_SMS_CRON_PATTERN } },
    });
  }
}
