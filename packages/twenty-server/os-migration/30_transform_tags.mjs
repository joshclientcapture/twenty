// One-off: turns the imported GoHighLevel tags into the fields the CRM actually uses and leaves only
// live markers in Tags. Idempotent. Run on the VPS: node os-migration/30_transform_tags.mjs [--dry-run]
import { readFileSync } from 'fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const DRY = process.argv.includes('--dry-run');
const gql = async (query, variables = {}) => { const r = await fetch(`http://127.0.0.1:${env.NODE_PORT ?? 3000}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${env.OS_TWENTY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }); const p = await r.json(); if (p.errors) throw new Error(JSON.stringify(p.errors).slice(0, 500)); return p.data; };

// Markers that still mean something on their own; everything else becomes a field or is dropped.
const KEEP = new Set(['PARTIAL_FORM', 'HUMAN_INTERVENTION', 'INTERESTED', 'SIGNUP_REPLIED', 'TRIAL_REPLIED', 'FIFTY_PERCENT_OFFER']);
const WEB_STAGE = { WEB_REGISTERED: 'REGISTERED', WEB_ENTERED: 'ENTERED', WEB_REACHED_OFFER: 'REACHED_OFFER', WEB_OFFER_CLICK: 'OFFER_CLICK', WEB_TRIAL_CLICK: 'TRIAL_CLICK', WEB_PAID: 'PAID' };
const STAGE_ORDER = ['REGISTERED', 'ENTERED', 'REACHED_OFFER', 'OFFER_CLICK', 'TRIAL_CLICK', 'PAID'];

const people = [];
let after = null;
for (;;) {
  const page = await gql(`query ($after: String) { people(first: 200, after: $after, filter: { not: { ghlTags: { isEmptyArray: true } } }) { edges { cursor node { id createdAt leadSince ghlTags leadSource stage notInterested doNotEmail webinarStage signedUpAt trialStartedAt payingSince churnedAt } } pageInfo { hasNextPage endCursor } } }`, { after });
  people.push(...page.people.edges.map((e) => e.node));
  if (!page.people.pageInfo.hasNextPage) break;
  after = page.people.pageInfo.endCursor;
}
console.log(`${people.length} people carry tags`);

const patches = [];
const counts = {};
const bump = (key) => { counts[key] = (counts[key] ?? 0) + 1; };
for (const person of people) {
  const tags = new Set(person.ghlTags ?? []);
  const patch = {};
  const since = person.leadSince ?? person.createdAt;
  if ((tags.has('NOT_INTERESTED') || tags.has('BLACKLIST')) && !person.notInterested) { patch.notInterested = true; bump('notInterested'); }
  if ((tags.has('DND') || tags.has('ENABLE_DND') || tags.has('BAD_EGG') || tags.has('BLACKLIST')) && !person.doNotEmail) { patch.doNotEmail = true; bump('doNotEmail'); }
  if ((tags.has('DFY_CLIENT') || tags.has('DEAL_CLOSED')) && person.stage !== 'DFY_CLIENT') { patch.stage = 'DFY_CLIENT'; bump('stage DFY_CLIENT'); }
  const stages = [...tags].map((t) => WEB_STAGE[t]).filter(Boolean).sort((a, b) => STAGE_ORDER.indexOf(b) - STAGE_ORDER.indexOf(a));
  if (stages[0] && (!person.webinarStage || STAGE_ORDER.indexOf(stages[0]) > STAGE_ORDER.indexOf(person.webinarStage))) { patch.webinarStage = stages[0]; bump('webinarStage'); }
  if (!person.leadSource) {
    if (tags.has('AGENCYFUNNEL_LEAD') || tags.has('AGENCYFUNNEL_PARTIAL')) { patch.leadSource = 'AGENCY_FUNNEL'; bump('leadSource'); }
    else if (tags.has('LINKEDIN_OUTBOUND')) { patch.leadSource = 'LINKEDIN'; bump('leadSource'); }
  }
  // Dated fields: Stripe fills these where the address is known; the tag date is the fallback.
  if (tags.has('SIGNUP') && !person.signedUpAt) { patch.signedUpAt = since; bump('signedUpAt from tag'); }
  if (tags.has('TRIAL_STARTED') && !person.trialStartedAt) { patch.trialStartedAt = since; bump('trialStartedAt from tag'); }
  // A trial Stripe never saw is long over: mark it ended so the person is not shown as an active trial.
  if (tags.has('TRIAL_STARTED') && !person.trialStartedAt && !person.payingSince && !person.churnedAt && !person.trialEndedAt && !tags.has('PAYING_USER') && !tags.has('CHURNED_USER')) { patch.trialEndedAt = since; bump('trialEndedAt from tag'); }
  if (tags.has('PAYING_USER') && !person.payingSince) { patch.payingSince = since; bump('payingSince from tag'); }
  if (tags.has('CHURNED_USER') && !person.churnedAt && !person.payingSince) { patch.churnedAt = since; bump('churnedAt from tag'); }
  if (tags.has('AGENCYFUNNEL_PARTIAL')) tags.add('PARTIAL_FORM');
  const kept = [...tags].filter((t) => KEEP.has(t));
  if (kept.length !== tags.size) { patch.ghlTags = kept; bump('tags cleaned'); }
  if (Object.keys(patch).length) patches.push({ id: person.id, ...patch });
}
console.log('changes:', JSON.stringify(counts));
if (DRY) { console.log(`dry run: ${patches.length} people would change`); process.exit(0); }
let written = 0;
for (let offset = 0; offset < patches.length; offset += 100) {
  const batch = patches.slice(offset, offset + 100);
  await gql(`mutation ($data: [PersonCreateInput!]!) { createPeople(data: $data, upsert: true) { id } }`, { data: batch });
  written += batch.length;
}
console.log(`updated ${written} people`);
