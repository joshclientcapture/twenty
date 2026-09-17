import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { appendFileSync } from 'fs';

import { Command, CommandRunner, Option } from 'nest-commander';
import { DataSource } from 'typeorm';

import { ApiKeyService } from 'src/engine/core-modules/api-key/services/api-key.service';

type OsApiKeyCommandOptions = { appendEnv: string };

const ONE_HUNDRED_YEARS_MS = 100 * 365 * 24 * 60 * 60 * 1000;

// Mints the Admin-role API key the os bridge uses to write Twenty records, and appends it to the
// env file directly so the token never has to be copied through a chat or a terminal scrollback.
@Command({ name: 'os:api-key', description: 'Creates the Conversifi OS bridge API key and appends OS_TWENTY_API_KEY to an env file' })
export class OsApiKeyCommand extends CommandRunner {
  private readonly logger = new Logger(OsApiKeyCommand.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly apiKeyService: ApiKeyService,
  ) {
    super();
  }

  @Option({ flags: '-a, --append-env <path>', description: 'env file to append OS_TWENTY_API_KEY= to', required: true })
  parseAppendEnv(value: string): string {
    return value;
  }

  async run(_params: string[], options: OsApiKeyCommandOptions): Promise<void> {
    const [target]: { workspaceId: string; roleId: string }[] = await this.dataSource.query(
      `select w.id as "workspaceId", r.id as "roleId"
       from core.workspace w
       join core.role r on r."workspaceId" = w.id and r.label = 'Admin'
       where w."deletedAt" is null
       order by w."createdAt"
       limit 1`,
    );
    if (!target) throw new Error('no workspace with an Admin role found');

    const expiresAt = new Date(Date.now() + ONE_HUNDRED_YEARS_MS);
    const apiKey = await this.apiKeyService.create({
      name: 'Conversifi OS bridge',
      expiresAt,
      workspaceId: target.workspaceId,
      roleId: target.roleId,
    });
    const tokenResult = await this.apiKeyService.generateApiKeyToken(target.workspaceId, apiKey.id, expiresAt);
    if (!tokenResult?.token) throw new Error('token generation returned nothing');

    appendFileSync(options.appendEnv, `\n# Workspace API key for the Conversifi OS bridge (os:api-key, id ${apiKey.id})\nOS_TWENTY_API_KEY=${tokenResult.token}\n`);
    this.logger.log(`api key ${apiKey.id} created for workspace ${target.workspaceId}; token appended to ${options.appendEnv}`);
  }
}
