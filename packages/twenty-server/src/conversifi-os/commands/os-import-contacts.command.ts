import { Logger } from '@nestjs/common';

import { Command, CommandRunner, Option } from 'nest-commander';

import { OsContactsImportService } from 'src/conversifi-os/services/os-contacts-import.service';

type OsImportContactsCommandOptions = { ghlFile?: string; dryRun?: boolean };

// `node dist/command/command os:import-contacts --ghl-file /root/os-migration/ghl_contacts.ndjson [--dry-run]`
@Command({ name: 'os:import-contacts', description: 'Imports Conversifi-active GHL contacts and OS customers, trials and invitees into Twenty People and Companies' })
export class OsImportContactsCommand extends CommandRunner {
  private readonly logger = new Logger(OsImportContactsCommand.name);

  constructor(private readonly importService: OsContactsImportService) {
    super();
  }

  @Option({ flags: '-g, --ghl-file [path]', description: 'GHL contacts export (ndjson) to load into os.ghl_contacts first' })
  parseGhlFile(value: string): string {
    return value;
  }

  @Option({ flags: '-d, --dry-run', description: 'Count and provision fields without writing records' })
  parseDryRun(): boolean {
    return true;
  }

  async run(_params: string[], options?: OsImportContactsCommandOptions): Promise<void> {
    if (options?.ghlFile) {
      const loaded = await this.importService.loadGhlExport(options.ghlFile);
      this.logger.log(`ghl export loaded: ${JSON.stringify(loaded)}`);
    }
    const result = await this.importService.run({ dryRun: options?.dryRun });
    this.logger.log(`import: ${JSON.stringify(result)}`);
  }
}
