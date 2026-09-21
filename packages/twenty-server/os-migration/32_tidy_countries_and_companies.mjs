// One-off: countries from phones, company names cleaned, mistyped free-mail companies and empty
// companies removed. Idempotent. Run on the VPS: node os-migration/32_tidy_countries_and_companies.mjs [--dry-run]
import { readFileSync } from 'fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const DRY = process.argv.includes('--dry-run');
const gql = async (query, variables = {}) => {
  const response = await fetch(`http://127.0.0.1:${env.NODE_PORT ?? 3000}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${env.OS_TWENTY_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(JSON.stringify(payload.errors).slice(0, 500));
  return payload.data;
};
const all = async (object, fields, filter = '') => {
  const rows = [];
  let after = null;
  for (;;) {
    const page = await gql(`query ($after: String) { ${object}(first: 200, after: $after${filter ? `, filter: ${filter}` : ''}) { edges { node { ${fields} } } pageInfo { hasNextPage endCursor } } }`, { after });
    rows.push(...page[object].edges.map((edge) => edge.node));
    if (!page[object].pageInfo.hasNextPage) return rows;
    after = page[object].pageInfo.endCursor;
  }
};
const batches = async (mutation, items) => {
  for (let offset = 0; offset < items.length; offset += 100) await gql(mutation, { data: items.slice(offset, offset + 100) });
};

const FREE_MAIL_STEM = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|aol|yopmail|protonmail|proton|msn|ymail)\.[a-z]{2,4}(\.[a-z]{2,3})?$/;
const nameFromDomain = (domain) => domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const cleanName = (name, domain) => {
  const cleaned = (name ?? '').replace(/^company name;?\s*/i, '').replace(/^https?:\/\/(www\.)?/i, '').replace(/^www\./i, '').replace(/\/+$/, '').trim();
  if (!cleaned || /^[0-9 +()-]+$/.test(cleaned) || /^(-|\.|none|n\/?a|null|undefined|company name)$/i.test(cleaned)) return domain ? nameFromDomain(domain) : cleaned;
  // A bare domain typed into the name field reads better as its stem: acme.com becomes Acme.
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(cleaned)) return nameFromDomain(cleaned);
  return cleaned;
};
const hostOf = (url) => (url ?? '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();

// 1. Countries from phones.
const people = await all('people', 'id countryCode companyId phones { primaryPhoneCountryCode }');
const countryFixes = people
  .filter((person) => person.phones?.primaryPhoneCountryCode && person.phones.primaryPhoneCountryCode !== (person.countryCode ?? ''))
  .map((person) => ({ id: person.id, countryCode: person.phones.primaryPhoneCountryCode }));
console.log(`countries to fix from phones: ${countryFixes.length}`);

// 2. Companies.
const companies = await all('companies', 'id name domainName { primaryLinkUrl }');
const peopleByCompany = new Map();
for (const person of people) if (person.companyId) peopleByCompany.set(person.companyId, (peopleByCompany.get(person.companyId) ?? 0) + 1);
const freeMail = companies.filter((company) => FREE_MAIL_STEM.test(hostOf(company.domainName?.primaryLinkUrl)));
const empty = companies.filter((company) => !peopleByCompany.has(company.id) && !freeMail.includes(company));
const renames = companies
  .filter((company) => !freeMail.includes(company) && !empty.includes(company))
  .map((company) => ({ id: company.id, name: cleanName(company.name, hostOf(company.domainName?.primaryLinkUrl)), was: company.name }))
  .filter((company) => company.name && company.name !== company.was);
console.log(`companies to rename: ${renames.length}`);
for (const company of renames.slice(0, 12)) console.log(`  "${company.was}" -> "${company.name}"`);
console.log(`mistyped free-mail companies to remove: ${freeMail.length} (${freeMail.map((company) => hostOf(company.domainName?.primaryLinkUrl)).join(', ')})`);
console.log(`empty companies to remove: ${empty.length}`);
const unlink = people.filter((person) => freeMail.some((company) => company.id === person.companyId)).map((person) => ({ id: person.id, companyId: null }));
console.log(`people to unlink from free-mail companies: ${unlink.length}`);

if (DRY) { console.log('dry run'); process.exit(0); }
await batches(`mutation ($data: [PersonCreateInput!]!) { createPeople(data: $data, upsert: true) { id } }`, [...countryFixes, ...unlink]);
await batches(`mutation ($data: [CompanyCreateInput!]!) { createCompanies(data: $data, upsert: true) { id } }`, renames.map(({ id, name }) => ({ id, name })));
const remove = [...freeMail, ...empty].map((company) => company.id);
for (let offset = 0; offset < remove.length; offset += 100) {
  await gql(`mutation ($ids: [UUID!]!) { deleteCompanies(filter: { id: { in: $ids } }) { id } }`, { ids: remove.slice(offset, offset + 100) });
}
console.log(`done: ${countryFixes.length} countries, ${renames.length} renames, ${unlink.length} unlinked, ${remove.length} companies removed`);
