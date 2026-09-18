// Creates (once) the four Twenty workflows that receive the Conversifi app's events, replacing the
// GoHighLevel inbound webhooks: each is a webhook trigger feeding the os intake endpoint, so every
// event is visible as a workflow run and later steps can be added visually.
// Run on the VPS: node os-migration/20_intake_workflows.mjs   (reads the server .env next to it)
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const API_KEY = env.OS_TWENTY_API_KEY;
const TOKEN = env.OS_INTAKE_TOKEN;
const PORT = env.NODE_PORT ?? '3000';
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC_BASE = (env.SERVER_URL ?? 'https://crm.conversifi.io').replace(/\/$/, '');
// Single-workspace install; the webhook URL needs the workspace id and the records API has no query for it.
const WORKSPACE_ID = env.OS_WORKSPACE_ID ?? 'a984b071-b213-4117-9f6e-106129143ee8';
if (!API_KEY || !TOKEN) throw new Error('OS_TWENTY_API_KEY and OS_INTAKE_TOKEN must be set');

const mcp = async (name, args) => {
  const response = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await response.text();
  const data = raw.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('');
  const parsed = JSON.parse(data || raw);
  if (parsed.error) throw new Error(JSON.stringify(parsed.error));
  const content = parsed.result?.content?.[0]?.text ?? '';
  try { return JSON.parse(content); } catch { return content; }
};
const gql = async (query, variables = {}) => {
  const response = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data;
};

const leaf = (label, value) => ({ icon: 'IconVariable', type: typeof value === 'number' ? 'number' : 'string', label, value, isLeaf: true });
const outputSchemaFor = (sample) => Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, leaf(key, value)]));

const WORKFLOWS = [
  {
    name: 'App: booking form (calendar + demo)',
    description: 'Replaces GHL "Calendar Partial Submissions Stage 1/2", "Calendar Submissions" and "Agency Funnel Full/Partial Submissions". The /calendar and /demo forms post here as the visitor types (opt_in, full_contact) and on completion (route_label).',
    event: 'form',
    sample: { capture_stage: 'opt_in', first_name: 'Sam', last_name: 'Carter', email: 'sam@example.com', phone: '+447700900000', website: 'https://example.com', business_type: 'Agency', agency_services: 'Outreach', team_size: '2-4', revenue: '0-2k', route_label: 'demo' },
  },
  {
    name: 'App: Stripe signup, trial and paid',
    description: 'Replaces GHL "New Sign up & Trial Started" and "New paying user". The stripe-webhook function posts signup, trial_started and subscription_started.',
    event: 'stripe',
    sample: { event_type: 'trial_started', email: 'sam@example.com', name: 'Sam Carter', timestamp: '2026-09-17T00:00:00.000Z', source: 'conversifi', account_limit: 3, trial_end_date: '2026-09-27', billing_interval: 'month', plan_type: 'growth' },
  },
  {
    name: 'App: webinar stage',
    description: 'Replaces the GHL webinar tag flows. The webinar-track function posts each funnel stage (registered, entered, reached offer, offer click, trial click, paid) with the GHL tag name.',
    event: 'webinar',
    sample: { source: 'webinar', event: 'registered', tag: 'web registered', email: 'sam@example.com', first_name: 'Sam', last_name: 'Carter', session_id: 'abc', offer_link: 'https://conversifi.io/e/lv2xk9' },
  },
  {
    name: 'App: churned or reactivated',
    description: 'Replaces the n8n "Churned Tag Manager". cancel-subscription posts add_churned; stripe-webhook posts remove_churned on reactivation.',
    event: 'churn',
    sample: { email: 'sam@example.com', action: 'add_churned' },
  },
];

const existing = await gql(`{ workflows(first: 200) { edges { node { id name } } } }`);
const byName = new Map(existing.workflows.edges.map((edge) => [edge.node.name, edge.node.id]));
const workspaceId = WORKSPACE_ID;

for (const spec of WORKFLOWS) {
  if (byName.has(spec.name)) {
    console.log(`exists: ${spec.name} → ${byName.get(spec.name)}`);
    continue;
  }
  const stepId = randomUUID();
  const result = await mcp('execute_tool', {
    toolName: 'create_complete_workflow',
    arguments: {
      name: spec.name,
      description: spec.description,
      trigger: {
        name: 'App event',
        type: 'WEBHOOK',
        settings: {
          httpMethod: 'POST',
          authentication: null,
          expectedBody: spec.sample,
          expectedOutputSchema: spec.sample,
          outputSchema: outputSchemaFor(spec.sample),
        },
      },
      steps: [
        {
          id: stepId,
          name: 'Apply to CRM',
          type: 'HTTP_REQUEST',
          valid: true,
          settings: {
            input: {
              // Twenty's HTTP step refuses loopback and private addresses, so go via the public host.
              url: `${PUBLIC_BASE}/os/intake/${TOKEN}/${spec.event}`,
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // The whole trigger payload, forwarded as JSON.
              body: '{{trigger}}',
            },
            outputSchema: { ok: leaf('ok', true), outcome: leaf('outcome', 'updated') },
            expectedOutputSchema: { ok: true, outcome: 'updated' },
            errorHandlingOptions: { retryOnFailure: { value: 2 }, continueOnFailure: { value: false } },
          },
        },
      ],
      edges: [{ source: 'trigger', target: stepId }],
      activate: true,
    },
  });
  console.log(`created: ${spec.name}`);
  console.log(typeof result === 'string' ? result.slice(0, 600) : JSON.stringify(result).slice(0, 600));
}

const after = await gql(`{ workflows(first: 200) { edges { node { id name statuses } } } }`);
for (const spec of WORKFLOWS) {
  const workflow = after.workflows.edges.map((edge) => edge.node).find((node) => node.name === spec.name);
  if (workflow) console.log(`${spec.event}: https://crm.conversifi.io/webhooks/workflows/${workspaceId}/${workflow.id}  [${workflow.statuses?.join(',')}]`);
}
