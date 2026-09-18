// Builds the closer/nurture email sequences ported from GoHighLevel + n8n as Twenty workflows made
// of native steps (database-event or manual trigger → search → if/else → delay → send email).
// Run on the VPS: node os-migration/22_sequences.mjs [--rebuild] [--activate] [--test <workflow name part>]
//   --rebuild   destroys existing sequence workflows first (drafts or active) and recreates them
//   --activate  activates every sequence after building (do this only after the first lifecycle sync)
//   --test X    runs the workflow whose name contains X once, with a test payload, and prints the run
import { readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const API_KEY = env.OS_TWENTY_API_KEY;
const BASE = `http://127.0.0.1:${env.NODE_PORT ?? '3000'}`;
const WORKSPACE_ID = env.OS_WORKSPACE_ID ?? 'a984b071-b213-4117-9f6e-106129143ee8';
const args = process.argv.slice(2);
const REBUILD = args.includes('--rebuild');
const ACTIVATE = args.includes('--activate');
const TEST = args.includes('--test') ? args[args.indexOf('--test') + 1] : null;
// --only <name part>: build/rebuild only workflows whose name contains it.
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].toLowerCase() : null;
const TEST_EMAIL = process.env.OS_TEST_EMAIL ?? env.OS_TEST_EMAIL ?? 'jamal@clientcapture.io';
if (!API_KEY) throw new Error('OS_TWENTY_API_KEY must be set');

const userToken = () => {
  const { OS_TEST_USER_ID, OS_TEST_USER_WORKSPACE_ID, OS_TEST_MEMBER_ID, APP_SECRET } = env;
  const key = createHash('sha256').update(`${APP_SECRET}${WORKSPACE_ID}ACCESS`).digest('hex');
  return jwt.sign({ sub: OS_TEST_USER_ID, userId: OS_TEST_USER_ID, workspaceId: WORKSPACE_ID, workspaceMemberId: OS_TEST_MEMBER_ID, userWorkspaceId: OS_TEST_USER_WORKSPACE_ID, type: 'ACCESS', authProvider: 'password', isImpersonating: false }, key, { algorithm: 'HS256', expiresIn: '10m' });
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

// ---------- metadata and mailboxes ----------
const objects = (await gql('/metadata', `{ objects(paging: { first: 1000 }) { edges { node { id nameSingular fieldsList { id name type } } } } }`)).objects.edges.map((edge) => edge.node);
const fieldId = (objectName, fieldName) => {
  const field = objects.find((object) => object.nameSingular === objectName)?.fieldsList.find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`${objectName}.${fieldName} field not found (deploy the server first)`);
  return field.id;
};
// Connected mailboxes live in the core schema, not the records API.
const pgClient = new pg.Client({ connectionString: env.PG_DATABASE_URL });
await pgClient.connect();
const connected = (await pgClient.query('select id, handle, provider from core."connectedAccount" where "workspaceId" = $1', [WORKSPACE_ID])).rows;
await pgClient.end();
const MAILBOXES = {
  'jamal@conversifi.io': { name: 'Jamal', title: 'Jamal Robinson | Founder, Conversifi' },
  'sales@conversifi.io': { name: 'Therapon', title: 'Therapon | Conversifi' },
  'melanie@conversifi.io': { name: 'Melanie', title: 'Melanie Mclean | Conversifi' },
};
const senders = {};
for (const account of connected) {
  const known = MAILBOXES[account.handle.toLowerCase()];
  if (known) senders[account.handle.toLowerCase()] = { ...known, email: account.handle.toLowerCase(), connectedAccountId: account.id };
}
const FALLBACK = senders['jamal@conversifi.io'] ?? Object.values(senders)[0];
if (!FALLBACK) throw new Error('no connected mailbox found');
// The signature always matches the mailbox the email leaves from.
const senderFor = (handle) => senders[handle] ?? FALLBACK;
console.log('mailboxes:', Object.keys(senders).join(', '), '| fallback:', FALLBACK.email);

// ---------- step builders ----------
const errorHandling = { retryOnFailure: { value: 1 }, continueOnFailure: { value: false } };
const step = (type, name, input, settingsExtra = {}) => ({ id: randomUUID(), name, type, valid: true, nextStepIds: [], settings: { input, outputSchema: {}, errorHandlingOptions: errorHandling, ...settingsExtra } });
const findPerson = (idExpression) => step('FIND_RECORDS', 'Refresh person', {
  objectName: 'person', limit: 1,
  filter: { recordFilterGroups: [], recordFilters: [{ id: randomUUID(), fieldMetadataId: fieldId('person', 'id'), type: 'UUID', operand: 'IS', value: idExpression, displayValue: idExpression, label: 'Id' }] },
});
const findBooking = (uriExpression) => step('FIND_RECORDS', 'Refresh booking', {
  objectName: 'booking', limit: 1,
  filter: { recordFilterGroups: [], recordFilters: [{ id: randomUUID(), fieldMetadataId: fieldId('booking', 'calendlyUri'), type: 'TEXT', operand: 'CONTAINS', value: uriExpression, displayValue: uriExpression, label: 'Calendly URI' }] },
});
const wait = (name, duration) => step('DELAY', name, { delayType: 'DURATION', duration });
const waitUntil = (name, expression) => step('DELAY', name, { delayType: 'SCHEDULED_DATE', scheduledDateTime: expression });
const email = (name, sender, to, subject, paragraphs, options = {}) => {
  const body = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.7; color: #1a1a1a; max-width: 600px;">\n${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('\n')}\n${options.noSignature ? '' : `<p>${options.closing ?? 'Best'},<br>${sender.name}</p>\n<p style="font-size:13px;color:#666;">${sender.title}<br>${sender.email}</p>`}\n</div>`;
  return step('SEND_EMAIL', name, { connectedAccountId: sender.connectedAccountId, recipients: { to }, subject, body });
};
const updatePerson = (name, idExpression, fields) => step('UPDATE_RECORD', name, { objectName: 'person', objectRecordId: idExpression, objectRecord: fields, fieldsToUpdate: Object.keys(fields) });
// A code step is inserted after creation (the tool assigns the id); `key` is replaced everywhere.
const code = (name, key, source, input, outputSample) => ({ ...step('CODE', name, {}), _code: { key, source, input, outputSample } });
const condition = (key, type, operand, value = '') => ({ key, type, operand, value });
// An if/else node: branches run in order; the first whose conditions all hold wins, else `otherwise`.
const branch = (name, conditions, then, otherwise = []) => ({ _if: { name, branches: [{ conditions, steps: then }], otherwise } });
const branches = (name, list, otherwise = []) => ({ _if: { name, branches: list, otherwise } });

// Flattens the tree into steps with nextStepIds; if/else nodes must be the last item of their list.
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
        // An unmatched if/else fails the run, so every else branch ends in an explicit Stop step.
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
  manual: (object, label, icon) => ({ name: label, type: 'MANUAL', settings: { objectType: object, icon, isPinned: true, availability: { type: 'SINGLE_RECORD', objectNameSingular: object }, outputSchema: {} } }),
};

// ---------- shared expressions ----------
const P = (stepId) => ({ id: `{{${stepId}.first.id}}`, email: `{{${stepId}.first.emails.primaryEmail}}`, firstName: `{{${stepId}.first.name.firstName}}`, field: (name) => `{{${stepId}.first.${name}}}` });
const T = { id: '{{trigger.properties.after.id}}', email: '{{trigger.properties.after.emails.primaryEmail}}', firstName: '{{trigger.properties.after.name.firstName}}', field: (name) => `{{trigger.properties.after.${name}}}` };
// Stop conditions shared by the sales sequences: converted, paying, not interested, rebooked, opted out.
const stillProspect = (person) => [
  condition(person.field('trialStartedAt'), 'DATE_TIME', 'IS_EMPTY'),
  condition(person.field('payingSince'), 'DATE_TIME', 'IS_EMPTY'),
  condition(person.field('nextBookingAt'), 'DATE_TIME', 'IS_EMPTY'),
  condition(person.field('notInterested'), 'BOOLEAN', 'IS', 'false'),
  condition(person.field('doNotEmail'), 'BOOLEAN', 'IS', 'false'),
  condition(person.field('stage'), 'SELECT', 'IS_NOT', 'DFY_CLIENT'),
  condition(person.field('stage'), 'SELECT', 'IS_NOT', 'SHOWED'),
];
const mayEmail = (person) => [
  condition(person.field('notInterested'), 'BOOLEAN', 'IS', 'false'),
  condition(person.field('doNotEmail'), 'BOOLEAN', 'IS', 'false'),
];

// A guarded step: refresh the person, check, send, wait. Nested so a stop ends the whole run.
const guardedChain = (personId, items, guard) => {
  if (items.length === 0) return [];
  const [item, ...rest] = items;
  const find = findPerson(personId);
  const person = P(find.id);
  const tail = [...item.steps(person), ...(item.wait ? [wait(`Wait ${item.wait.label}`, item.wait.duration)] : []), ...guardedChain(personId, rest, guard)];
  return [find, branch(item.check ?? 'Still a prospect?', [...guard(person), ...(item.also ? item.also(person) : [])], tail)];
};

// ---------- booking time helper (code step) ----------
const BOOKING_TIME_CODE = String.raw`
export const main = async (params) => {
  const booking = params;
  const now = Date.now();
  const start = new Date(booking.startsAt).getTime();
  const timezone = booking.inviteeTimezone || 'UTC';
  let startDate = '', startTime = '';
  try {
    startDate = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(start);
    startTime = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(start).toUpperCase();
  } catch { startDate = new Date(start).toUTCString(); startTime = ''; }
  const hour = 3600000;
  const floor = (at) => new Date(Math.max(at, now + 2 * 60000)).toISOString();
  const firstName = booking.inviteeFirstName || (booking.inviteeName || '').split(/\s+/)[0] || 'there';
  return {
    eligible: booking.status === 'UPCOMING' && start > now && params.types.split(',').includes(booking.bookingType) ? 'yes' : '',
    firstName, startDate, startTime, timezone,
    meetingLocation: booking.joinLink || '',
    rescheduleLink: booking.rescheduleLink || '',
    send24h: start - now > 24 * hour ? 'yes' : '',
    remind24hAt: floor(start - 24 * hour),
    send2h: start - now > 2 * hour ? 'yes' : '',
    remind2hAt: floor(start - 2 * hour),
    remind1hAt: floor(start - hour),
    after15mAt: floor(start + 15 * 60000),
    after45mAt: floor(start + 45 * 60000),
    after21h30At: floor(start + 21.5 * hour),
    isWebinar: booking.bookingType === 'WEBINAR' ? 'yes' : '',
  };
};`;
const A = '{{trigger.properties.after.';
const BOOKING_INPUT = { startsAt: A + 'startsAt}}', status: A + 'status}}', bookingType: A + 'bookingType}}', inviteeTimezone: A + 'inviteeTimezone}}', inviteeFirstName: A + 'inviteeFirstName}}', inviteeName: A + 'inviteeName}}', joinLink: A + 'joinLink.primaryLinkUrl}}', rescheduleLink: A + 'rescheduleLink.primaryLinkUrl}}' };
const BOOKING_TIME_SAMPLE = { eligible: 'yes', firstName: 'Sam', startDate: 'Thursday, 18 September 2026', startTime: '2:00 PM', timezone: 'Europe/London', meetingLocation: 'https://zoom.us/j/1', rescheduleLink: 'https://calendly.com/reschedulings/x', send24h: 'yes', remind24hAt: '2026-09-18T10:00:00.000Z', send2h: 'yes', remind2hAt: '2026-09-18T10:00:00.000Z', remind1hAt: '2026-09-18T10:00:00.000Z', after15mAt: '2026-09-18T10:00:00.000Z', after45mAt: '2026-09-18T10:00:00.000Z', after21h30At: '2026-09-18T10:00:00.000Z', isWebinar: '' };

// ---------- 1. appointment confirmed + reminders (per calendar, from the closer's mailbox) ----------
const APPT_VARIANTS = [
  { key: 'DFY', types: 'DISCOVERY', label: 'Discovery (DFY)', subjects: ['Your Appointment is Confirmed', 'Reminder: Your Appointment is Tomorrow', 'See You in 2 Hours'],
    intro: ['appointment', 'We\'re looking forward to showing you how we can help you generate more qualified appointments and leads for your business on autopilot.', 'We\'ve had a look at the info you provided and we think this could be a really great fit for your business.', 'our meeting is'] },
  { key: 'SAAS', types: 'DEMO', label: 'Demo (SaaS)', subjects: ['Your Demo is Confirmed', 'Reminder: Your Demo is Tomorrow', 'Your Demo is in 2 Hours'],
    intro: ['demo', 'We\'re looking forward to showing you how Conversifi can help you generate leads and book appointments on autopilot through your very own personalised AI agent.', 'We\'ve had a look at your profile and are excited to show you how your very own personalised AI agent can start generating leads for your business.', 'your demo is'] },
  { key: 'AGENCY', types: 'AGENCY_DEMO', label: 'Agency demo', subjects: ['Your Agency Demo is Confirmed', 'Reminder: Your Agency Demo is Tomorrow', 'Your Agency Demo is in 2 Hours'],
    intro: ['demo', 'We\'re looking forward to walking you through how agencies use Conversifi to book more qualified appointments for their clients, and how you can offer it as your own service without building anything from scratch.', 'We\'ve had a look at your agency and we think this could be a strong fit. On the call we\'ll cover how you can add appointment generation to what you already offer your clients, and what the numbers look like.', 'your demo is'] },
];
const closerMailboxes = [...new Set(Object.keys(senders))];
const apptWorkflow = (variant) => {
  const times = code('Call times and eligibility', 'TIMES', BOOKING_TIME_CODE, { ...BOOKING_INPUT, types: variant.types }, BOOKING_TIME_SAMPLE);
  const C = (name) => `{{TIMES.${name}}}`;
  const to = '{{trigger.properties.after.inviteeEmail}}';
  const chainFor = (sender) => {
    const [noun, confirmLine, reminderLine, reminderLead] = variant.intro;
    const confirm = email(`Email 1: confirmed (${sender.name})`, sender, to, variant.subjects[0], [
      `Hi ${C('firstName')},`,
      `Your ${noun} is confirmed for <strong>${C('startDate')}</strong> at <strong>${C('startTime')} ${C('timezone')}</strong>.`,
      confirmLine,
      `Here's your meeting link: ${C('meetingLocation')}`,
      `Need to reschedule? You can do that here: ${C('rescheduleLink')}`,
      'See you soon!',
    ]);
    const twoHourTail = () => {
      const refresh = findBooking('{{trigger.properties.after.calendlyUri}}');
      return [
        waitUntil('Wait until 2 hours before', C('remind2hAt')),
        refresh,
        branch('Still on for today?', [condition(`{{${refresh.id}.first.status}}`, 'SELECT', 'IS', 'UPCOMING'), condition(C('send2h'), 'TEXT', 'IS_NOT_EMPTY')], [
          email(`Email 3: 2 hours (${sender.name})`, sender, to, variant.subjects[2], [
            `Hey ${C('firstName')},`,
            `Just a heads up, ${reminderLead} at <strong>${C('startTime')} ${C('timezone')}</strong> today.`,
            `Here's your meeting link: ${C('meetingLocation')}`,
            `Need to reschedule? ${C('rescheduleLink')}`,
            'See you shortly!',
          ]),
        ]),
      ];
    };
    const refresh24 = findBooking('{{trigger.properties.after.calendlyUri}}');
    return [
      confirm,
      branch('More than 24 hours away?', [condition(C('send24h'), 'TEXT', 'IS_NOT_EMPTY')], [
        waitUntil('Wait until 24 hours before', C('remind24hAt')),
        refresh24,
        branch('Still on for tomorrow?', [condition(`{{${refresh24.id}.first.status}}`, 'SELECT', 'IS', 'UPCOMING')], [
          email(`Email 2: tomorrow (${sender.name})`, sender, to, variant.subjects[1], [
            `Hey ${C('firstName')},`,
            `Just a quick reminder that ${reminderLead} <strong>tomorrow, ${C('startDate')}</strong> at <strong>${C('startTime')} ${C('timezone')}</strong>.`,
            reminderLine,
            `Here's your meeting link: ${C('meetingLocation')}`,
            `Can't make it? No worries, you can reschedule here: ${C('rescheduleLink')}`,
            'Looking forward to it!',
          ]),
          ...twoHourTail(),
        ]),
      ], twoHourTail()),
    ];
  };
  // One branch per connected closer mailbox, keyed on the booking's host; anything else goes out from the fallback.
  const perCloser = closerMailboxes.filter((handle) => handle !== FALLBACK.email).map((handle) => ({ conditions: [condition('{{trigger.properties.after.closerEmail}}', 'TEXT', 'IS', handle)], steps: chainFor(senders[handle]) }));
  const body = perCloser.length ? [branches('Which closer?', perCloser, chainFor(FALLBACK))] : chainFor(FALLBACK);
  return {
    name: `Sequence: appointment confirmed + reminders (${variant.label})`,
    description: `Ported from GHL "APPT CONFIRMED WORKFLOW" + n8n templates. Fires when a ${variant.label} booking is created; sends the closer's confirmation, then a 24h and a 2h reminder while the booking is still upcoming. Webinar bookings are excluded. Sender = the closer's connected mailbox, otherwise ${FALLBACK.email}.`,
    trigger: trigger.created('booking'),
    steps: [times, branch('Eligible booking?', [condition(C('eligible'), 'TEXT', 'IS_NOT_EMPTY')], body)],
    testPayload: () => ({ id: randomUUID(), calendlyUri: 'https://api.calendly.com/scheduled_events/test', startsAt: new Date(Date.now() + 26 * 3600000).toISOString(), status: 'UPCOMING', bookingType: variant.types, inviteeEmail: TEST_EMAIL, inviteeFirstName: 'Jamal', inviteeName: 'Jamal Test', inviteeTimezone: 'Europe/London', closerEmail: 'sales@conversifi.io', joinLink: { primaryLinkUrl: 'https://zoom.us/j/test' }, rescheduleLink: { primaryLinkUrl: 'https://calendly.com/reschedulings/test' } }),
  };
};

// ---------- 2. no-show sequence (16 emails, from the closer's mailbox) ----------
const NO_SHOW_EMAILS = [
  ['Sorry We Missed Each Other', ['Looks like we missed each other today. No worries at all, I know things come up.', 'If you still fancy a chat you can grab another time here https://conversifi.io/calendar'], { days: 1 }],
  ['Still Want to Connect?', ['Just following up on our missed call. I kept your slot flexible in case you want to rebook.', 'You can pick a new time that works for you here https://conversifi.io/calendar'], { days: 2 }],
  ['Happy to Work Around Your Schedule', ['I know schedules get hectic so no pressure at all. If you are still interested you can rebook at a time that suits you here https://conversifi.io/calendar', 'On the call we would cover how you can start filling your calendar with qualified LinkedIn appointments without the manual grind.'], { days: 4 }],
  ['Quick Question', ['Wanted to quickly check in. Was there anything that put you off the call or was it just a timing thing?', 'Either way happy to work around your schedule. You can rebook here https://conversifi.io/calendar'], { days: 7 }],
  ['What We Were Going to Cover', ['Just in case it helps, on the call we were going to go through how to target your ideal prospects on LinkedIn at scale, how AI conversations can qualify and book leads for you, and a quick walkthrough of how it all works in practice.', 'If any of that sounds useful you can grab a time here https://conversifi.io/calendar'], { days: 7 }],
  ['Thought This Might Resonate', ['Most of the businesses we work with came to us because they were spending too much time on outreach that was not converting. The ones that jumped on a call now have a system generating qualified leads and booking appointments while they focus on closing.', 'If that sounds worth exploring you can book in here https://conversifi.io/calendar'], { days: 14 }],
  ['Is LinkedIn Outreach Still on Your Radar?', ['Wanted to check if generating leads through LinkedIn is still something you are looking to sort out.', 'If so I would love to show you how we are helping businesses automate the whole process. You can rebook a time here https://conversifi.io/calendar'], { days: 7 }],
  ['The Real Cost of Manual Outreach', ['Not trying to be dramatic but every week without a proper outreach system is another week of missed pipeline. Most of our clients start seeing conversations and booked calls within the first couple of weeks.', 'If you want to see how it works you can grab a time here https://conversifi.io/calendar'], { days: 7 }],
  ['A Different Approach', ['I get it. Sometimes a call is not the right format.', 'If you would prefer, just reply to this email with any questions and I will answer them directly. No need to get on a call if that does not suit you.', 'Or if you would rather just rebook you can do that here https://conversifi.io/calendar'], { days: 30 }],
  ['What Makes This Different', ['You have probably seen a lot of LinkedIn outreach tools out there. What makes what we do different is the AI actually holds full conversations with your prospects rather than just sending connection requests, and appointments get booked directly into your calendar.', 'If you are curious I can walk you through it. You can grab a time here https://conversifi.io/calendar'], { days: 30 }],
  ['Would a Quick 10 Min Call Work Better?', ['I know a full demo can feel like a commitment. If it is easier I am happy to do a quick 10 minute overview so you can decide if it is worth exploring further. No pitch, just a quick look at how it works.', 'You can book a time here https://conversifi.io/calendar'], { days: 30 }],
  ['One Thing I Forgot to Mention', ['One thing I did not mention before. We actually help set everything up for you so you do not have to figure it out on your own. That includes building your target audience, writing your outreach messaging, and configuring the AI to match your tone and goals.', 'If that changes things you can grab a time here https://conversifi.io/calendar'], { days: 30 }],
  ['Onboarding Capacity', ['Quick heads up, we only take on a limited number of new clients each month to make sure everyone gets properly set up and supported.', 'If you have been thinking about it, now might be a good time to jump on a call. You can book in here https://conversifi.io/calendar'], { days: 30 }],
  ['Before I Close Your File', ['I am doing a bit of housekeeping on my end and wanted to check in before I close out your enquiry.', 'If you are still interested in automating your LinkedIn outreach just reply or rebook at a time that works here https://conversifi.io/calendar'], { days: 30 }],
  ['Final Follow Up', ['This will be my last follow up for now. I do not want to keep filling your inbox if the timing is not right.', 'If anything changes down the line just reply to any of my emails and I will be here. Or if now works after all you can grab a time here https://conversifi.io/calendar'], { days: 30 }],
  ['The Door Is Always Open', ['This is my last message for now. I genuinely believe we could help your business generate more leads and appointments on autopilot but I respect your time.', 'If you ever want to pick things back up just reply to this email or you can book in whenever you are ready at https://conversifi.io/calendar'], null],
];
const noShowWorkflow = () => {
  const chainFor = (sender) => {
    const items = NO_SHOW_EMAILS.map(([subject, paragraphs, delay], index) => ({
      check: index === 0 ? 'Person linked and still a prospect?' : 'Still a prospect?',
      steps: (person) => [email(`No-show email ${index + 1} (${sender.name})`, sender, person.email, subject, [`Hey ${person.firstName},`, ...paragraphs], { closing: index === 15 ? 'All the best' : 'Best' })],
      wait: delay ? { label: `${delay.days} day${delay.days > 1 ? 's' : ''}`, duration: delay } : null,
    }));
    return guardedChain('{{trigger.properties.after.personId}}', items, stillProspect);
  };
  const perCloser = closerMailboxes.filter((handle) => handle !== FALLBACK.email).map((handle) => ({ conditions: [condition('{{trigger.properties.after.closerEmail}}', 'TEXT', 'IS', handle)], steps: chainFor(senders[handle]) }));
  const body = perCloser.length ? [branches('Which closer?', perCloser, chainFor(FALLBACK))] : chainFor(FALLBACK);
  return {
    name: 'Sequence: no-show follow-up (16 emails)',
    description: 'Ported from GHL "No Show Sequence" + n8n templates. Starts when a Demo / Discovery / Agency demo booking is marked NO_SHOW by the closer dashboard verdict; 16 emails over ~9 months from the closer\'s mailbox. Stops as soon as the person trials, pays, rebooks, shows, becomes a DFY client, opts out or is marked not interested.',
    trigger: trigger.updated('booking', ['status']),
    steps: [branch('No-show on a sales call?', [
      condition('{{trigger.properties.after.status}}', 'SELECT', 'IS', 'NO_SHOW'),
      condition('{{trigger.properties.after.personId}}', 'UUID', 'IS_NOT_EMPTY'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'WEBINAR'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'SETUP_CALL'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'ONBOARDING'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'DIAGNOSTICS'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'FEEDBACK'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'NEXT_STEPS'),
      condition('{{trigger.properties.after.bookingType}}', 'SELECT', 'IS_NOT', 'OTHER'),
    ], body)],
    testPayload: (personId) => ({ id: randomUUID(), status: 'NO_SHOW', personId, bookingType: 'DEMO', closerEmail: 'sales@conversifi.io' }),
  };
};

// ---------- 3. signup / trial / churn (Melanie's mailbox when connected) ----------
const melanie = () => senderFor('melanie@conversifi.io');
const personTriggered = ({ key, name, description, field, firstCheck, items, guard, wantValue = true }) =>
  ['created', 'updated'].map((event) => ({
    name: `${name} (on ${event})`,
    description,
    trigger: event === 'created' ? trigger.created('person') : trigger.updated('person', [field]),
    steps: [branch(firstCheck.name, firstCheck.conditions, guardedChain(T.id, items, guard))],
    testPayload: (personId) => ({ id: personId, [field]: wantValue ? new Date().toISOString() : null }),
    key: `${key}-${event}`,
  }));

const SIGNUP = personTriggered({
  key: 'signup',
  name: 'Sequence: signed up, no trial yet',
  description: 'Ported from GHL "New Sign up & Trial Started" (signup branch). 10 minutes after a signup with no trial: Welcome, +1 day nudge, +2 days final nudge. Stops when the trial starts or the person pays.',
  field: 'signedUpAt',
  firstCheck: { name: 'Fresh signup without a trial?', conditions: [condition(T.field('signedUpAt'), 'DATE_TIME', 'IS_NOT_EMPTY'), condition(T.field('trialStartedAt'), 'DATE_TIME', 'IS_EMPTY'), condition(T.field('payingSince'), 'DATE_TIME', 'IS_EMPTY')] },
  guard: (person) => [condition(person.field('trialStartedAt'), 'DATE_TIME', 'IS_EMPTY'), condition(person.field('payingSince'), 'DATE_TIME', 'IS_EMPTY'), ...mayEmail(person)],
  items: [
    { check: 'Still no trial after 10 minutes?', steps: () => [], wait: { label: '10 minutes', duration: { minutes: 10 } } },
    { steps: (person) => [email('Welcome to Conversifi', melanie(), person.email, 'Welcome to Conversifi', [
      `Hey ${person.firstName},`,
      'Welcome to Conversifi! We\'re excited to help you generate more LinkedIn leads on autopilot using your own personalised AI outreach agent.',
      'I noticed you\'ve created your account but haven\'t started your free trial yet. Getting started is simple - just log into your account and add your LinkedIn profile. As soon as you do that, your 10-day free trial will begin automatically.',
      'We\'re also offering a free first-campaign setup where our team will help you get everything configured properly so you\'re not starting from scratch.',
      'The goal is to show you how powerful Conversifi can be as a real sales asset for your business, not just another tool.',
      'Looking forward to getting you started.',
    ])], wait: { label: '1 day', duration: { days: 1 } } },
    { steps: (person) => [email('Trial still available', melanie(), person.email, 'Your Free Conversifi Trial is Still Available', [
      `Hey ${person.firstName},`,
      'You still have access to a free Conversifi trial and a free setup call with our team.',
      'The trial lets you see how AI can be used to generate qualified LinkedIn leads and appointments without manual outreach.',
      'If you do decide to try it, you can start directly from your account by adding your LinkedIn profile - there\'s nothing else you need to do.',
      'Either way, no rush at all. The option\'s there whenever it makes sense for you.',
    ])], wait: { label: '2 days', duration: { days: 2 } } },
    { steps: (person) => [email('Need help getting started', melanie(), person.email, 'Need Help Getting Started with Conversifi?', [
      `Hey ${person.firstName},`,
      'Noticed you still haven\'t started your free trial with Conversifi.',
      'Once you start the trial and connect your LinkedIn profile inside your account, the AI assistant can start handling outreach and appointment booking automatically.',
      'If you\'d prefer help getting your first campaign live, just reply "SETUP" and we\'ll walk you through it.',
    ])] },
  ],
});

const SETUP_LINK = 'https://calendly.com/d/cyh4-vkq-gv4/conversifi-campaign-setup-call';
const TRIAL = personTriggered({
  key: 'trial',
  name: 'Sequence: trial started, book the setup call',
  description: 'Ported from GHL "New Sign up & Trial Started" (trial branch). 10 minutes after a trial starts with no setup call booked: trial live, +24h setup reminder, +4 days final nudge. Stops when a call is booked or the person pays.',
  field: 'trialStartedAt',
  firstCheck: { name: 'Fresh trial?', conditions: [condition(T.field('trialStartedAt'), 'DATE_TIME', 'IS_NOT_EMPTY'), condition(T.field('payingSince'), 'DATE_TIME', 'IS_EMPTY')] },
  guard: (person) => [condition(person.field('nextBookingAt'), 'DATE_TIME', 'IS_EMPTY'), condition(person.field('lastBookingType'), 'SELECT', 'IS_NOT', 'SETUP_CALL'), condition(person.field('payingSince'), 'DATE_TIME', 'IS_EMPTY'), ...mayEmail(person)],
  items: [
    { check: 'No setup call booked after 10 minutes?', steps: () => [], wait: { label: '10 minutes', duration: { minutes: 10 } } },
    { steps: (person) => [email('Trial is live', melanie(), person.email, 'Your Conversifi Free Trial is Live', [
      `Congratulations ${person.firstName},`,
      'Welcome to Conversifi - your free trial is now live.',
      'You\'re officially inside, and we\'re excited to help you start generating LinkedIn leads on autopilot with your own personalised AI outreach agent.',
      'To help you get the best possible results, we\'re offering a free setup call during your trial where we\'ll set up your first campaign, configure your AI agent properly, and make sure everything is aligned to your goals.',
      `You can book your free setup call with us at ${SETUP_LINK} whenever suits you.`,
      'Users who take the setup call typically get results much faster and avoid common mistakes early on.',
      'Looking forward to helping you get fully up and running.',
    ])], wait: { label: '24 hours', duration: { hours: 24 } } },
    { steps: (person) => [email('Setup call reminder', melanie(), person.email, 'Your Free Setup Call is Still Available', [
      `Hey ${person.firstName},`,
      'Looks like you started your trial but haven\'t taken advantage of the free setup call yet.',
      'On the call we\'ll set up your first campaign, configure your AI agent properly, make sure everything is aligned to your goals, and answer any questions.',
      `You can book your free setup call with us at ${SETUP_LINK} whenever works for you.`,
      'Users who take the setup call typically get results much faster and avoid common mistakes early on.',
      'Looking forward to helping you get fully up and running.',
    ])], wait: { label: '4 days', duration: { days: 4 } } },
    { steps: (person) => [email('Final setup nudge', melanie(), person.email, 'Need Help with Your Conversifi Campaigns?', [
      `Hey ${person.firstName},`,
      'Hopefully you\'re making the most of your free trial with Conversifi and have managed to launch an optimised campaign with an AI assistant that fits your goals.',
      'If you\'re having any trouble launching or optimising your campaigns, the free setup call is still there for you. It\'s a quick call where we\'ll help optimise your campaigns and get you off to a flying start.',
      `You can book your setup call with us at ${SETUP_LINK} whenever works for you.`,
    ])] },
  ],
});

const DIAG = '<a href="https://calendly.com/d/cxj2-55t-vvn/conversifi-io-diagnostics-call">Diagnostics Call</a>';
const CHURN_EMAILS = [
  [(p) => `Before you go, ${p.firstName}`, (s) => ['It\'s ' + s.name + ' from Conversifi. Noticed you recently cancelled and wanted to reach out personally.', 'No hard feelings at all. But I would love to know what happened. Was it the results, the setup, or just not the right time?', 'What we find most often is that people leave not because LinkedIn does not work, but because the strategy behind it needed some refinement. And that is a fixable problem.', 'We offer free setup calls where our team will look at your campaigns, your messaging, and your targeting and give you honest feedback. No pitch, just a straight diagnosis.', `If you are open to it, book a ${DIAG} here.`, 'Or just reply and let me know what was not working. Happy to help either way.'], { days: 2 }],
  [() => 'How James went from 2 bookings to 15 a month', () => ['James runs a SaaS company. His first few weeks on Conversifi were slow. Barely any booked calls. He nearly quit.', 'Instead he jumped on a call with our team. We spotted a few things: slightly off targeting, messaging too focused on features, and only one account limiting his volume.', 'He made the changes. Added a second account. Let it run.', 'Within 30 days he went from 1 to 2 bookings a month to 15. LinkedIn is now his primary acquisition channel.', 'The tool was the same. The strategy was different.', 'If you are open to it, we would love to take a look at what you had running and give you an honest assessment. No obligation.', `Book a ${DIAG} here.`], { days: 4 }],
  [() => 'The real reason most people don\'t see results on LinkedIn', () => ['A few things we hear from people who cancel, and what is usually behind them:', '<strong>"Not enough replies."</strong> Almost always messaging or targeting. A few tweaks can completely change the response rate.', '<strong>"It felt too automated."</strong> The tone, flow, and objection handling are all adjustable. If it felt robotic, the training needed refining.', '<strong>"Not enough time to manage it."</strong> A properly set up campaign runs mostly in the background. If it felt heavy, the setup was not optimised.', '<strong>"I wasn\'t sure it was working."</strong> The first 2 to 4 weeks are the warmup. Most people who push past that see a very different picture.', 'If any of these sound familiar, it is worth a conversation. We can usually identify exactly where things went sideways.', `Book a ${DIAG} here.`], { days: 7 }],
  [() => 'The LinkedIn outreach mistake most people make', () => ['Most people set up their LinkedIn outreach the same way.', 'They write one message, send it to everyone, and wonder why the reply rate is low.', 'The problem is not LinkedIn. It is that the same message does not land the same way with different people. A founder reads differently to a marketing manager. A warm referral responds differently to a cold connection.', 'The businesses that consistently book calls from LinkedIn are the ones that match the message to the person and let the volume do the work over time.', 'That is exactly what Conversifi is built to do. The AI adapts the conversation based on who it is talking to, handles objections, and keeps things moving without you having to be in every thread.', 'If you did not get to see that working properly before you left, it is worth a second look.', `Book a ${DIAG} here.`], { days: 7 }],
  [() => 'What does one new client a month mean for your business?', () => ['Quick question worth thinking about.', 'What is one new client worth to your business? For most of our users, a single client from LinkedIn covers the cost of the platform for the entire year.', 'LinkedIn is still one of the strongest B2B acquisition channels out there. The issue is rarely the channel. It is doing it consistently, at volume, without it eating your time.', 'That is what Conversifi is built for.', 'If results were not there yet, the door is open whenever you are ready to give it another shot. We will make sure the setup is right this time.', `Book a ${DIAG} here.`], { days: 14 }],
  [(p) => `Checking in, ${p.firstName}`, () => ['Just checking in, no agenda.', 'How is client acquisition going? Have you found something that is working, or is it still something you are figuring out?', 'Either way, we are always here if you want to pick things back up. A lot of people who come back a second time see results they were not getting the first time around, usually because we get the setup right from day one.', `Whenever you are ready: ${DIAG}`], null],
];
const CHURN = personTriggered({
  key: 'churn',
  name: 'Sequence: churned, win-back',
  description: 'Ported from GHL "Churned user > Revival attempt" + n8n Churned Tag Manager. 5 minutes after a cancellation: 6 emails over 5 weeks. Continues only while the person is still churned (a reactivation clears churnedAt).',
  field: 'churnedAt',
  firstCheck: { name: 'Just churned?', conditions: [condition(T.field('churnedAt'), 'DATE_TIME', 'IS_NOT_EMPTY')] },
  guard: (person) => [condition(person.field('churnedAt'), 'DATE_TIME', 'IS_NOT_EMPTY'), ...mayEmail(person)],
  items: [
    { check: 'Still churned after 5 minutes?', steps: () => [], wait: { label: '5 minutes', duration: { minutes: 5 } } },
    ...CHURN_EMAILS.map(([subject, paragraphs, delay], index) => ({
      check: 'Still churned?',
      steps: (person) => [email(`Churn email ${index + 1}`, melanie(), person.email, subject(person), [`Hey ${person.firstName},`, ...paragraphs(melanie())], { noSignature: false })],
      wait: delay ? { label: `${delay.days} days`, duration: delay } : null,
    })),
  ],
});

// ---------- 4. webinar (Conversifi Live Demo bookings) ----------
const team = { ...FALLBACK, name: 'The Conversifi team', title: 'Conversifi' };
const WEBINAR_LINK = 'conversifi.io/webinar?s=live';
const webinarReminders = () => {
  const times = code('Session times', 'TIMES', BOOKING_TIME_CODE, { ...BOOKING_INPUT, types: 'WEBINAR' }, BOOKING_TIME_SAMPLE);
  const C = (name) => `{{TIMES.${name}}}`;
  const to = '{{trigger.properties.after.inviteeEmail}}';
  const refresh24 = findBooking('{{trigger.properties.after.calendlyUri}}');
  // Fresh steps per branch: a step object can only appear once in a workflow.
  const oneHour = () => {
    const refresh1 = findBooking('{{trigger.properties.after.calendlyUri}}');
    return [
      waitUntil('Wait until 1 hour before', C('remind1hAt')),
      refresh1,
      branch('Still registered?', [condition(`{{${refresh1.id}.first.status}}`, 'SELECT', 'IS', 'UPCOMING')], [
        email('Email 3: starting in 1 hour', team, to, 'Starting in 1 hour, here\'s your link', [`Hi ${C('firstName')},`, 'We go live in one hour. Showcasing how our AI assistants book meetings through LinkedIn on complete auto-pilot.', `Join here: ${WEBINAR_LINK}`, 'See you soon'], { noSignature: true }),
      ]),
    ];
  };
  return {
    name: 'Sequence: webinar registration + reminders',
    description: 'Ported from GHL "Registration & pre-webinar reminders". On a Conversifi Live Demo booking: spot secured now, reminder the day before, link 1 hour before.',
    trigger: trigger.created('booking'),
    steps: [times, branch('Webinar registration?', [condition(C('eligible'), 'TEXT', 'IS_NOT_EMPTY')], [
      email('Email 1: spot secured', team, to, `${C('firstName')}, your spot in the live demo is secured!`, [
        `Hi ${C('firstName')},`,
        `You're registered for the Conversifi live demo at ${C('startDate')}, ${C('startTime')}, ${C('timezone')}.`,
        'Three quick things:',
        'It\'s live, so show up on time. We walk through the exact system, not a recording.',
        'Bring something to take notes with. You\'ll leave with a plan you can run the same day.',
        'There\'s an exclusive live-only offer at the end that we don\'t run anywhere else.',
        `Here's your join link: ${WEBINAR_LINK}`,
        'See you there,<br>The Conversifi team',
      ], { noSignature: true }),
      branch('More than 24 hours away?', [condition(C('send24h'), 'TEXT', 'IS_NOT_EMPTY')], [
        waitUntil('Wait until the day before', C('remind24hAt')),
        refresh24,
        branch('Still registered?', [condition(`{{${refresh24.id}.first.status}}`, 'SELECT', 'IS', 'UPCOMING')], [
          email('Email 2: tomorrow', team, to, 'Tomorrow: put your LinkedIn outreach on autopilot', [`Hi ${C('firstName')},`, `Quick reminder your Conversifi live demo is tomorrow at ${C('startTime')}, ${C('timezone')}.`, 'On the session you\'ll see how the AI finds leads, sends connection requests, handles entire conversations in your tone of voice, and books them into your calendar on auto pilot.', `Here's your link to the live event: ${WEBINAR_LINK}`], { noSignature: true }),
          ...oneHour(),
        ]),
      ], oneHour()),
    ])],
    testPayload: () => ({ id: randomUUID(), calendlyUri: 'https://api.calendly.com/scheduled_events/test-webinar', startsAt: new Date(Date.now() + 26 * 3600000).toISOString(), status: 'UPCOMING', bookingType: 'WEBINAR', inviteeEmail: TEST_EMAIL, inviteeFirstName: 'Jamal', inviteeTimezone: 'Europe/London' }),
  };
};
const webinarNoShow = () => {
  const times = code('Session times', 'TIMES', BOOKING_TIME_CODE, { ...BOOKING_INPUT, types: 'WEBINAR' }, BOOKING_TIME_SAMPLE);
  const C = (name) => `{{TIMES.${name}}}`;
  const notEntered = (person) => [condition(person.field('webinarStage'), 'SELECT', 'IS', 'REGISTERED'), ...mayEmail(person)];
  const items = [
    { check: 'Did not enter the session?', steps: (person) => [email('Recovery 1: you missed it', team, person.email, 'You missed it, the next session starts soon', [`Hi ${person.firstName},`, 'Looks like you couldn\'t make the demo. No problem, we run it again soon and there\'s a session starting shortly.', 'We demonstrated exactly how businesses are booking appointments on LinkedIn using AI assistants and automation.', 'Grab a new time here: conversifi.io/demo/webinar', 'It\'s worth being there live for the walkthrough and the exclusive offer at the end!'], { noSignature: true })], wait: { label: '1 day', duration: { days: 1 } } },
    { check: 'Still not entered?', steps: (person) => [email('Recovery 2: still want to see it', team, person.email, 'Still want to see how AI LinkedIn agents can book you appts?', [`Hi ${person.firstName},`, 'You registered for the Conversifi demo but didn\'t get to watch.', 'It\'s the fastest way to see how the AI books calls for you on LinkedIn without any manual work.', 'If you\'re still interested, pick a time that actually works for you here: conversifi.io/demo/webinar'], { noSignature: true })], wait: { label: '3 days', duration: { days: 3 } } },
    { check: 'Still not entered?', steps: (person) => [email('Recovery 3: start free instead', team, person.email, 'Don\'t want to sit through a session? Start free instead', [`Hi ${person.firstName},`, 'If a live session isn\'t your thing, you can just try Conversifi for free.', 'There\'s a 10-day free trial, no call required.', 'Start here: https://conversifi.io', 'You can have your first campaign running in about 15 minutes.'], { noSignature: true })] },
  ];
  return {
    name: 'Sequence: webinar no-show recovery',
    description: 'Ported from GHL "No-show recovery". 45 minutes after a Conversifi Live Demo starts, if the registrant never entered the session (webinar stage still Registered): 3 emails over 4 days.',
    trigger: trigger.created('booking'),
    steps: [times, branch('Webinar registration with a person?', [condition(C('eligible'), 'TEXT', 'IS_NOT_EMPTY'), condition('{{trigger.properties.after.personId}}', 'UUID', 'IS_NOT_EMPTY')], [
      waitUntil('Wait until 45 minutes after the start', C('after45mAt')),
      ...guardedChain('{{trigger.properties.after.personId}}', items, notEntered),
    ])],
    testPayload: (personId) => ({ id: randomUUID(), calendlyUri: 'https://api.calendly.com/scheduled_events/test-webinar', startsAt: new Date(Date.now() - 44 * 60000).toISOString(), status: 'UPCOMING', bookingType: 'WEBINAR', personId, inviteeEmail: TEST_EMAIL, inviteeFirstName: 'Jamal', inviteeTimezone: 'Europe/London' }),
  };
};
const webinarOffer = () => {
  const times = code('Session times', 'TIMES', BOOKING_TIME_CODE, { ...BOOKING_INPUT, types: 'WEBINAR' }, BOOKING_TIME_SAMPLE);
  const C = (name) => `{{TIMES.${name}}}`;
  const notPaid = (person) => [condition(person.field('webinarStage'), 'SELECT', 'IS_NOT', 'PAID'), condition(person.field('payingSince'), 'DATE_TIME', 'IS_EMPTY'), ...mayEmail(person)];
  const link = (person) => person.field('webinarOfferLink');
  const items = [
    { check: 'Has not bought yet?', steps: (person) => [email('Offer 1: reserved', team, person.email, 'Your exclusive offer is reserved, 1 year for just $599', [`Hi ${person.firstName},`, 'Thanks for being on the demo. As promised, here\'s the live-only deal:', 'A full year of Conversifi plus a 1-to-1 launch call, for just $599.', 'Worth $1,688.', 'This is only for people who were on the session, and it expires in 24 hours.', `Claim your year for $599: ${link(person)}`], { noSignature: true })], wait: { label: '6 hours', duration: { hours: 6 } } },
    { check: 'Still not bought?', steps: (person) => [email('Offer 2: FAQ', team, person.email, 'A few hours left, quick answers to what people ask', [`Hi ${person.firstName},`, 'Your $599 offer is still open, but not for long.', 'A few things people ask before they grab it:', 'Does it work for my niche? Yes. It scores every lead so you only reach good-fit ones.', 'Is my account safe? Zero bans across 1,000+ accounts. Use a real account 6+ months old.', 'Do I need Sales Navigator? No, it\'s optional. There are other ways to source leads.', 'Do I have to write the replies? No. It handles replies and objections, or you approve each one.', `Claim your year for $599: ${link(person)}`], { noSignature: true }), waitUntil('Wait until 21h30 after the start', C('after21h30At'))] },
    { check: 'Still not bought?', steps: (person) => [email('Offer 3: expires in 2 hours', team, person.email, 'Your $599 offer expires in 2 hours', [`Hi ${person.firstName},`, 'This is your last reminder. The live-only offer, a full year plus your launch call for $599, closes in about two hours.', 'After that it\'s back to normal pricing.', `Grab it now · ${link(person)}`], { noSignature: true })], wait: { label: '2 hours', duration: { hours: 2 } } },
    { check: 'No trial and not bought?', steps: (person) => [email('Offer 4: expired, start free', team, person.email, 'Your offer expired, but you can still start free', [`Hi ${person.firstName},`, 'The $599 live offer has closed. If you still want to see what Conversifi can do for you, the 10-day free trial is open.', 'Start here: https://conversifi.io'], { noSignature: true })] },
  ];
  items[3].also = (person) => [condition(person.field('trialStartedAt'), 'DATE_TIME', 'IS_EMPTY')];
  const guard = (person) => notPaid(person);
  return {
    name: 'Sequence: webinar offer ($599)',
    description: 'Ported from GHL "Attended, didn\'t buy, the offer sequence". 15 minutes after a Conversifi Live Demo starts: the $599 offer, FAQ 6 hours later, "expires in 2 hours" at 21h30 after the start, then "expired, start free". Stops when the person pays.',
    trigger: trigger.created('booking'),
    steps: [times, branch('Webinar registration with a person?', [condition(C('eligible'), 'TEXT', 'IS_NOT_EMPTY'), condition('{{trigger.properties.after.personId}}', 'UUID', 'IS_NOT_EMPTY')], [
      waitUntil('Wait until 15 minutes after the start', C('after15mAt')),
      ...guardedChain('{{trigger.properties.after.personId}}', items, guard),
    ])],
    testPayload: (personId) => ({ id: randomUUID(), calendlyUri: 'https://api.calendly.com/scheduled_events/test-webinar', startsAt: new Date(Date.now() - 14 * 60000).toISOString(), status: 'UPCOMING', bookingType: 'WEBINAR', personId, inviteeEmail: TEST_EMAIL, inviteeFirstName: 'Jamal', inviteeTimezone: 'Europe/London' }),
  };
};

// ---------- 5. one-click actions on a person ----------
const jamal = () => senderFor('jamal@conversifi.io');
const fiftyOff = () => {
  const find = findPerson('{{trigger.payload.id}}');
  const person = P(find.id);
  return {
    name: 'Action: send 50% off win-back offer',
    description: 'Ported from GHL tag "50%offer" → n8n. Run from a person record: sends Jamal\'s 50% off first month back email.',
    trigger: trigger.manual('person', 'Send 50% off offer', 'IconDiscount'),
    steps: [find, email('50% off offer', jamal(), person.email, `${person.firstName}, what happened?`, [
      `Hey ${person.firstName},`,
      'It\'s Jamal from Conversifi. I noticed you recently cancelled and wanted to reach out personally.',
      'As a gesture of goodwill, I would love to offer you <strong>50% off your first month back</strong> if you decide to give it another shot.',
      'Before you make a final decision, I would love to understand what went wrong. Was it a missing feature, something that did not work as expected, or did you just need more support to get going? Every bit of feedback shapes what we build next.',
      'If you need help getting set up, I am happy to jump on a call and walk through everything hands-on. Our goal is to help you see more success than any other tool can achieve.',
      'Just hit reply and let me know your thoughts.',
    ])],
    testPayload: (personId) => ({ id: personId }),
  };
};
const DFY_PACKAGES = [
  { agents: 1, label: '1 Agent Package', setup: '$999', retainer: '$250/month', sign: 'https://sign.zoho.com/zsfl/VMlSSh92Z9bZ9FUMBYi7?i=6414', pay: 'https://buy.stripe.com/eVq3cv9Fvc2mfLXeTGffy02' },
  { agents: 2, label: '2 Agent Package', setup: '$1,750', retainer: '$500/month ($250/account)', sign: 'https://sign.zoho.com/zsfl/DGOXPpirvOaNPYol8t5u?i=9246', pay: 'https://buy.stripe.com/00w8wPdVL7M643f3aYffy03' },
  { agents: 3, label: '3 Agent Package (Best Value)', setup: '$1,997', retainer: '$750/month ($250/account)', sign: 'https://sign.zoho.com/zsfl/9E9uItDzwBI4YVXvbwWy?i=6918', pay: 'https://buy.stripe.com/eVq4gz5pf9Ue43ffXKffy04' },
];
const dfyClose = (pack) => {
  const find = findPerson('{{trigger.payload.id}}');
  const person = P(find.id);
  return {
    name: `Action: DFY closed, send onboarding (${pack.agents} agent${pack.agents > 1 ? 's' : ''})`,
    description: 'Ported from GHL "Deal closed DFY - send payment link and agreement" + n8n Package templates. Run from a person record: marks them a DFY client and sends the agreement, payment and onboarding links.',
    trigger: trigger.manual('person', `DFY closed: ${pack.agents} agent${pack.agents > 1 ? 's' : ''}`, 'IconContract'),
    steps: [find, updatePerson('Mark as DFY client', person.id, { stage: 'DFY_CLIENT' }), email('Onboarding email', jamal(), person.email, 'Client Onboarding with Conversifi', [
      `Hey ${person.firstName},`,
      'Congratulations on getting started with Conversifi! We\'re excited to get you set up and start filling your pipeline with qualified appointments.',
      'As discussed, here\'s a quick summary of your package:',
      `<strong>Package:</strong> ${pack.label}<br><strong>Setup Fee:</strong> ${pack.setup} (one-time)<br><strong>Monthly Retainer:</strong> ${pack.retainer} – starts 30 days after onboarding<br><strong>Commission:</strong> 5% on any deals closed from booked appointments`,
      'To get started, there are three quick steps:',
      `<strong>Step 1 – Sign the Service Agreement</strong><br>Please review and sign your service agreement here:<br><a href="${pack.sign}">Sign Agreement</a>`,
      `<strong>Step 2 – Make Your Setup Payment</strong><br>Once signed, complete your setup payment here:<br><a href="${pack.pay}">Make Payment</a>`,
      '<strong>Step 3 – Complete Onboarding & Book Your Onboarding Call</strong><br>After payment, head to the link below to complete your onboarding form and book your onboarding call with the team:<br><a href="https://client.conversifi.io/onboarding">Complete Onboarding</a>',
      'Once your onboarding call is complete, we\'ll get to work building your campaigns and you\'ll typically be live within 3–7 days.',
      'If you have any questions in the meantime, just reply to this email and we\'ll get back to you.',
    ], { closing: 'Speak soon' })],
    testPayload: (personId) => ({ id: personId }),
  };
};

const WORKFLOWS = [
  ...APPT_VARIANTS.map(apptWorkflow),
  noShowWorkflow(),
  ...SIGNUP, ...TRIAL, ...CHURN,
  webinarReminders(), webinarNoShow(), webinarOffer(),
  fiftyOff(), ...DFY_PACKAGES.map(dfyClose),
];

// ---------- create ----------
const existing = (await gql('/graphql', `{ workflows(first: 200) { edges { node { id name statuses versions { edges { node { id status } } } } } } }`)).workflows.edges.map((edge) => edge.node);
const destroyWorkflow = async (workflow) => {
  for (const { node } of workflow.versions.edges) if (node.status === 'ACTIVE') await mcp('deactivate_workflow_version', { workflowVersionId: node.id });
  await gql('/graphql', `mutation ($id: UUID!) { deleteWorkflow(id: $id) { id } }`, { id: workflow.id });
  await gql('/graphql', `mutation ($id: UUID!) { destroyWorkflow(id: $id) { id } }`, { id: workflow.id });
};

const created = [];
for (const spec of WORKFLOWS) {
  if (ONLY && !spec.name.toLowerCase().includes(ONLY)) continue;
  const previous = existing.find((workflow) => workflow.name === spec.name);
  if (previous && !REBUILD) { console.log(`exists: ${spec.name} [${previous.statuses.join(',')}]`); created.push({ spec, workflowId: previous.id, versionId: previous.versions.edges.map((edge) => edge.node).find((version) => version.status === 'ACTIVE' || version.status === 'DRAFT')?.id }); continue; }
  if (previous) { await destroyWorkflow(previous); console.log(`rebuilding: ${spec.name}`); }

  const { steps, firstId } = layout(spec.steps);
  const codeSteps = steps.filter((candidate) => candidate._code);
  // Code steps are added after creation; bypass them in the initial graph, remembering their parent and child.
  const insertions = codeSteps.map((codeStep) => {
    const parent = steps.find((candidate) => candidate.nextStepIds.includes(codeStep.id));
    const next = codeStep.nextStepIds[0] ?? null;
    if (parent) parent.nextStepIds = parent.nextStepIds.map((id) => (id === codeStep.id ? next : id)).filter(Boolean);
    return { codeStep, parentId: parent?.id ?? 'trigger', nextId: next };
  });
  const plainSteps = steps.filter((candidate) => !candidate._code).map(({ _code, ...rest }) => rest);
  const entryId = codeSteps.some((candidate) => candidate.id === firstId) ? insertions.find((entry) => entry.codeStep.id === firstId).nextId : firstId;

  const result = await mcp('create_complete_workflow', {
    name: spec.name, description: spec.description, trigger: spec.trigger, steps: plainSteps, edges: entryId ? [{ source: 'trigger', target: entryId }] : [], activate: false,
  });
  const versionId = result?.result?.workflowVersionId;
  const workflowId = result?.result?.workflowId;
  if (!versionId) { console.log('create failed', spec.name, JSON.stringify(result).slice(0, 1200)); continue; }

  const configuredCodeIds = new Set();
  for (const { codeStep, parentId, nextId } of insertions) {
    await mcp('create_workflow_version_step', { workflowVersionId: versionId, stepType: 'CODE', parentStepId: parentId, ...(nextId ? { nextStepId: nextId } : {}) });
    const version = (await gql('/graphql', `query ($id: UUID!) { workflowVersion(filter: { id: { eq: $id } }) { id steps } }`, { id: versionId })).workflowVersion;
    const inserted = (version.steps ?? []).find((candidate) => candidate.type === 'CODE' && !configuredCodeIds.has(candidate.id));
    if (inserted) configuredCodeIds.add(inserted.id);
    const logicFunctionId = inserted?.settings?.input?.logicFunctionId;
    if (!logicFunctionId) { console.log('code step missing for', spec.name); break; }
    await mcp('update_logic_function_source', { logicFunctionId, code: codeStep._code.source });
    await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: { ...inserted, name: codeStep.name, settings: { ...inserted.settings, input: { logicFunctionId, logicFunctionInput: codeStep._code.input }, outputSchema: schemaOf(codeStep._code.outputSample), errorHandlingOptions: errorHandling } } });
    // Everything that referenced the placeholder key now points at the real step id.
    const token = `{{${codeStep._code.key}.`;
    for (const candidate of version.steps.filter((other) => other.id !== inserted.id && JSON.stringify(other).includes(token))) {
      const repointed = JSON.parse(JSON.stringify(candidate).split(token).join(`{{${inserted.id}.`));
      await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: repointed });
    }
  }
  const validation = await mcp('validate_workflow', { workflowVersionId: versionId });
  const verdict = validation?.result ?? validation;
  console.log(`built: ${spec.name} (${plainSteps.length + codeSteps.length} steps) valid=${verdict?.valid} ${verdict?.valid ? '' : JSON.stringify(verdict).slice(0, 600)}`);
  created.push({ spec, workflowId, versionId });
}

// ---------- test / activate ----------
if (TEST) {
  const target = created.find((entry) => entry.spec.name.toLowerCase().includes(TEST.toLowerCase()));
  if (!target) throw new Error(`no workflow matches ${TEST}`);
  const people = await gql('/graphql', `query ($email: String!) { people(filter: { emails: { primaryEmail: { eq: $email } } }, first: 1) { edges { node { id } } } }`, { email: TEST_EMAIL });
  let personId = people.people.edges[0]?.node.id;
  if (!personId) {
    // A soft-deleted copy blocks re-creation, so restore it instead.
    const deleted = await gql('/graphql', `query ($email: String!) { people(filter: { emails: { primaryEmail: { eq: $email } }, deletedAt: { is: NOT_NULL } }, first: 1) { edges { node { id } } } }`, { email: TEST_EMAIL });
    const deletedId = deleted.people.edges[0]?.node.id;
    if (deletedId) { await gql('/graphql', `mutation ($id: UUID!) { restorePerson(id: $id) { id } }`, { id: deletedId }); personId = deletedId; console.log('restored test person', personId); }
  }
  if (!personId) {
    // A throwaway test person so the sequence emails land in a real inbox.
    const created = await gql('/graphql', `mutation ($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: { name: { firstName: 'Jamal', lastName: 'Test' }, emails: { primaryEmail: TEST_EMAIL, additionalEmails: [] }, leadSource: 'OTHER', stage: 'LEAD' } });
    personId = created.createPerson.id;
    console.log('created test person', personId);
  }
  const raw = target.spec.testPayload(personId);
  // Database-event triggers receive the event envelope; manual runs the record under payload.
  const payload = target.spec.trigger.type === 'DATABASE_EVENT' ? { properties: { after: raw } } : raw;
  const run = await gql('/graphql', `mutation ($input: RunWorkflowVersionInput!) { runWorkflowVersion(input: $input) { workflowRunId } }`, { input: { workflowVersionId: target.versionId, payload } }, userToken());
  console.log(`test run of "${target.spec.name}": ${run.runWorkflowVersion.workflowRunId}`);
  await new Promise((resolve) => setTimeout(resolve, 12000));
  const outcome = await mcp('get_workflow_run', { workflowRunId: run.runWorkflowVersion.workflowRunId });
  const workflowRun = outcome?.result?.workflowRun ?? outcome;
  console.log(`  ${workflowRun.status}: ${(workflowRun.steps ?? []).filter((s) => s.status !== 'NOT_STARTED').map((s) => `${s.name}=${s.status}${s.error ? ' (' + s.error + ')' : ''}`).join(' | ')}`);
}
if (ACTIVATE) {
  for (const entry of created) {
    const versions = (await gql('/graphql', `query ($id: UUID!) { workflow(filter: { id: { eq: $id } }) { versions { edges { node { id status } } } } }`, { id: entry.workflowId })).workflow.versions.edges.map((edge) => edge.node);
    const draft = versions.find((version) => version.status === 'DRAFT');
    if (draft) console.log(`activate ${entry.spec.name}:`, JSON.stringify(await mcp('activate_workflow_version', { workflowVersionId: draft.id })).slice(0, 120));
  }
}
