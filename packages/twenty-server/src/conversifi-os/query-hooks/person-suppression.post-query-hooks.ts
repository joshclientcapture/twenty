import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import { type WorkspacePostQueryHookInstance } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/interfaces/workspace-query-hook.interface';

import { WorkspaceQueryHook, type WorkspaceQueryHookKey } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/decorators/workspace-query-hook.decorator';
import { WorkspaceQueryHookType } from 'src/engine/api/graphql/workspace-query-runner/workspace-query-hook/types/workspace-query-hook.type';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { getWorkspaceSchemaName } from 'src/engine/workspace-datasource/utils/get-workspace-schema-name.util';

// Deleting a person in the CRM means "gone": their addresses go on the suppression list (so the
// importer and the OS pages ignore them and the sync never re-creates them) and their bookings are
// soft-deleted with them. Restoring the person reverses both.
type DeletedRecord = { id?: string };

@Injectable()
export class PersonSuppressionService {
  private readonly logger = new Logger(PersonSuppressionService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private ids(payload: unknown): string[] {
    const records = Array.isArray(payload) ? payload : [payload];
    return records.map((record) => (record as DeletedRecord)?.id).filter((id): id is string => typeof id === 'string');
  }

  async suppress(workspaceId: string, payload: unknown) {
    const ids = this.ids(payload);
    if (!ids.length) return;
    const schema = getWorkspaceSchemaName(workspaceId);
    await this.dataSource.query(
      `insert into os.suppressed_emails (email, reason)
       select lower(email), 'deleted in CRM' from (
         select "emailsPrimaryEmail" as email from ${schema}.person where id = any($1::uuid[])
         union select jsonb_array_elements_text(coalesce("emailsAdditionalEmails", '[]'::jsonb)) from ${schema}.person where id = any($1::uuid[])
       ) addresses where coalesce(email, '') <> ''
       on conflict (email) do nothing`,
      [ids],
    );
    const result = await this.dataSource.query(
      `update ${schema}."_booking" set "deletedAt" = now() where "personId" = any($1::uuid[]) and "deletedAt" is null returning id`,
      [ids],
    );
    this.logger.log(`suppressed ${ids.length} deleted people, ${result.length} bookings deleted with them`);
  }

  async unsuppress(workspaceId: string, payload: unknown) {
    const ids = this.ids(payload);
    if (!ids.length) return;
    const schema = getWorkspaceSchemaName(workspaceId);
    await this.dataSource.query(
      `delete from os.suppressed_emails where email in (
         select lower("emailsPrimaryEmail") from ${schema}.person where id = any($1::uuid[])
         union select lower(jsonb_array_elements_text(coalesce("emailsAdditionalEmails", '[]'::jsonb))) from ${schema}.person where id = any($1::uuid[])
       )`,
      [ids],
    );
    const result = await this.dataSource.query(
      `update ${schema}."_booking" set "deletedAt" = null where "personId" = any($1::uuid[]) and "deletedAt" is not null returning id`,
      [ids],
    );
    this.logger.log(`restored ${ids.length} people, ${result.length} bookings restored with them`);
  }
}

const makeHook = (method: string, action: 'suppress' | 'unsuppress') => {
  @WorkspaceQueryHook({ key: `person.${method}` as WorkspaceQueryHookKey, type: WorkspaceQueryHookType.POST_HOOK })
  class PersonSuppressionHook implements WorkspacePostQueryHookInstance {
    constructor(private readonly suppression: PersonSuppressionService) {}

    async execute(authContext: WorkspaceAuthContext, _objectName: string, payload: unknown): Promise<void> {
      await this.suppression[action](authContext.workspace.id, payload);
    }
  }
  Object.defineProperty(PersonSuppressionHook, 'name', { value: `PersonSuppression_${method}` });
  return PersonSuppressionHook;
};

export const PERSON_SUPPRESSION_HOOKS = [
  makeHook('deleteOne', 'suppress'),
  makeHook('deleteMany', 'suppress'),
  makeHook('restoreOne', 'unsuppress'),
  makeHook('restoreMany', 'unsuppress'),
];
