// One-off: creates People for GoHighLevel contacts that arrived untagged with no source after the
// export (form partials the import rule skips), tagged PARTIAL_FORM with an unknown funnel, so the
// follow-up sequences can find them. Also makes sure the PARTIAL_FORM tag option exists.
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const gql = async (path, query, variables = {}) => { const r = await fetch(`http://127.0.0.1:${env.NODE_PORT ?? 3000}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${env.OS_TWENTY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) }); const p = await r.json(); if (p.errors) throw new Error(JSON.stringify(p.errors).slice(0, 500)); return p.data; };

const objects = (await gql('/metadata', `{ objects(paging: { first: 1000 }) { edges { node { nameSingular fieldsList { id name options } } } } }`)).objects.edges.map((e) => e.node);
const tagsField = objects.find((o) => o.nameSingular === 'person').fieldsList.find((f) => f.name === 'ghlTags');
if (!(tagsField.options ?? []).some((o) => o.value === 'PARTIAL_FORM')) {
  const options = [...(tagsField.options ?? []), { id: randomUUID(), value: 'PARTIAL_FORM', label: 'Partial form', color: 'orange', position: (tagsField.options ?? []).length }];
  await gql('/metadata', `mutation ($id: UUID!, $update: UpdateFieldInput!) { updateOneField(input: { id: $id, update: $update }) { id } }`, { id: tagsField.id, update: { options } });
  console.log('PARTIAL_FORM tag option added');
}

const client = new pg.Client({ connectionString: env.PG_DATABASE_URL });
await client.connect();
const since = process.argv[2] ?? '2026-09-17 07:00';
const { rows } = await client.query(
  `select g.id, g.email, g.first_name, g.last_name, g.phone, g.date_added
   from os.ghl_contacts g
   where g.date_added > $1 and cardinality(g.tags) = 0 and g.source is null and g.email is not null
     and not exists (select 1 from workspace_a1aip8pgko71t0v2lrw9rnizs.person p where p."deletedAt" is null and (lower(p."emailsPrimaryEmail") = lower(g.email) or p."emailsAdditionalEmails"::text ilike '%' || lower(g.email) || '%'))
     and lower(g.email) not like '%test%' and split_part(lower(g.email), '@', 2) not in ('conversifi.io', 'clientcapture.io', 'example.com', 'test.com')`,
  [since],
);
await client.end();
for (const row of rows) {
  await gql('/graphql', `mutation ($data: PersonCreateInput!) { createPerson(data: $data) { id } }`, { data: {
    name: { firstName: row.first_name ?? '', lastName: row.last_name ?? '' },
    emails: { primaryEmail: row.email.toLowerCase(), additionalEmails: [] },
    phones: row.phone ? { primaryPhoneNumber: row.phone.replace(/[^\d]/g, ''), primaryPhoneCallingCode: row.phone.startsWith('+') ? '' : '', primaryPhoneCountryCode: '', additionalPhones: [] } : undefined,
    leadSource: 'OTHER', stage: 'LEAD', ghlTags: ['PARTIAL_FORM'], ghlContactId: row.id, leadSince: row.date_added, createdAt: row.date_added, latestFormAt: row.date_added,
  } });
  console.log('created partial lead:', row.email.replace(/^(.{3}).*@/, '$1…@'));
}
console.log(`done: ${rows.length}`);
