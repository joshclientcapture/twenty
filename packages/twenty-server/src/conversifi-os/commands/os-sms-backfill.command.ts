import { Logger } from '@nestjs/common';

import { Command, CommandRunner } from 'nest-commander';

import { OsSmsService } from 'src/conversifi-os/services/os-sms.service';

// Mirrors every stored text into Text message records on the people, once.
@Command({ name: 'os:sms-backfill', description: 'Creates a Text message record for every SMS already stored in os.sms_messages' })
export class OsSmsBackfillCommand extends CommandRunner {
  private readonly logger = new Logger(OsSmsBackfillCommand.name);

  constructor(private readonly sms: OsSmsService) {
    super();
  }

  async run(): Promise<void> {
    const result = await this.sms.backfillMessages();
    this.logger.log(`sms backfill: ${JSON.stringify(result)}`);
  }
}
