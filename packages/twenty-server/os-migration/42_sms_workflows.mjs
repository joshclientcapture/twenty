// Melanie's SMS chase as native Twenty workflows, mirroring GHL "AI SMS - Lead not booked after 15 min"
// and n8n "SMS Replier - 15 Min" node for node:
//   1. "SMS chase: lead didn't book" (person created / updated with a form time): wait 15 min → open the
//      thread (server says go or not) → opener → typo fix → +30 min "all good?" → +1 d → +3 d, each step
//      checked against a reply or a booking first.
//   2. "SMS reply: Melanie answers" (webhook from the Twilio receiver): pause → fetch transcript → build the
//      Gemini request (the three route briefs live in that code step) → HTTP to Gemini → parse → send →
//      if a human is needed: mark the thread, create a task on the person, post to Discord.
// The server keeps only what n8n also kept outside the builder: the signed Twilio receiver and the thread
// store behind /os/sms/{thread,state,send,mark}/<token>.
// Run on the VPS: node os-migration/42_sms_workflows.mjs [--rebuild] [--activate] [--quick] [--test chase|reply]
//   --quick   builds with seconds instead of minutes and days, for a live test; rebuild without it afterwards
import { readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const API_KEY = env.OS_TWENTY_API_KEY;
const BASE = `http://127.0.0.1:${env.NODE_PORT ?? '3000'}`;
const PUBLIC = env.SERVER_URL ?? 'https://crm.conversifi.io';
const WORKSPACE_ID = env.OS_WORKSPACE_ID ?? 'a984b071-b213-4117-9f6e-106129143ee8';
const SMS_TOKEN = env.OS_TWILIO_WEBHOOK_TOKEN;
const GEMINI_KEY = env.OS_GEMINI_API_KEY ?? '';
const GEMINI_MODEL = env.OS_GEMINI_MODEL ?? 'gemini-3-flash-preview';
const DISCORD = env.OS_SMS_DISCORD_WEBHOOK ?? env.OS_HEALTH_DISCORD_WEBHOOK ?? '';
const args = process.argv.slice(2);
const REBUILD = args.includes('--rebuild');
const ACTIVATE = args.includes('--activate');
const QUICK = args.includes('--quick');
const TEST = args.includes('--test') ? args[args.indexOf('--test') + 1] : null;
if (!API_KEY) throw new Error('OS_TWENTY_API_KEY must be set');
if (!SMS_TOKEN) throw new Error('OS_TWILIO_WEBHOOK_TOKEN must be set');

const userToken = () => {
  const { OS_TEST_USER_ID, OS_TEST_USER_WORKSPACE_ID, OS_TEST_MEMBER_ID, APP_SECRET } = env;
  const key = createHash('sha256').update(`${APP_SECRET}${WORKSPACE_ID}ACCESS`).digest('hex');
  return jwt.sign({ sub: OS_TEST_USER_ID, userId: OS_TEST_USER_ID, workspaceId: WORKSPACE_ID, workspaceMemberId: OS_TEST_MEMBER_ID, userWorkspaceId: OS_TEST_USER_WORKSPACE_ID, type: 'ACCESS', authProvider: 'password', isImpersonating: false }, key, { expiresIn: '1h' });
};
const post = async (path, body, token = API_KEY) => {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(body) });
  return response.text();
};
const mcp = async (name, toolArguments) => {
  const raw = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_tool', arguments: { toolName: name, arguments: toolArguments } } });
  const data = raw.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('');
  const parsed = JSON.parse(data || raw);
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  const content = parsed.result?.content?.[0]?.text ?? '';
  try { return JSON.parse(content); } catch { return content; }
};
const gql = async (path, query, variables = {}, token = API_KEY) => {
  const payload = JSON.parse(await post(path, { query, variables }, token));
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data;
};
const leaf = (label, value) => ({ icon: 'IconVariable', type: Array.isArray(value) ? 'array' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string', label, value, isLeaf: true });
const schemaOf = (sample) => Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, leaf(key, value)]));

// ---------- step builders (same shapes as 22_sequences.mjs) ----------
const errorHandling = { retryOnFailure: { value: 1 }, continueOnFailure: { value: false } };
const step = (type, name, input, settingsExtra = {}) => ({ id: randomUUID(), name, type, valid: true, nextStepIds: [], settings: { input, outputSchema: {}, errorHandlingOptions: errorHandling, ...settingsExtra } });
const wait = (name, duration) => step('DELAY', name, { delayType: 'DURATION', duration });
const code = (name, key, source, input, outputSample) => ({ ...step('CODE', name, {}), _code: { key, source, input, outputSample } });
const condition = (key, type, operand, value = '') => ({ key, type, operand, value });
const branch = (name, conditions, then, otherwise = []) => ({ _if: { name, branches: [{ conditions, steps: then }], otherwise } });
// A run stores the HTTP response body as the step's result, so fields sit at the top level: {{step.go}}.
const http = (name, url, body, sample) => step('HTTP_REQUEST', name, { url, method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, { outputSchema: schemaOf(sample), expectedOutputSchema: sample });
const createRecord = (name, objectName, objectRecord) => step('CREATE_RECORD', name, { objectName, objectRecord });
const sms = (name, threadIdExpression, bodyExpression, kind) => http(name, `${PUBLIC}/os/sms/send/${SMS_TOKEN}`, { threadId: threadIdExpression, body: bodyExpression, kind }, { ok: 'yes', reason: '' });
const stateCall = (name, threadIdExpression) => http(name, `${PUBLIC}/os/sms/state/${SMS_TOKEN}`, { threadId: threadIdExpression }, { found: 'yes', status: 'opener_sent', route: 'dfy', firstName: 'Sam', fullName: 'Sam Carter', phone: '+447700900000', personId: '', replied: '', booked: '', live: 'yes', chase: 'yes', who: '', transcript: '' });
const R = (node, field) => `{{${node.id}.${field}}}`;

const layout = (list) => {
  const steps = [];
  const walk = (items) => {
    let firstId = null;
    let previous = null;
    for (const item of items) {
      let node;
      if (item._if) {
        node = step('IF_ELSE', item._if.name, {});
        const groups = [];
        const filters = [];
        const branchList = item._if.branches.map((entry) => {
          const groupId = randomUUID();
          groups.push({ id: groupId, logicalOperator: 'AND' });
          entry.conditions.forEach((cond, position) => filters.push({ id: randomUUID(), type: cond.type, stepOutputKey: cond.key, operand: cond.operand, value: cond.value, stepFilterGroupId: groupId, positionInStepFilterGroup: position }));
          const first = walk(entry.steps);
          return { id: randomUUID(), filterGroupId: groupId, nextStepIds: first ? [first] : [] };
        });
        const otherwiseFirst = walk(item._if.otherwise.length ? item._if.otherwise : [step('EMPTY', 'Stop', {})]);
        branchList.push({ id: randomUUID(), nextStepIds: [otherwiseFirst] });
        node.settings.input = { stepFilterGroups: groups, stepFilters: filters, branches: branchList };
        node.nextStepIds = [];
      } else {
        node = item;
      }
      steps.push(node);
      if (previous) previous.nextStepIds = [node.id];
      if (!firstId) firstId = node.id;
      previous = node;
    }
    return firstId;
  };
  const firstId = walk(list);
  return { steps, firstId };
};

const trigger = {
  created: (object) => ({ name: `${object} created`, type: 'DATABASE_EVENT', settings: { eventName: `${object}.created`, outputSchema: {} } }),
  updated: (object, fields) => ({ name: `${object} updated`, type: 'DATABASE_EVENT', settings: { eventName: `${object}.updated`, fields, outputSchema: {} } }),
  webhook: (sample) => ({ name: 'Twilio reply', type: 'WEBHOOK', settings: { httpMethod: 'POST', authentication: null, expectedBody: sample, expectedOutputSchema: sample, outputSchema: schemaOf(sample) } }),
};
const T = { id: '{{trigger.properties.after.id}}', field: (name) => `{{trigger.properties.after.${name}}}` };

// ---------- code steps ----------
const RECENT_CODE = String.raw`
export const main = async (params) => {
  const at = params.at ? new Date(params.at).getTime() : NaN;
  const hours = Number(params.hours) || 2;
  const now = Date.now();
  const recent = Number.isFinite(at) && now - at <= hours * 3600000 && at - now <= 3600000;
  return { recent: recent ? 'yes' : 'no' };
};
`;

// The three briefs, lifted from the server constants so the builder holds an editable copy.
const promptsSource = readFileSync(new URL('../src/conversifi-os/constants/os-sms-prompts.constant.ts', import.meta.url), 'utf8');
const promptLiteral = (name) => {
  const match = promptsSource.match(new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;\\n`));
  if (!match) throw new Error(`${name} not found in os-sms-prompts.constant.ts`);
  return match[1];
};
const PREP_CODE = `const BRIEFS = {
  agency: { link: 'https://agencies.conversifi.io/book', prompt: \`${promptLiteral('AGENCY_SYSTEM_PROMPT')}\` },
  demo: { link: 'https://conversifi.io/demo', prompt: \`${promptLiteral('DEMO_SYSTEM_PROMPT')}\` },
  dfy: { link: 'https://conversifi.io/calendar', prompt: \`${promptLiteral('DFY_SYSTEM_PROMPT')}\` },
};

export const main = async (params) => {
  const brief = BRIEFS[params.route] || BRIEFS.demo;
  const systemPrompt = brief.prompt.split('{{BOOKING_LINK}}').join(brief.link);
  const userPrompt = \`PROSPECT NAME: \${params.fullName}

CONVERSATION HISTORY:
\${params.transcript}

Agent is us (Melanie acting on behalf of Conversifi), contact is \${params.who || 'the prospect we are trying to book in'}.

Respond naturally to their most recent message based on your instructions. Keep it conversational and under 40 words, 30 where possible.

The message is for SMS responses so use \\\\n\\\\n line breaks to format it for easy readability.\`;
  return {
    body: {
      contents: [{ parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { temperature: 1, maxOutputTokens: 8000, topP: 0.95, thinkingConfig: { thinkingLevel: 'low' } },
    },
  };
};
`;

const PARSE_CODE = String.raw`
export const main = async (params) => {
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  const parts = (candidates[0] && candidates[0].content && candidates[0].content.parts) || [];
  let text = '';
  for (const part of parts) if (part.text && !part.thought) { text = part.text; break; }
  if (!text && parts.length) text = parts[parts.length - 1].text || '';
  text = String(text).trim();
  if (text.startsWith('` + '```json' + String.raw`')) text = text.slice(7);
  else if (text.startsWith('` + '```' + String.raw`')) text = text.slice(3);
  if (text.endsWith('` + '```' + String.raw`')) text = text.slice(0, -3);
  try {
    const parsed = JSON.parse(text.trim());
    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      human: parsed.needsHumanIntervention ? 'yes' : '',
      reason: parsed.reason || '',
      interest: parsed.interestLevel || 'neutral',
    };
  } catch (error) {
    return { message: '', human: 'yes', reason: 'could not parse the reply: ' + error.message + '; raw: ' + text.slice(0, 200), interest: 'neutral' };
  }
};
`;

const DISCORD_CODE = String.raw`
export const main = async (params) => ({
  body: {
    username: 'Melanie SMS',
    embeds: [{
      title: '🙋 SMS handoff: ' + (params.fullName || params.phone) + ' (' + String(params.route || '').toUpperCase() + ')',
      description: '**Why:** ' + (params.reason || 'the bot asked for a human') + '\n\n' + String(params.transcript || '').slice(-1500),
      color: 15158332,
    }],
  },
});
`;

// ---------- the two workflows ----------
const minutes = (n) => (QUICK ? { seconds: Math.max(5, Math.round(n)) } : { minutes: n });
const days = (n) => (QUICK ? { seconds: 20 * n } : { days: n });

const chaseWorkflow = (event) => {
  const recent = code('Fresh form?', 'RECENT', RECENT_CODE, { at: T.field('latestFormAt'), hours: 2 }, { recent: 'yes' });
  const thread = http('Open the SMS thread', `${PUBLIC}/os/sms/thread/${SMS_TOKEN}`, { personId: T.id, route: T.field('latestSource') }, { go: 'yes', reason: '', threadId: '', route: 'dfy', firstName: 'Sam', fullName: 'Sam Carter', phone: '+447700900000', opener: '', typoFix: '', ladder1: '', ladder2: '', ladder3: '', bookingLink: '' });
  const threadId = R(thread, 'threadId');
  const check1 = stateCall('Where does it stand? (30 min)', threadId);
  const check2 = stateCall('Where does it stand? (1 day)', threadId);
  const check3 = stateCall('Where does it stand? (3 days)', threadId);
  const noReply = (node) => [condition(R(node, 'chase'), 'TEXT', 'IS', 'yes')];
  return {
    key: `chase-${event}`,
    name: `SMS chase: lead didn't book · on ${event}`,
    description: 'Ported from GHL "AI SMS - Lead not booked after 15 min" for DFY, demo and agency form leads. 15 minutes after the form with no booking: Melanie\'s opener and typo fix, then "all good?" at 30 minutes, the "no better day" text at 1 day and the final text at 3 days. A reply or a booking stops it; replies are answered by "SMS reply: Melanie answers".',
    trigger: event === 'created' ? trigger.created('person') : trigger.updated('person', ['latestFormAt']),
    steps: [
      recent,
      branch('Form just came in?', [condition('{{RECENT.recent}}', 'TEXT', 'IS', 'yes')], [
        wait('Wait 15 minutes', minutes(15)),
        thread,
        branch('Still not booked?', [condition(R(thread, 'go'), 'TEXT', 'IS', 'yes')], [
          sms('Melanie: opener', threadId, R(thread, 'opener'), 'opener'),
          wait('Wait 15 seconds', { seconds: 15 }),
          sms('Melanie: typo fix', threadId, R(thread, 'typoFix'), 'typo'),
          wait('Wait 30 minutes', minutes(30)),
          check1,
          branch('No reply, no booking?', noReply(check1), [
            sms('Melanie: all good?', threadId, R(thread, 'ladder1'), 'ladder'),
            wait('Wait 1 day', days(1)),
            check2,
            branch('Still no reply?', noReply(check2), [
              sms('Melanie: no better day than today', threadId, R(thread, 'ladder2'), 'ladder'),
              wait('Wait 3 days', days(3)),
              check3,
              branch('Still nothing?', noReply(check3), [
                sms('Melanie: the world waits for no one', threadId, R(thread, 'ladder3'), 'ladder'),
                http('Close the thread', `${PUBLIC}/os/sms/mark/${SMS_TOKEN}`, { threadId, status: 'stopped', reason: 'no reply after the ladder' }, { ok: 'yes', reason: '' }),
              ]),
            ]),
          ]),
        ]),
      ]),
    ],
    testPayload: (personId) => ({ id: personId, latestFormAt: new Date().toISOString(), latestSource: 'DFY' }),
  };
};

const REPLY_SAMPLE = { threadId: '00000000-0000-0000-0000-000000000000', personId: '00000000-0000-0000-0000-000000000000', route: 'dfy', phone: '+447700900000', firstName: 'Sam', fullName: 'Sam Carter', message: 'How much does it cost?' };
const replyWorkflow = () => {
  const state = stateCall('Fetch the conversation', '{{trigger.threadId}}');
  const prep = code('Build the Gemini request', 'PREP', PREP_CODE, { route: R(state, 'route'), fullName: R(state, 'fullName'), who: R(state, 'who'), transcript: R(state, 'transcript') }, { body: {} });
  const gemini = step('HTTP_REQUEST', 'Ask Gemini', { url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, body: '{{PREP.body}}' }, { outputSchema: { candidates: leaf('candidates', []) }, expectedOutputSchema: { candidates: [] } });
  const parse = code('Read the reply', 'PARSE', PARSE_CODE, { candidates: `{{${gemini.id}.candidates}}` }, { message: 'Sure, here is how it works.', human: '', reason: '', interest: 'neutral' });
  const task = createRecord('Task for the closer', 'task', { title: 'SMS handoff: {{trigger.fullName}}', status: 'TODO', bodyV2: { markdown: 'Melanie\'s SMS bot needs a human on the {{trigger.route}} thread with {{trigger.phone}}.\n\n**Why:** {{PARSE.reason}}\n\n---\n\n' + R(state, 'transcript') } });
  const target = createRecord('Link the task to the person', 'taskTarget', { taskId: `{{${task.id}.id}}`, targetPersonId: '{{trigger.personId}}' });
  const discordMessage = code('Discord card', 'DISCORD', DISCORD_CODE, { fullName: '{{trigger.fullName}}', phone: '{{trigger.phone}}', route: '{{trigger.route}}', reason: '{{PARSE.reason}}', transcript: R(state, 'transcript') }, { body: {} });
  return {
    key: 'reply',
    name: 'SMS reply: Melanie answers',
    description: 'Ported from n8n "SMS Replier - 15 Min". The Twilio receiver posts each reply here: a short pause, the transcript, the Gemini brief for the route (agency, demo or DFY), the answer by text. When Gemini asks for a human the thread is handed off: task on the person, Discord card, bot stops replying.',
    trigger: trigger.webhook(REPLY_SAMPLE),
    steps: [
      wait('Think for a moment', QUICK ? { seconds: 5 } : { seconds: 45 }),
      state,
      branch('Bot still on this thread?', [condition(R(state, 'live'), 'TEXT', 'IS', 'yes')], [
        prep,
        gemini,
        parse,
        sms('Melanie replies', '{{trigger.threadId}}', '{{PARSE.message}}', 'ai'),
        branch('Needs a human?', [condition('{{PARSE.human}}', 'TEXT', 'IS', 'yes')], [
          http('Hand the thread off', `${PUBLIC}/os/sms/mark/${SMS_TOKEN}`, { threadId: '{{trigger.threadId}}', status: 'handed_off', reason: '{{PARSE.reason}}' }, { ok: 'yes', reason: '' }),
          task,
          target,
          discordMessage,
          ...(DISCORD ? [step('HTTP_REQUEST', 'Post to Discord', { url: DISCORD, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{{DISCORD.body}}' }, { outputSchema: { status: leaf('status', 204) }, expectedOutputSchema: { status: 204 } })] : []),
        ]),
      ]),
    ],
    testPayload: () => REPLY_SAMPLE,
  };
};

const WORKFLOWS = [chaseWorkflow('created'), chaseWorkflow('updated'), replyWorkflow()];

// ---------- create ----------
const existing = (await gql('/graphql', `{ workflows(first: 200) { edges { node { id name statuses versions { edges { node { id status } } } } } } }`)).workflows.edges.map((edge) => edge.node);
const destroyWorkflow = async (workflow) => {
  for (const { node } of workflow.versions.edges) if (node.status === 'ACTIVE') await mcp('deactivate_workflow_version', { workflowVersionId: node.id });
  await gql('/graphql', `mutation ($id: UUID!) { deleteWorkflow(id: $id) { id } }`, { id: workflow.id });
  await gql('/graphql', `mutation ($id: UUID!) { destroyWorkflow(id: $id) { id } }`, { id: workflow.id });
};

const created = [];
for (const spec of WORKFLOWS) {
  const previous = existing.find((workflow) => workflow.name === spec.name);
  if (previous && !REBUILD) {
    console.log(`exists: ${spec.name} [${previous.statuses.join(',')}]`);
    created.push({ spec, workflowId: previous.id, versionId: previous.versions.edges.map((edge) => edge.node).find((version) => version.status === 'ACTIVE' || version.status === 'DRAFT')?.id });
    continue;
  }
  if (previous) { await destroyWorkflow(previous); console.log(`rebuilding: ${spec.name}`); }

  const { steps, firstId } = layout(spec.steps);
  const codeSteps = steps.filter((candidate) => candidate._code);
  const insertions = codeSteps.map((codeStep) => {
    const parent = steps.find((candidate) => candidate.nextStepIds.includes(codeStep.id));
    const branchParent = parent ? null : steps.find((candidate) => candidate.type === 'IF_ELSE' && candidate.settings.input.branches.some((entry) => entry.nextStepIds.includes(codeStep.id)));
    const next = codeStep.nextStepIds[0] ?? null;
    if (parent) parent.nextStepIds = parent.nextStepIds.map((id) => (id === codeStep.id ? next : id)).filter(Boolean);
    if (branchParent) for (const entry of branchParent.settings.input.branches) entry.nextStepIds = entry.nextStepIds.map((id) => (id === codeStep.id ? next : id)).filter(Boolean);
    return { codeStep, parentId: parent?.id ?? branchParent?.id ?? 'trigger', nextId: next, viaBranch: !!branchParent };
  });
  const plainSteps = steps.filter((candidate) => !candidate._code).map(({ _code, ...rest }) => rest);
  const entryId = codeSteps.some((candidate) => candidate.id === firstId) ? insertions.find((entry) => entry.codeStep.id === firstId).nextId : firstId;

  const result = await mcp('create_complete_workflow', {
    name: spec.name, description: spec.description, trigger: spec.trigger, steps: plainSteps, edges: entryId ? [{ source: 'trigger', target: entryId }] : [], activate: false,
  });
  const versionId = result?.result?.workflowVersionId;
  const workflowId = result?.result?.workflowId;
  if (!versionId) { console.log('create failed', spec.name, JSON.stringify(result).slice(0, 1500)); continue; }

  const configuredCodeIds = new Set();
  // A code step inserted later may reference one inserted earlier; its input gets the real ids too.
  const realIds = {};
  for (const { codeStep, parentId, nextId } of insertions) {
    await mcp('create_workflow_version_step', { workflowVersionId: versionId, stepType: 'CODE', parentStepId: parentId, ...(nextId ? { nextStepId: nextId } : {}) });
    const version = (await gql('/graphql', `query ($id: UUID!) { workflowVersion(filter: { id: { eq: $id } }) { id steps } }`, { id: versionId })).workflowVersion;
    const inserted = (version.steps ?? []).find((candidate) => candidate.type === 'CODE' && !configuredCodeIds.has(candidate.id));
    if (inserted) configuredCodeIds.add(inserted.id);
    const logicFunctionId = inserted?.settings?.input?.logicFunctionId;
    if (!logicFunctionId) { console.log('code step missing for', spec.name); break; }
    await mcp('update_logic_function_source', { logicFunctionId, code: codeStep._code.source });
    const logicFunctionInput = JSON.parse(Object.entries(realIds).reduce((text, [key, id]) => text.split(`{{${key}.`).join(`{{${id}.`), JSON.stringify(codeStep._code.input)));
    await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: { ...inserted, name: codeStep.name, settings: { ...inserted.settings, input: { logicFunctionId, logicFunctionInput }, outputSchema: schemaOf(codeStep._code.outputSample) } } });
    realIds[codeStep._code.key] = inserted.id;
    const token = `{{${codeStep._code.key}.`;
    for (const candidate of version.steps.filter((other) => other.id !== inserted.id && JSON.stringify(other).includes(token))) {
      const repointed = JSON.parse(JSON.stringify(candidate).split(token).join(`{{${inserted.id}.`));
      await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: repointed });
    }
  }
  await gql('/graphql', `mutation ($id: UUID!, $data: WorkflowUpdateInput!) { updateWorkflow(id: $id, data: $data) { id } }`, { id: workflowId, data: { folder: 'Sequences / SMS' } });
  const validation = await mcp('validate_workflow', { workflowVersionId: versionId });
  const verdict = validation?.result ?? validation;
  console.log(`built: ${spec.name} (${plainSteps.length + codeSteps.length} steps) valid=${verdict?.valid} ${verdict?.valid ? '' : JSON.stringify(verdict).slice(0, 800)}`);
  if (spec.key === 'reply') console.log(`  reply webhook: ${PUBLIC}/webhooks/workflows/${WORKSPACE_ID}/${workflowId}`);
  created.push({ spec, workflowId, versionId });
}
const reply = created.find((entry) => entry.spec.key === 'reply');
if (reply) console.log(`OS_SMS_REPLY_WEBHOOK_URL=${PUBLIC}/webhooks/workflows/${WORKSPACE_ID}/${reply.workflowId}`);

// ---------- test / activate ----------
if (TEST) {
  const target = created.find((entry) => entry.spec.key.startsWith(TEST));
  if (!target) throw new Error(`no workflow matches ${TEST}`);
  let payload;
  if (TEST === 'reply') payload = target.spec.testPayload();
  else {
    const person = await gql('/graphql', `mutation ($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Dana', lastName: 'Wells' }, emails: { primaryEmail: `dana.wells+${Date.now()}@brightledger.co`, additionalEmails: [] }, phones: { primaryPhoneNumber: '7700900123', primaryPhoneCallingCode: '+44', primaryPhoneCountryCode: 'GB' }, latestSource: 'DFY', latestFormAt: new Date().toISOString() } });
    console.log('test person', person.createPerson.id);
    payload = { properties: { after: target.spec.testPayload(person.createPerson.id) } };
  }
  const run = await gql('/graphql', `mutation ($input: RunWorkflowVersionInput!) { runWorkflowVersion(input: $input) { workflowRunId } }`, { input: { workflowVersionId: target.versionId, payload } }, userToken());
  console.log(`test run of "${target.spec.name}": ${run.runWorkflowVersion.workflowRunId}`);
}
if (ACTIVATE) {
  for (const entry of created) {
    const versions = (await gql('/graphql', `query ($id: UUID!) { workflow(filter: { id: { eq: $id } }) { versions { edges { node { id status } } } } }`, { id: entry.workflowId })).workflow.versions.edges.map((edge) => edge.node);
    const draft = versions.find((version) => version.status === 'DRAFT');
    if (draft) console.log(`activate ${entry.spec.name}:`, JSON.stringify(await mcp('activate_workflow_version', { workflowVersionId: draft.id })).slice(0, 120));
  }
}
