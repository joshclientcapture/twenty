// Converts every workflow email body written as raw HTML into the editor's native document, so
// the builder shows what sends and editing keeps the styling. Originals are kept in
// os.email_body_originals so the change can be undone per step.
// Run on the VPS from packages/twenty-server:
//   node os-migration/48_email_bodies_to_documents.mjs [--dry] [--revert] [--verify] [--only <workflow name part>]
import { readFileSync } from 'fs';
import pg from 'pg';

import { documentToText, htmlEmailToDocument, serializeEmailDocument } from './lib/email-document.mjs';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const SCHEMA = 'workspace_a1aip8pgko71t0v2lrw9rnizs';
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const REVERT = args.includes('--revert');
const VERIFY = args.includes('--verify');
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].toLowerCase() : null;
const EMAIL_TYPES = new Set(['SEND_EMAIL', 'DRAFT_EMAIL']);

const client = new pg.Client({ connectionString: env.PG_DATABASE_URL });
await client.connect();
await client.query(`create table if not exists os.email_body_originals (version_id uuid not null, step_id text not null, workflow_name text, body text not null, converted_at timestamptz default now(), primary key (version_id, step_id))`);

const { rows: versions } = await client.query(
  `select v.id, v.steps, w.name from ${SCHEMA}."workflowVersion" v join ${SCHEMA}.workflow w on w.id = v."workflowId" and w."deletedAt" is null
    where v."deletedAt" is null and v.status::text in ('DRAFT', 'ACTIVE') order by w.name`,
);

// Independent HTML-to-text reading of the original, compared with the stored document's text.
const normaliseText = (text) => text.replace(/\r/g, '').split('\n').map((line) => line.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const htmlToText = (html) =>
  normaliseText(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' '),
  );
if (VERIFY) {
  const { rows: originals } = await client.query('select version_id, step_id, workflow_name, body from os.email_body_originals');
  let checked = 0;
  let problems = 0;
  for (const original of originals) {
    const version = versions.find((candidate) => candidate.id === original.version_id);
    const step = version?.steps?.find((candidate) => candidate.id === original.step_id);
    if (!step) continue;
    checked++;
    let stored;
    try { stored = JSON.parse(step.settings.input.body); } catch { problems++; console.log(`NOT A DOCUMENT: ${original.workflow_name} / ${step.name}`); continue; }
    const expected = htmlToText(original.body);
    const actual = normaliseText(documentToText(stored));
    const links = [...original.body.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    const storedLinks = JSON.stringify(stored).match(/"href":"([^"]+)"/g)?.map((match) => match.slice(8, -1)) ?? [];
    const bolds = (original.body.match(/<strong>/g) ?? []).length;
    const storedBolds = (JSON.stringify(stored).match(/"type":"bold"/g) ?? []).length;
    const issues = [];
    if (expected !== actual) issues.push('text differs');
    if (links.join('|') !== storedLinks.join('|')) issues.push(`links ${links.length} vs ${storedLinks.length}`);
    if (bolds > storedBolds) issues.push(`bold runs ${bolds} vs ${storedBolds}`);
    if (issues.length > 0) {
      problems++;
      console.log(`MISMATCH ${original.workflow_name} / ${step.name}: ${issues.join(', ')}`);
      if (expected !== actual) console.log(`  expected: ${JSON.stringify(expected).slice(0, 300)}\n  actual:   ${JSON.stringify(actual).slice(0, 300)}`);
    }
  }
  console.log(`verified ${checked} bodies, ${problems} problem(s)`);
  await client.end();
  process.exit(problems > 0 ? 1 : 0);
}

let converted = 0;
let reverted = 0;
let shown = false;
for (const version of versions) {
  if (ONLY && !version.name.toLowerCase().includes(ONLY)) continue;
  const steps = version.steps ?? [];
  let changed = false;
  if (REVERT) {
    const { rows: originals } = await client.query('select step_id, body from os.email_body_originals where version_id = $1', [version.id]);
    const byStep = new Map(originals.map((row) => [row.step_id, row.body]));
    for (const step of steps) {
      if (!byStep.has(step.id)) continue;
      step.settings.input.body = byStep.get(step.id);
      changed = true;
      reverted++;
    }
  } else {
    for (const step of steps) {
      if (!EMAIL_TYPES.has(step.type)) continue;
      const body = step.settings?.input?.body;
      if (typeof body !== 'string' || !body.trimStart().startsWith('<')) continue;
      const document = htmlEmailToDocument(body);
      if (!shown) {
        shown = true;
        console.log(`--- sample: ${version.name} / ${step.name}\n${documentToText(document)}\n--- json\n${serializeEmailDocument(document).slice(0, 700)}…`);
      }
      if (!DRY) await client.query('insert into os.email_body_originals (version_id, step_id, workflow_name, body) values ($1, $2, $3, $4) on conflict (version_id, step_id) do nothing', [version.id, step.id, version.name, body]);
      step.settings.input.body = serializeEmailDocument(document);
      changed = true;
      converted++;
    }
  }
  if (changed && !DRY) {
    await client.query(`update ${SCHEMA}."workflowVersion" set steps = $2::jsonb, "updatedAt" = now() where id = $1`, [version.id, JSON.stringify(steps)]);
    // The engine overlays each version with its twin in core."workflowVersion"; a run built from a
    // version whose core copy is stale executes the old steps, so both copies are written.
    await client.query(`update core."workflowVersion" c set steps = v.steps from ${SCHEMA}."workflowVersion" v where v.id = $1 and c.id = v."coreWorkflowVersionId"`, [version.id]);
  }
}
console.log(REVERT ? `reverted ${reverted} email bodies` : `${DRY ? 'would convert' : 'converted'} ${converted} email bodies across ${versions.length} versions`);
await client.end();
