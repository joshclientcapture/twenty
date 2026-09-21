// Builds the app intake workflows with native Twenty steps (Search person by email → Code merge →
// If/Else found → Update person / Create person) as DRAFTS, through Twenty's workflow tool API.
// Run on the VPS: node os-migration/21_native_intake_workflows.mjs [--test]
import { readFileSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const API_KEY = env.OS_TWENTY_API_KEY;
const BASE = `http://127.0.0.1:${env.NODE_PORT ?? '3000'}`;
const WORKSPACE_ID = env.OS_WORKSPACE_ID ?? 'a984b071-b213-4117-9f6e-106129143ee8';
const TEST = process.argv.includes('--test') || process.argv.includes('--test-only');
const TEST_ONLY = process.argv.includes('--test-only');
// --refresh: new draft version of each live intake workflow with the current merge code and record
// mapping, then activated; the workflow ids (and so the webhook URLs the app posts to) do not change.
const REFRESH = process.argv.includes('--refresh');
// --only form,churn limits the run to those event kinds.
const ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
if (!API_KEY) throw new Error('OS_TWENTY_API_KEY must be set');

// Running a draft version is a user-only mutation, so tests use a short-lived legacy-format access
// token for the workspace owner (OS_TEST_USER_ID / OS_TEST_USER_WORKSPACE_ID / OS_TEST_MEMBER_ID).
const userToken = () => {
  const { OS_TEST_USER_ID, OS_TEST_USER_WORKSPACE_ID, OS_TEST_MEMBER_ID, APP_SECRET } = env;
  if (!OS_TEST_USER_ID || !OS_TEST_USER_WORKSPACE_ID || !OS_TEST_MEMBER_ID) throw new Error('OS_TEST_* ids must be set for --test');
  const key = createHash('sha256').update(`${APP_SECRET}${WORKSPACE_ID}ACCESS`).digest('hex');
  return jwt.sign({ sub: OS_TEST_USER_ID, userId: OS_TEST_USER_ID, workspaceId: WORKSPACE_ID, workspaceMemberId: OS_TEST_MEMBER_ID, userWorkspaceId: OS_TEST_USER_WORKSPACE_ID, type: 'ACCESS', authProvider: 'password', isImpersonating: false }, key, { algorithm: 'HS256', expiresIn: '10m' });
};
const post = async (path, body, token = API_KEY) => {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
  return response.text();
};
const mcp = async (name, args) => {
  const raw = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_tool', arguments: { toolName: name, arguments: args } } });
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
const options = (list) => list.map((option, position) => ({ ...option, id: randomUUID(), position }));

// ---------- 1. Person fields the flows write to ----------
const SOURCE_OPTIONS = [
  { value: 'DEMO', label: 'Demo booking', color: 'blue' }, { value: 'AGENCY', label: 'Agency demo', color: 'turquoise' }, { value: 'DFY', label: 'DFY discovery', color: 'purple' },
  { value: 'AGENCY_FUNNEL', label: 'Agency funnel', color: 'turquoise' }, { value: 'WEBINAR', label: 'Webinar', color: 'pink' }, { value: 'SIGNUP', label: 'Self-serve signup', color: 'sky' },
  { value: 'LINKEDIN', label: 'LinkedIn outreach', color: 'sky' }, { value: 'GROWTH', label: 'Growth', color: 'green' }, { value: 'ADS', label: 'Ads', color: 'orange' }, { value: 'ORGANIC', label: 'Organic', color: 'green' }, { value: 'OTHER', label: 'Other', color: 'gray' },
];
const WEBINAR_STAGE_OPTIONS = [
  { value: 'REGISTERED', label: 'Registered', color: 'gray' }, { value: 'ENTERED', label: 'Entered', color: 'sky' }, { value: 'REACHED_OFFER', label: 'Reached offer', color: 'blue' },
  { value: 'OFFER_CLICK', label: 'Clicked offer', color: 'purple' }, { value: 'TRIAL_CLICK', label: 'Clicked trial', color: 'orange' }, { value: 'PAID', label: 'Paid', color: 'green' },
];
const STAGE_OPTIONS = [
  { value: 'LEAD', label: 'Lead', color: 'gray' }, { value: 'BOOKED', label: 'Call booked', color: 'blue' }, { value: 'SHOWED', label: 'Showed', color: 'sky' }, { value: 'NO_SHOW', label: 'No show', color: 'red' },
  { value: 'SIGNED_UP', label: 'Signed up', color: 'yellow' }, { value: 'TRIAL', label: 'Trial', color: 'orange' }, { value: 'TRIAL_ENDED', label: 'Trial ended (never paid)', color: 'red' }, { value: 'PAYING', label: 'Paying', color: 'green' }, { value: 'CHURNED', label: 'Churned', color: 'purple' },
  { value: 'DFY_CLIENT', label: 'DFY client', color: 'turquoise' }, { value: 'NOT_INTERESTED', label: 'Not interested', color: 'gray' },
];
const PERSON_FIELDS = [
  { name: 'stage', label: 'Stage', type: 'SELECT', icon: 'IconProgress', options: options(STAGE_OPTIONS) },
  { name: 'latestSource', label: 'Latest source', type: 'SELECT', icon: 'IconTargetArrow', options: options(SOURCE_OPTIONS) },
  { name: 'latestFormAt', label: 'Latest form at', type: 'DATE_TIME', icon: 'IconForms' },
  { name: 'signedUpAt', label: 'Signed up at', type: 'DATE_TIME', icon: 'IconUserPlus' },
  { name: 'trialStartedAt', label: 'Trial started at', type: 'DATE_TIME', icon: 'IconRocket' },
  { name: 'payingSince', label: 'Paying since', type: 'DATE_TIME', icon: 'IconCoin' },
  { name: 'churnedAt', label: 'Churned at', type: 'DATE_TIME', icon: 'IconUserOff' },
  { name: 'trialEndedAt', label: 'Trial ended at (never paid)', type: 'DATE_TIME', icon: 'IconHourglassOff' },
  { name: 'webinarStage', label: 'Webinar stage', type: 'SELECT', icon: 'IconPresentation', options: options(WEBINAR_STAGE_OPTIONS) },
  { name: 'webinarOfferLink', label: 'Webinar offer link', type: 'TEXT', icon: 'IconLink' },
  { name: 'lastActivityAt', label: 'Last activity', type: 'DATE_TIME', icon: 'IconActivity' },
];
const objects = (await gql('/metadata', `{ objects(paging: { first: 1000 }) { edges { node { id nameSingular fieldsList { id name type } } } } }`)).objects.edges.map((edge) => edge.node);
const person = objects.find((object) => object.nameSingular === 'person');
const have = new Set(person.fieldsList.map((field) => field.name));
for (const field of PERSON_FIELDS) {
  if (have.has(field.name)) continue;
  const { options: fieldOptions, ...rest } = field;
  await gql('/metadata', `mutation ($input: CreateOneFieldMetadataInput!) { createOneField(input: $input) { id } }`, { input: { field: { objectMetadataId: person.id, ...rest, ...(fieldOptions ? { options: fieldOptions } : {}) } } });
  console.log(`person field created: ${field.name}`);
}
const emailsFieldId = person.fieldsList.find((field) => field.name === 'emails').id;

// ---------- 2. The merge code shared by every flow ----------
const MERGE_CODE = String.raw`
const DIAL_CODES = ['1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','94','98','212','213','216','218','230','234','254','255','256','260','263','264','265','266','267','268','269','290','291','297','298','299','350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376','377','378','380','381','382','385','386','387','389','420','421','423','500','501','502','503','504','505','506','507','508','509','590','591','592','593','594','595','596','597','598','599','670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','692','850','852','853','855','856','880','886','960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','992','993','994','995','996','998'];
const SHARED_CODES = ['1', '7', '39', '44', '47', '61', '212', '262', '290', '358', '500', '590', '599', '672'];
const COUNTRY = { '1': 'US', '44': 'GB', '61': 'AU', '353': 'IE', '91': 'IN', '49': 'DE', '33': 'FR', '34': 'ES', '39': 'IT', '31': 'NL', '55': 'BR', '52': 'MX', '27': 'ZA', '971': 'AE', '65': 'SG', '64': 'NZ', '351': 'PT', '48': 'PL', '46': 'SE', '47': 'NO', '45': 'DK', '32': 'BE', '41': 'CH', '43': 'AT', '90': 'TR', '234': 'NG', '254': 'KE', '92': 'PK', '63': 'PH', '60': 'MY', '62': 'ID', '66': 'TH', '84': 'VN', '20': 'EG', '966': 'SA', '972': 'IL', '380': 'UA', '7': 'RU', '81': 'JP', '82': 'KR', '86': 'CN' };
const text = (value) => (typeof value === 'string' && value.trim() !== '' && !value.includes('{{') && !/^not (asked|applicable)$/i.test(value.trim()) ? value.trim() : '');
const phoneParts = (raw) => {
  const cleaned = text(raw).replace(/[^\d+]/g, '');
  if (!cleaned) return null;
  if (!cleaned.startsWith('+')) return { number: cleaned, code: '', country: '' };
  const digits = cleaned.slice(1);
  const code = [3, 2, 1].map((length) => digits.slice(0, length)).find((candidate) => DIAL_CODES.includes(candidate)) ?? '';
  // Codes shared by several countries (+1, +44, +61, ...) are left for Twenty to infer from the number;
  // naming one wrongly makes the update fail with conflicting country codes.
  return { number: digits.slice(code.length), code: code ? '+' + code : '', country: SHARED_CODES.includes(code) ? '' : (COUNTRY[code] ?? '') };
};
const ROUTE = { demo: 'DEMO', demo_call: 'DEMO', 'agency demo': 'AGENCY', agency: 'AGENCY', dfy: 'DFY', webinar: 'WEBINAR' };
const ROUTE_TAG = { DEMO: 'DEMO', AGENCY: 'AGENCY_DEMO', AGENCY_FUNNEL: 'AGENCYFUNNEL_LEAD', DFY: 'DFY', WEBINAR: 'WEB_REGISTERED' };
const WEB_TAG = { 'web registered': 'WEB_REGISTERED', 'web entered': 'WEB_ENTERED', 'web reached offer': 'WEB_REACHED_OFFER', 'web offer click': 'WEB_OFFER_CLICK', 'web trial click': 'WEB_TRIAL_CLICK', 'web paid': 'WEB_PAID' };
const WEB_STAGE = { 'web registered': 'REGISTERED', 'web entered': 'ENTERED', 'web reached offer': 'REACHED_OFFER', 'web offer click': 'OFFER_CLICK', 'web trial click': 'TRIAL_CLICK', 'web paid': 'PAID' };
const STAGE_ORDER = ['REGISTERED', 'ENTERED', 'REACHED_OFFER', 'OFFER_CLICK', 'TRIAL_CLICK', 'PAID'];

// The one person that test and preview payloads update instead of creating records (doNotEmail, notInterested).
const TEST_SINK_ID = 'b5db690f-501e-4e0f-a888-40fdf6c1b770';

export const main = async (params) => {
  const payload = params.payload && typeof params.payload === 'object' ? params.payload : {};
  const kind = params.kind;
  const now = new Date().toISOString();
  const email = text(payload.email).toLowerCase();
  const candidates = Array.isArray(params.candidates) ? params.candidates : [];
  const matches = (person, own) => (own ? (person.emails?.primaryEmail ?? '').toLowerCase() === email : (person.emails?.additionalEmails ?? []).some((extra) => String(extra).toLowerCase() === email));
  const existing = email ? candidates.find((person) => matches(person, true)) ?? candidates.find((person) => matches(person, false)) ?? null : null;

  let firstName = text(payload.first_name);
  let lastName = text(payload.last_name);
  if (kind === 'stripe' && !firstName && text(payload.name)) {
    const parts = text(payload.name).split(/\s+/);
    firstName = parts[0];
    lastName = parts.slice(1).join(' ');
  }
  if (existing && (existing.name?.firstName || existing.name?.lastName)) {
    firstName = existing.name.firstName || firstName;
    lastName = existing.name.lastName || lastName;
  }
  if (!firstName && !lastName && email) {
    const local = email.split('@')[0];
    if (!['info', 'hello', 'contact', 'admin', 'support', 'sales', 'office', 'team', 'hi', 'mail'].includes(local)) {
      const parts = local.replace(/[0-9]+/g, ' ').split(/[._\-+ ]+/).filter((part) => part.length > 1);
      firstName = parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : '';
      lastName = parts.slice(1).map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
    }
  }

  const phone = phoneParts(payload.phone) ?? (existing?.phones?.primaryPhoneNumber ? { number: existing.phones.primaryPhoneNumber, code: existing.phones.primaryPhoneCallingCode ?? '', country: existing.phones.primaryPhoneCountryCode ?? '' } : { number: '', code: '', country: '' });

  const tags = new Set(Array.isArray(existing?.ghlTags) ? existing.ghlTags : []);
  let source = '';
  let latestFormAt = existing?.latestFormAt ?? null;
  let signedUpAt = existing?.signedUpAt ?? null;
  let trialStartedAt = existing?.trialStartedAt ?? null;
  let payingSince = existing?.payingSince ?? null;
  let churnedAt = existing?.churnedAt ?? null;
  let trialEndedAt = existing?.trialEndedAt ?? null;
  let webinarStage = existing?.webinarStage ?? null;

  if (kind === 'form') {
    const route = text(payload.route_label).toLowerCase();
    source = ROUTE[route] ?? ROUTE[route.replace(/\s+demo$/, '')] ?? ({ calendar: 'DFY', dfy: 'DFY', software: 'DEMO' }[text(payload.source).toLowerCase()] ?? '');
    // A capture without a route is a partial (opt_in / full_contact); the final submit clears the marker.
    if (route) tags.delete('PARTIAL_FORM');
    else if (!existing?.nextBookingAt && !existing?.lastBookingAt) tags.add('PARTIAL_FORM');
    latestFormAt = now;
  } else if (kind === 'stripe') {
    const type = text(payload.event_type);
    source = 'SIGNUP';
    if (type === 'signup') signedUpAt = signedUpAt ?? now;
    if (type === 'trial_started') { trialStartedAt = trialStartedAt ?? now; signedUpAt = signedUpAt ?? now; }
    if (type === 'subscription_started') { payingSince = payingSince ?? now; churnedAt = null; }
  } else if (kind === 'webinar') {
    const tag = text(payload.tag).toLowerCase();
    source = 'WEBINAR';
    const stage = WEB_STAGE[tag];
    if (stage && (!webinarStage || STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(webinarStage))) webinarStage = stage;
    if (stage === 'PAID') { payingSince = payingSince ?? now; churnedAt = null; }
  } else if (kind === 'churn') {
    const action = text(payload.action);
    // has_paid_anything=false means a trial that never paid: not customer churn, its own state.
    const neverPaid = payload.has_paid_anything === false || payload.has_paid_anything === 'false';
    if (action === 'add_churned' && neverPaid) trialEndedAt = now;
    if (action === 'add_churned' && !neverPaid) churnedAt = now;
    if (action === 'remove_churned') { churnedAt = null; trialEndedAt = null; payingSince = payingSince ?? now; }
  }

  const pick = (fresh, old) => fresh || old || '';
  // Previews and smoke tests from the app must not become leads: they all land on one sink record.
  const testLike = /(@example\.(invalid|com|org)$|@crmwiring\.dev$|@test\.com$|^preview@|^test@|^(demo(-[a-z0-9]+)?|lookup[0-9]*|[a-z-]*test[a-z0-9-]*)@conversifi\.io$)/i.test(email)
    || /(^|\s)(test|tester|testing|preview)(\s|$)/i.test(`${firstName} ${lastName}`.trim());
  if (testLike) {
    return {
      stage: 'NOT_INTERESTED', webinarOfferLink: '', existingId: TEST_SINK_ID, email: 'intake-test@conversifi.io', firstName: 'Intake', lastName: 'Test sink',
      phoneNumber: '', phoneCallingCode: '', phoneCountryCode: '', businessType: '', agencyServices: '', monthlyRevenue: '',
      leadSource: 'DEMO', latestSource: source || 'DEMO', latestFormAt: now, signedUpAt: null, trialStartedAt: null, payingSince: null, churnedAt: null, trialEndedAt: null, webinarStage: null,
      lastActivityAt: now, tags: [], now,
    };
  }
  // Same rules as the server's lifecycle pass, without the booking data it adds every 15 minutes.
  const stage = payingSince && (!churnedAt || payingSince > churnedAt) ? 'PAYING' : churnedAt ? 'CHURNED' : trialEndedAt ? 'TRIAL_ENDED' : trialStartedAt ? 'TRIAL' : signedUpAt ? 'SIGNED_UP' : existing?.stage || 'LEAD';
  return {
    stage: existing?.stage === 'DFY_CLIENT' || existing?.stage === 'NOT_INTERESTED' ? existing.stage : stage,
    webinarOfferLink: pick(text(payload.offer_link), existing?.webinarOfferLink),
    existingId: existing?.id ?? '',
    email,
    firstName, lastName,
    phoneNumber: phone.number, phoneCallingCode: phone.code, phoneCountryCode: phone.country,
    businessType: pick(text(payload.business_type), existing?.businessType),
    agencyServices: pick(text(payload.agency_services), existing?.agencyServices),
    monthlyRevenue: pick(text(payload.revenue), existing?.monthlyRevenue),
    leadSource: existing?.leadSource || source || null,
    latestSource: source || existing?.latestSource || null,
    latestFormAt, signedUpAt, trialStartedAt, payingSince, churnedAt, trialEndedAt, webinarStage,
    // Every app event counts as activity, even when the dated field it belongs to keeps an earlier value.
    lastActivityAt: now,
    tags: [...tags],
    now,
  };
};
`;

const CODE_OUTPUT_SAMPLE = {
  existingId: '', email: 'sam@example.com', firstName: 'Sam', lastName: 'Carter', phoneNumber: '7700900000', phoneCallingCode: '+44', phoneCountryCode: 'GB',
  businessType: 'Agency', agencyServices: 'Outreach', monthlyRevenue: '0-2k', leadSource: 'DEMO', latestSource: 'DEMO', latestFormAt: '2026-09-18T10:00:00.000Z',
  signedUpAt: '2026-09-18T10:00:00.000Z', trialStartedAt: '2026-09-18T10:00:00.000Z', payingSince: '2026-09-18T10:00:00.000Z', churnedAt: '2026-09-18T10:00:00.000Z', trialEndedAt: '2026-09-18T10:00:00.000Z',
  webinarStage: 'REGISTERED', tags: ['DEMO'], now: '2026-09-18T10:00:00.000Z', stage: 'LEAD', webinarOfferLink: 'https://conversifi.io/e/lv2xk9', lastActivityAt: '2026-09-18T10:00:00.000Z',
};

// ---------- 3. One workflow per app event ----------
const SPECS = [
  { kind: 'form', name: 'Form: calendar + demo', description: 'The /calendar and /demo forms post here at each step (opt_in, full_contact, final with route_label). Replaces the GHL Calendar Submissions and Agency Funnel workflows.',
    sample: { capture_stage: 'opt_in', source: 'demo', first_name: 'Sam', last_name: 'Carter', email: 'sam@example.com', phone: '+44 7700900000', website: 'https://example.com', business_type: 'Agency', agency_services: 'Outreach', team_size: '2-4', revenue: '0-2k', route_label: 'demo_call' } },
  { kind: 'stripe', name: 'Stripe: signup, trial, paid', description: 'stripe-webhook posts signup, trial_started and subscription_started. Replaces GHL New Sign up & Trial Started.',
    sample: { event_type: 'trial_started', email: 'sam@example.com', name: 'Sam Carter', timestamp: '2026-09-18T10:00:00.000Z', source: 'conversifi', account_limit: 3, trial_end_date: '2026-09-28', billing_interval: 'month', plan_type: 'growth' } },
  { kind: 'webinar', name: 'Webinar: stage events', description: 'webinar-track posts each funnel stage with the tag name (web registered, entered, reached offer, offer click, trial click, paid).',
    sample: { source: 'webinar', event: 'registered', tag: 'web registered', email: 'sam@example.com', first_name: 'Sam', last_name: 'Carter', session_id: 'abc', offer_link: 'https://conversifi.io/e/lv2xk9' } },
  { kind: 'churn', name: 'Churn: cancelled or reactivated', description: 'cancel-subscription posts add_churned; stripe-webhook posts remove_churned on reactivation. Replaces the n8n Churned Tag Manager.',
    sample: { email: 'sam@example.com', action: 'add_churned' } },
];

const personRecord = (codeId, { create }) => ({
  ...(create ? { emails: { primaryEmail: `{{${codeId}.email}}`, additionalEmails: [] }, leadSince: `{{${codeId}.now}}` } : {}),
  name: { firstName: `{{${codeId}.firstName}}`, lastName: `{{${codeId}.lastName}}` },
  phones: { primaryPhoneNumber: `{{${codeId}.phoneNumber}}`, primaryPhoneCallingCode: `{{${codeId}.phoneCallingCode}}`, primaryPhoneCountryCode: `{{${codeId}.phoneCountryCode}}`, additionalPhones: [] },
  businessType: `{{${codeId}.businessType}}`,
  agencyServices: `{{${codeId}.agencyServices}}`,
  monthlyRevenue: `{{${codeId}.monthlyRevenue}}`,
  leadSource: `{{${codeId}.leadSource}}`,
  latestSource: `{{${codeId}.latestSource}}`,
  latestFormAt: `{{${codeId}.latestFormAt}}`,
  signedUpAt: `{{${codeId}.signedUpAt}}`,
  trialStartedAt: `{{${codeId}.trialStartedAt}}`,
  payingSince: `{{${codeId}.payingSince}}`,
  churnedAt: `{{${codeId}.churnedAt}}`,
  trialEndedAt: `{{${codeId}.trialEndedAt}}`,
  webinarStage: `{{${codeId}.webinarStage}}`,
  webinarOfferLink: `{{${codeId}.webinarOfferLink}}`,
  stage: `{{${codeId}.stage}}`,
  lastActivityAt: `{{${codeId}.lastActivityAt}}`,
  ghlTags: `{{${codeId}.tags}}`,
});
const errorHandling = { retryOnFailure: { value: 1 }, continueOnFailure: { value: false } };

const existingWorkflows = (await gql('/graphql', `{ workflows(first: 200) { edges { node { id name versions { edges { node { id status steps } } } } } } }`)).workflows.edges.map((edge) => edge.node);
const testRun = async (spec, versionId) => {
  const run = await gql('/graphql', `mutation ($input: RunWorkflowVersionInput!) { runWorkflowVersion(input: $input) { workflowRunId } }`, { input: { workflowVersionId: versionId, payload: { ...spec.sample, email: `native.test.${spec.kind}@crmwiring.dev` } } }, userToken());
  await new Promise((resolve) => setTimeout(resolve, 8000));
  const outcome = await mcp('get_workflow_run', { workflowRunId: run.runWorkflowVersion.workflowRunId });
  const workflowRun = outcome?.result?.workflowRun ?? outcome?.workflowRun ?? outcome;
  console.log(`  test run ${workflowRun.status}: ${(workflowRun.steps ?? []).map((step) => `${step.name}=${step.status}${step.error ? ' (' + step.error + ')' : ''}`).join(' | ')}`);
};
const isComplete = (workflow) => workflow.versions.edges.some((edge) => (edge.node.steps ?? []).some((step) => step.type === 'CODE'));
const destroyWorkflow = async (id) => {
  await gql('/graphql', `mutation ($id: UUID!) { deleteWorkflow(id: $id) { id } }`, { id });
  await gql('/graphql', `mutation ($id: UUID!) { destroyWorkflow(id: $id) { id } }`, { id });
};

for (const spec of SPECS) {
  if (ONLY && !ONLY.includes(spec.kind)) continue;
  const previous = existingWorkflows.find((workflow) => workflow.name === spec.name);
  if (previous && isComplete(previous) && REFRESH) {
    const live = previous.versions.edges.map((edge) => edge.node).find((version) => version.status === 'ACTIVE') ?? previous.versions.edges.map((edge) => edge.node).find((version) => version.status === 'DRAFT');
    const draft = (await gql('/graphql', `mutation ($input: CreateDraftFromWorkflowVersionInput!) { createDraftFromWorkflowVersion(input: $input) { id } }`, { input: { workflowId: previous.id, workflowVersionIdToCopy: live.id } }, userToken())).createDraftFromWorkflowVersion;
    const version = (await gql('/graphql', `query ($id: UUID!) { workflowVersion(filter: { id: { eq: $id } }) { id steps } }`, { id: draft.id })).workflowVersion;
    const codeStep = version.steps.find((step) => step.type === 'CODE');
    const findStep = version.steps.find((step) => step.type === 'FIND_RECORDS');
    await mcp('update_logic_function_source', { logicFunctionId: codeStep.settings.input.logicFunctionId, code: MERGE_CODE });
    await mcp('update_workflow_version_step', { workflowVersionId: draft.id, validate: false, step: { ...codeStep, settings: { ...codeStep.settings, input: { logicFunctionId: codeStep.settings.input.logicFunctionId, logicFunctionInput: { kind: spec.kind, payload: '{{trigger}}', candidates: `{{${findStep.id}.all}}` } }, outputSchema: schemaOf(CODE_OUTPUT_SAMPLE) } } });
    for (const step of version.steps.filter((candidate) => candidate.type === 'UPDATE_RECORD' || candidate.type === 'CREATE_RECORD')) {
      const create = step.type === 'CREATE_RECORD';
      const objectRecord = personRecord(codeStep.id, { create });
      await mcp('update_workflow_version_step', { workflowVersionId: draft.id, validate: false, step: { ...step, settings: { ...step.settings, input: { ...step.settings.input, objectRecord, ...(create ? {} : { fieldsToUpdate: Object.keys(objectRecord) }) } } } });
    }
    const validation = await mcp('validate_workflow', { workflowVersionId: draft.id });
    console.log(`refreshed: ${spec.name} draft ${draft.id} valid=${(validation?.result ?? validation)?.valid}`);
    if ((validation?.result ?? validation)?.valid) console.log('  activated:', JSON.stringify(await mcp('activate_workflow_version', { workflowVersionId: draft.id })).slice(0, 100));
    if (TEST) await testRun(spec, draft.id);
    continue;
  }
  if (previous && isComplete(previous)) {
    console.log(`exists: ${spec.name}`);
    if (TEST_ONLY) await testRun(spec, previous.versions.edges.map((edge) => edge.node).find((version) => version.status === 'DRAFT' || version.status === 'ACTIVE').id);
    continue;
  }
  if (TEST_ONLY) continue;
  // A half-built draft from an interrupted run is replaced rather than patched.
  if (previous) { await destroyWorkflow(previous.id); console.log(`replaced incomplete draft: ${spec.name}`); }
  const findId = randomUUID(), codeId = randomUUID(), ifId = randomUUID(), updateId = randomUUID(), createId = randomUUID();
  const groupId = randomUUID(), filterId = randomUUID(), foundBranch = randomUUID(), newBranch = randomUUID(), emailGroupId = randomUUID();

  const created = await mcp('create_complete_workflow', {
    name: spec.name,
    description: spec.description,
    trigger: { name: 'App event', type: 'WEBHOOK', settings: { httpMethod: 'POST', authentication: null, expectedBody: spec.sample, expectedOutputSchema: spec.sample, outputSchema: schemaOf(spec.sample) } },
    steps: [
      { id: findId, name: 'Search person by email', type: 'FIND_RECORDS', valid: true, nextStepIds: [ifId], settings: {
        input: { objectName: 'person', limit: 10, filter: { recordFilterGroups: [{ id: emailGroupId, logicalOperator: 'OR' }], recordFilters: [
          { id: randomUUID(), fieldMetadataId: emailsFieldId, subFieldName: 'primaryEmail', type: 'EMAILS', operand: 'CONTAINS', value: '{{trigger.email}}', displayValue: '{{trigger.email}}', label: 'Emails', recordFilterGroupId: emailGroupId, positionInRecordFilterGroup: 0 },
          { id: randomUUID(), fieldMetadataId: emailsFieldId, subFieldName: 'additionalEmails', type: 'EMAILS', operand: 'CONTAINS', value: '{{trigger.email}}', displayValue: '{{trigger.email}}', label: 'Emails', recordFilterGroupId: emailGroupId, positionInRecordFilterGroup: 1 },
        ] } },
        outputSchema: {}, errorHandlingOptions: errorHandling } },
      { id: ifId, name: 'Person already exists?', type: 'IF_ELSE', valid: true, settings: {
        input: {
          stepFilterGroups: [{ id: groupId, logicalOperator: 'AND' }],
          stepFilters: [{ id: filterId, type: 'TEXT', stepOutputKey: `{{${codeId}.existingId}}`, operand: 'IS_NOT_EMPTY', value: '', stepFilterGroupId: groupId, positionInStepFilterGroup: 0 }],
          branches: [{ id: foundBranch, filterGroupId: groupId, nextStepIds: [updateId] }, { id: newBranch, nextStepIds: [createId] }],
        },
        outputSchema: {}, errorHandlingOptions: errorHandling } },
      { id: updateId, name: 'Update person', type: 'UPDATE_RECORD', valid: true, settings: {
        input: { objectName: 'person', objectRecordId: `{{${codeId}.existingId}}`, objectRecord: personRecord(codeId, { create: false }), fieldsToUpdate: Object.keys(personRecord(codeId, { create: false })) },
        outputSchema: {}, errorHandlingOptions: errorHandling } },
      { id: createId, name: 'Create person', type: 'CREATE_RECORD', valid: true, settings: {
        input: { objectName: 'person', objectRecord: personRecord(codeId, { create: true }) },
        outputSchema: {}, errorHandlingOptions: errorHandling } },
    ],
    edges: [{ source: 'trigger', target: findId }],
    activate: false,
  });
  const versionId = created?.result?.workflowVersionId;
  if (!versionId) { console.log('create failed', JSON.stringify(created).slice(0, 800)); continue; }

  // The merge lives in a Code step inserted between the search and the branch. The tool picks the
  // step id itself, so the record steps are re-pointed at it once it exists.
  await mcp('create_workflow_version_step', { workflowVersionId: versionId, stepType: 'CODE', parentStepId: findId, nextStepId: ifId });
  const version = (await gql('/graphql', `query ($id: UUID!) { workflowVersion(filter: { id: { eq: $id } }) { id steps } }`, { id: versionId })).workflowVersion;
  const codeStep = (version.steps ?? []).find((step) => step.type === 'CODE');
  const logicFunctionId = codeStep?.settings?.input?.logicFunctionId;
  if (!logicFunctionId) { console.log('code step missing', JSON.stringify(version.steps).slice(0, 1200)); continue; }
  const actualCodeId = codeStep.id;
  await mcp('update_logic_function_source', { logicFunctionId, code: MERGE_CODE });
  await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: { ...codeStep, name: 'Merge with existing person', nextStepIds: [ifId], settings: { ...codeStep.settings, input: { logicFunctionId, logicFunctionInput: { kind: spec.kind, payload: '{{trigger}}', candidates: `{{${findId}.all}}` } }, outputSchema: schemaOf(CODE_OUTPUT_SAMPLE), errorHandlingOptions: errorHandling } } });
  for (const step of version.steps.filter((candidate) => [updateId, createId, ifId].includes(candidate.id))) {
    const repointed = JSON.parse(JSON.stringify(step).split(codeId).join(actualCodeId));
    await mcp('update_workflow_version_step', { workflowVersionId: versionId, validate: false, step: repointed });
  }
  await gql('/graphql', `mutation ($id: UUID!, $data: WorkflowUpdateInput!) { updateWorkflow(id: $id, data: $data) { id } }`, { id: created.result.workflowId, data: { folder: 'Intake' } });
  const validation = await mcp('validate_workflow', { workflowVersionId: versionId });
  console.log(`draft: ${spec.name} → workflow ${created.result.workflowId} version ${versionId}`);
  console.log('  validation:', JSON.stringify(validation?.result ?? validation).slice(0, 700));
  console.log(`  webhook: https://crm.conversifi.io/webhooks/workflows/${WORKSPACE_ID}/${created.result.workflowId}`);

  if (TEST) await testRun(spec, versionId);
}
