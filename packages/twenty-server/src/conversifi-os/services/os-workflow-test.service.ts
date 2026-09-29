import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { evalFromContext, isDefined, isValidUuid, resolveInput as resolveWorkflowInput } from 'twenty-shared/utils';
import { DataSource } from 'typeorm';

import { SendEmailTool } from 'src/engine/core-modules/tool/tools/email-tool/send-email-tool';
import { type EmailToolInput } from 'src/engine/core-modules/tool/tools/email-tool/types/email-tool-input.type';
import { resolveEmailBody } from 'src/modules/workflow/workflow-executor/workflow-actions/mail-sender/utils/resolve-email-body.util';
import { resolveEmailFiles } from 'src/modules/workflow/workflow-executor/workflow-actions/mail-sender/utils/resolve-email-files.util';
import { type WorkflowSendEmailActionInput } from 'src/modules/workflow/workflow-executor/workflow-actions/mail-sender/types/workflow-send-email-action-input.type';

const WORKSPACE_SCHEMA = 'workspace_a1aip8pgko71t0v2lrw9rnizs';
const VARIABLE_PATTERN = /\{\{[^{}]+\}\}/g;
const PLURALS: Record<string, string> = { person: 'people', company: 'companies', opportunity: 'opportunities', workspaceMember: 'workspaceMembers' };

type WorkflowStep = { id: string; type: string; settings?: { input?: Record<string, unknown> } };

export type SendTestArgs = {
  workspaceId: string;
  userWorkspaceId: string;
  userEmail: string;
  workflowVersionId: string;
  stepId: string;
  input?: Partial<WorkflowSendEmailActionInput>;
  samplePersonId?: string;
  // Admins may aim the test at another inbox (a colleague, a personal address).
  to?: string;
  allowOtherSender: boolean;
};

// "Send test" on an email step: renders the step the way a real run would, against the most
// recent lead as the trigger record and a sample record for every Find step, then sends it to
// the person who clicked. Values a run computes on the fly (code and HTTP steps) stay blank.
@Injectable()
export class OsWorkflowTestService {
  private readonly logger = new Logger(OsWorkflowTestService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sendEmailTool: SendEmailTool,
  ) {}

  async sendTest(args: SendTestArgs) {
    const steps = await this.loadSteps(args.workflowVersionId);
    const step = steps.find((candidate) => candidate.id === args.stepId);
    if (!step) throw new BadRequestException('That step no longer exists. Save the workflow and try again.');
    if (step.type !== 'SEND_EMAIL' && step.type !== 'DRAFT_EMAIL') throw new BadRequestException('Only email steps can be tested.');

    const rawInput = { ...(step.settings?.input ?? {}), ...(args.input ?? {}) } as WorkflowSendEmailActionInput;
    const { context, sampleName } = await this.buildContext(steps, args.userEmail, args.samplePersonId);

    const unresolved = this.unresolvedVariables(`${rawInput.subject ?? ''} ${rawInput.body ?? ''}`, context);
    const placeholders = this.fillPlaceholders(unresolved, context);
    const body = isDefined(rawInput.body) ? await resolveEmailBody(rawInput.body, context) : '';
    const files = resolveEmailFiles(rawInput.files, context);
    const { body: _ignoredBody, files: _ignoredFiles, ...rest } = rawInput;
    const resolved = resolveWorkflowInput(rest, context) as Omit<WorkflowSendEmailActionInput, 'body' | 'files'>;

    const sender = await this.pickSender(resolved.connectedAccountId, args);
    const subject = `[Test] ${resolved.subject ?? ''}`.trim();
    const output = await this.sendEmailTool.execute(
      {
        recipients: { to: args.to ?? args.userEmail, cc: '', bcc: '' },
        subject,
        body,
        // Same loose hand-off the workflow email action makes: the tool validates the shape itself.
        files: files as unknown as EmailToolInput['files'],
        connectedAccountId: sender.connectedAccountId,
        ...(sender.own ? {} : { fromHandle: resolved.fromHandle || undefined }),
      },
      { workspaceId: args.workspaceId, userWorkspaceId: args.userWorkspaceId },
    );
    if (!output.success) {
      this.logger.warn(`workflow test send failed: ${output.error ?? output.message}`);
      throw new BadRequestException(output.error ?? output.message ?? 'Could not send the test');
    }
    const rendered = (output.result as { sanitizedHtmlBody?: string } | undefined)?.sanitizedHtmlBody ?? null;
    return { ok: true, to: args.to ?? args.userEmail, from: sender.handle, sample: sampleName, placeholders, senderNote: sender.note, subject, html: rendered };
  }

  private async loadSteps(workflowVersionId: string): Promise<WorkflowStep[]> {
    if (!isValidUuid(workflowVersionId)) throw new BadRequestException('workflowVersionId is required');
    const rows: { steps: WorkflowStep[] | null }[] = await this.dataSource.query(
      `select steps from ${WORKSPACE_SCHEMA}."workflowVersion" where id = $1 and "deletedAt" is null`,
      [workflowVersionId],
    );
    return rows[0]?.steps ?? [];
  }

  // The trigger record is the newest lead with a closer, so closer variables have something to
  // point at; each Find step gets one real record of its object.
  private async buildContext(steps: WorkflowStep[], userEmail: string, samplePersonId?: string) {
    const person =
      (samplePersonId && isValidUuid(samplePersonId) ? await this.restFirst('people', `filter=id[eq]:${samplePersonId}`) : null) ??
      (await this.restFirst('people', `filter=closerEmail[is]:NOT_NULL&order_by=createdAt[DescNullsLast]`)) ??
      (await this.restFirst('people', `order_by=createdAt[DescNullsLast]`));
    const context: Record<string, unknown> = {
      trigger: { properties: { after: person ?? {}, before: person ?? {}, recordId: person?.id ?? null, updatedFields: [] } },
    };
    for (const step of steps) {
      if (step.type !== 'FIND_RECORDS') continue;
      const objectName = String(step.settings?.input?.objectName ?? '');
      if (!objectName) continue;
      const plural = PLURALS[objectName] ?? `${objectName}s`;
      const record =
        objectName === 'workspaceMember'
          ? await this.sampleMember(String(person?.closerEmail ?? ''), userEmail)
          : objectName === 'person'
            ? person
            : await this.restFirst(plural, `order_by=createdAt[DescNullsLast]`);
      context[step.id] = record ? { first: record, all: [record], totalCount: 1 } : { first: null, all: [], totalCount: 0 };
    }
    const name = person ? `${(person.name as { firstName?: string })?.firstName ?? ''} ${(person.name as { lastName?: string })?.lastName ?? ''}`.trim() : '';
    return { context, sampleName: name || (person?.id as string | undefined) || 'no lead found' };
  }

  // A "which closer" lookup lands on the sample lead's closer, the way a run would; the tester
  // stands in only when that lead has no closer with a login.
  private async sampleMember(closerEmail: string, userEmail: string) {
    const byEmail = (email: string) => this.restFirst('workspaceMembers', `filter=userEmail[eq]:${encodeURIComponent(JSON.stringify(email))}`);
    return (closerEmail ? await byEmail(closerEmail) : null) ?? (await byEmail(userEmail));
  }

  private async restFirst(plural: string, query: string): Promise<Record<string, unknown> | null> {
    const apiKey = process.env.OS_TWENTY_API_KEY;
    if (!apiKey) return null;
    try {
      const response = await fetch(`http://127.0.0.1:${process.env.NODE_PORT ?? '3000'}/rest/${plural}?limit=1&${query}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) return null;
      const payload = (await response.json()) as { data?: Record<string, Record<string, unknown>[]> };
      return payload.data?.[plural]?.[0] ?? null;
    } catch (error) {
      this.logger.warn(`workflow test: sample ${plural} lookup failed: ${(error as Error).message}`);
      return null;
    }
  }

  private unresolvedVariables(text: string, context: Record<string, unknown>): string[] {
    const seen = new Set<string>();
    for (const variable of text.match(VARIABLE_PATTERN) ?? []) {
      const value = evalFromContext(variable, context);
      if (value === undefined || value === null || value === '') seen.add(variable);
    }
    return [...seen];
  }

  // A value only a run can compute (code or HTTP step output) is shown as its own name in
  // brackets, so the test still reads like the email instead of having holes in it.
  private fillPlaceholders(unresolved: string[], context: Record<string, unknown>): string[] {
    const placeholders: string[] = [];
    for (const variable of unresolved) {
      const path = variable.slice(2, -2).trim().split('.');
      const leaf = path[path.length - 1];
      if (path.length < 2 || !/^[\w-]+$/.test(leaf)) continue;
      let node = context;
      for (const key of path.slice(0, -1)) {
        if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
        node = node[key] as Record<string, unknown>;
      }
      node[leaf] = `[${leaf}]`;
      placeholders.push(`[${leaf}]`);
    }
    return placeholders;
  }

  // The configured sender may be a connected account id or, through a variable, a workspace
  // member id. Anything that does not land on a mailbox falls back to the tester's own, as
  // does everything for members without the admin permission.
  private async pickSender(configured: string | undefined, args: SendTestArgs) {
    const own: { id: string; handle: string }[] = await this.dataSource.query(
      `select id, handle from core."connectedAccount" where "userWorkspaceId" = $1 and "workspaceId" = $2 and "archivedAt" is null order by "createdAt" limit 1`,
      [args.userWorkspaceId, args.workspaceId],
    );
    if (args.allowOtherSender && isDefined(configured) && isValidUuid(configured)) {
      const direct: { id: string; handle: string }[] = await this.dataSource.query(
        `select id, handle from core."connectedAccount" where id = $1 and "workspaceId" = $2 and "archivedAt" is null`,
        [configured, args.workspaceId],
      );
      if (direct[0]) return { connectedAccountId: direct[0].id, handle: direct[0].handle, own: direct[0].id === own[0]?.id, note: null };
      // Same rule as the live email step: the member's own mailbox, else the mailbox carrying their address.
      const viaMember: { id: string; handle: string }[] = await this.dataSource.query(
        `select ca.id, ca.handle from ${WORKSPACE_SCHEMA}."workspaceMember" wm
           join core."connectedAccount" ca on ca."workspaceId" = $2 and ca."archivedAt" is null
            and (ca."userWorkspaceId" in (select id from core."userWorkspace" where "userId" = wm."userId") or lower(ca.handle) = lower(wm."userEmail"))
          where wm.id = $1
          order by (ca."userWorkspaceId" in (select id from core."userWorkspace" where "userId" = wm."userId")) desc, ca."createdAt" limit 1`,
        [configured, args.workspaceId],
      );
      if (viaMember[0]) return { connectedAccountId: viaMember[0].id, handle: viaMember[0].handle, own: viaMember[0].id === own[0]?.id, note: null };
    }
    if (!own[0]) throw new BadRequestException('Connect a mailbox in Settings before sending a test.');
    const note = isDefined(configured) && configured !== '' ? 'The configured sender had no mailbox in this test, so it went from yours.' : null;
    return { connectedAccountId: own[0].id, handle: own[0].handle, own: true, note };
  }
}
