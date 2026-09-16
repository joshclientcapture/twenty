import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';

import { OS_FAST_STEPS, OS_SYNC_STEPS, type OsSyncStep, OsSyncService } from 'src/conversifi-os/services/os-sync.service';

type OsSyncCommandOptions = { steps?: string };

// Operator entry point: `node dist/command/command os:sync --steps all|fast|<step,...>`.
@Command({ name: 'os:sync', description: 'Runs the Conversifi OS sync steps once and prints each result' })
export class OsSyncCommand extends CommandRunner {
  private readonly logger = new Logger(OsSyncCommand.name);

  constructor(private readonly osSyncService: OsSyncService) {
    super();
  }

  @Option({ flags: '-s, --steps [steps]', description: 'all, fast, or a comma separated list of steps' })
  parseSteps(value: string): string {
    return value;
  }

  async run(_params: string[], options?: OsSyncCommandOptions): Promise<void> {
    const requested = options?.steps ?? 'all';
    const steps: OsSyncStep[] =
      requested === 'all' ? OS_SYNC_STEPS
      : requested === 'fast' ? OS_FAST_STEPS
      : requested.split(',').map((step) => step.trim() as OsSyncStep).filter((step) => OS_SYNC_STEPS.includes(step));
    const results = await this.osSyncService.runSteps(steps, requested === 'fast' ? 3 : undefined);
    for (const result of results) {
      const status = result.skipped ? `skipped (${result.skipped})` : result.ok ? 'ok' : `FAILED: ${result.error}`;
      this.logger.log(`${result.step}: ${status} ${result.detail ? JSON.stringify(result.detail) : ''}`);
    }
  }
}
