// Files and renames the workflows on the Workflows page: folder records + each workflow's folder path
// and its display name. Idempotent; run after 21/22 if names drift.
import { readFileSync } from 'fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const gql = async (query, variables = {}) => { const r = await fetch(`http://127.0.0.1:${env.NODE_PORT ?? 3000}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${env.OS_TWENTY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }); const p = await r.json(); if (p.errors) throw new Error(JSON.stringify(p.errors).slice(0, 500)); return p.data; };

const RULES = [
  [/^Intake: booking form \(calendar \+ demo\)$/, 'Form: calendar + demo', 'Intake'],
  [/^Intake: Stripe signup, trial and paid$/, 'Stripe: signup, trial, paid', 'Intake'],
  [/^Intake: webinar stage$/, 'Webinar: stage events', 'Intake'],
  [/^Intake: churned or reactivated$/, 'Churn: cancelled or reactivated', 'Intake'],
  [/^App: (.*)$/, (m) => `Old HTTP intake: ${m[1]}`, 'Archive'],
  [/^Sequence: appointment confirmed \+ reminders \((.*)\)$/, (m) => `Appointment confirmed + reminders · ${m[1]}`, 'Sequences / Sales calls'],
  [/^Sequence: no-show follow-up \(16 emails\)$/, 'No-show follow-up (16 emails)', 'Sequences / Sales calls'],
  [/^Sequence: signed up, no trial yet \(on (\w+)\)$/, (m) => `Signed up, no trial yet · on ${m[1]}`, 'Sequences / Product'],
  [/^Sequence: trial started, book the setup call \(on (\w+)\)$/, (m) => `Trial started, book the setup call · on ${m[1]}`, 'Sequences / Product'],
  [/^Sequence: churned, win-back \(on (\w+)\)$/, (m) => `Churned, win-back (6 emails) · on ${m[1]}`, 'Sequences / Product'],
  [/^Sequence: webinar registration \+ reminders$/, 'Registration + reminders', 'Sequences / Webinar'],
  [/^Sequence: webinar no-show recovery$/, 'No-show recovery', 'Sequences / Webinar'],
  [/^Sequence: webinar offer \(\$599\)$/, 'Offer: 1 year for $599', 'Sequences / Webinar'],
  [/^Action: send 50% off win-back offer$/, 'Send 50% off win-back offer', 'Actions'],
  [/^Action: DFY closed, send onboarding \((.*)\)$/, (m) => `DFY closed: send onboarding (${m[1]})`, 'Actions'],
  // Already-renamed workflows keep their folder.
  [/^(Form|Stripe|Webinar|Churn):/, null, 'Intake'],
  [/^Old HTTP intake:/, null, 'Archive'],
  [/^(Appointment confirmed|No-show follow-up)/, null, 'Sequences / Sales calls'],
  [/^(Signed up, no trial|Trial started, book|Churned, win-back)/, null, 'Sequences / Product'],
  [/^(Registration \+ reminders|No-show recovery|Offer: 1 year)/, null, 'Sequences / Webinar'],
  [/^(Send 50% off|DFY closed:)/, null, 'Actions'],
];
const FOLDERS = ['Intake', 'Sequences', 'Sequences / Sales calls', 'Sequences / Product', 'Sequences / Webinar', 'Actions', 'Archive'];

const existingFolders = (await gql(`{ workflowFolders(first: 200) { edges { node { id name } } } }`)).workflowFolders.edges.map((e) => e.node.name);
for (const name of FOLDERS) {
  if (existingFolders.includes(name)) continue;
  await gql(`mutation ($data: WorkflowFolderCreateInput!) { createWorkflowFolder(data: $data) { id } }`, { data: { name } });
  console.log('folder created:', name);
}
const workflows = (await gql(`{ workflows(first: 200) { edges { node { id name folder } } } }`)).workflows.edges.map((e) => e.node);
for (const workflow of workflows) {
  const rule = RULES.find(([pattern]) => pattern.test(workflow.name));
  if (!rule) { console.log('no rule:', workflow.name); continue; }
  const [pattern, rename, folder] = rule;
  const name = typeof rename === 'function' ? rename(workflow.name.match(pattern)) : rename ?? workflow.name;
  if (name === workflow.name && workflow.folder === folder) continue;
  await gql(`mutation ($id: UUID!, $data: WorkflowUpdateInput!) { updateWorkflow(id: $id, data: $data) { id } }`, { id: workflow.id, data: { name, folder } });
  console.log(`${folder}  ←  ${name}${name !== workflow.name ? `  (was: ${workflow.name})` : ''}`);
}
