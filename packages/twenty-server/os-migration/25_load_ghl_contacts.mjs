// Upserts a JSON-lines file of GoHighLevel contacts (the API's contact shape) into os.ghl_contacts,
// exactly like the one-off export loader, so the people sync step can pick up the new ones.
// Usage: node os-migration/25_load_ghl_contacts.mjs <file.jsonl>
import { readFileSync } from 'fs';
import pg from 'pg';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const GHL_FIELD = { website: '0l910MBKCyAa5qlOhKpM', businessType: 'cLqHDPPDncCBro6ekRLG', agencyServices: 'SDMm881Zj3Ic2Hwvo9l3', monthlyRevenue: 'mMRoDu00eGauNGMbCbuB' };
const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const email = (value) => { const candidate = text(value)?.toLowerCase() ?? null; return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null; };

const file = process.argv[2];
if (!file) throw new Error('file path required');
const contacts = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
const client = new pg.Client({ connectionString: env.PG_DATABASE_URL });
await client.connect();
let written = 0;
for (const contact of contacts) {
  const field = (id) => text(contact.customFields?.find((candidate) => candidate.id === id)?.value);
  await client.query(
    `insert into os.ghl_contacts (id, email, first_name, last_name, phone, company_name, website, country, city, timezone, source, date_added, tags, business_type, agency_services, monthly_revenue, raw)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::text[],$14,$15,$16,$17::jsonb)
     on conflict (id) do update set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, phone = excluded.phone,
       company_name = excluded.company_name, website = excluded.website, country = excluded.country, city = excluded.city, timezone = excluded.timezone,
       source = excluded.source, date_added = excluded.date_added, tags = excluded.tags, business_type = excluded.business_type,
       agency_services = excluded.agency_services, monthly_revenue = excluded.monthly_revenue, raw = excluded.raw, loaded_at = now()`,
    [contact.id, email(contact.email), text(contact.firstNameRaw) ?? text(contact.firstName), text(contact.lastNameRaw) ?? text(contact.lastName), text(contact.phone), text(contact.companyName),
      text(contact.website) ?? field(GHL_FIELD.website), text(contact.country), text(contact.city), text(contact.timezone), text(contact.source), contact.dateAdded ?? null, contact.tags ?? [],
      field(GHL_FIELD.businessType), field(GHL_FIELD.agencyServices), field(GHL_FIELD.monthlyRevenue), JSON.stringify(contact)],
  );
  written++;
}
await client.end();
console.log(`ghl contacts upserted: ${written}`);
