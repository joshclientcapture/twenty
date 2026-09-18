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

// Same split as the intake merge code: E.164 number → calling code + national number; anything else is left out.
const DIAL_CODES = ['1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49','51','52','54','55','56','57','58','60','61','62','63','64','65','66','81','82','84','86','90','91','92','94','98','212','213','216','218','230','234','254','255','256','260','263','264','265','266','267','268','269','290','291','297','298','299','350','351','352','353','354','355','356','357','358','359','370','371','372','373','374','375','376','377','378','380','381','382','385','386','387','389','420','421','423','500','501','502','503','504','505','506','507','508','509','590','591','592','593','594','595','596','597','598','599','670','672','673','674','675','676','677','678','679','680','681','682','683','685','686','687','688','689','690','691','692','850','852','853','855','856','880','886','960','961','962','963','964','965','966','967','968','970','971','972','973','974','975','976','977','992','993','994','995','996','998'];
const phonesFor = (raw) => {
  const cleaned = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) return undefined;
  const digits = cleaned.slice(1);
  const code = [3, 2, 1].map((length) => digits.slice(0, length)).find((candidate) => DIAL_CODES.includes(candidate));
  if (!code) return undefined;
  return { primaryPhoneNumber: digits.slice(code.length), primaryPhoneCallingCode: `+${code}`, primaryPhoneCountryCode: '', additionalPhones: [] };
};

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
    phones: phonesFor(row.phone),
    leadSource: 'OTHER', stage: 'LEAD', ghlTags: ['PARTIAL_FORM'], ghlContactId: row.id, leadSince: row.date_added, createdAt: row.date_added, latestFormAt: row.date_added,
  } });
  console.log('created partial lead:', row.email.replace(/^(.{3}).*@/, '$1…@'));
}
console.log(`done: ${rows.length}`);
