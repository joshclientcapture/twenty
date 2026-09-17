import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { readFileSync } from 'fs';

import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { DataSource } from 'typeorm';

import { selectOptions, TwentyApiService, type WantedField } from 'src/conversifi-os/services/twenty-api.service';

type GhlContact = {
  id: string;
  firstNameRaw?: string | null;
  lastNameRaw?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  website?: string | null;
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
  source?: string | null;
  dateAdded?: string | null;
  tags?: string[];
  customFields?: { id: string; value: unknown }[];
};

type CandidateRow = {
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company_name: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  ghl_contact_id: string | null;
  ghl_source: string | null;
  ghl_tags: string[] | null;
  business_type: string | null;
  agency_services: string | null;
  monthly_revenue: string | null;
  lead_since: string | null;
  ledger_source: string | null;
  ledger_closer: string | null;
  from_ghl: boolean;
  from_ledger: boolean;
  from_stripe: boolean;
  from_calendly: boolean;
  from_customers: boolean;
  from_rentals: boolean;
};

// GHL custom field ids for the intake form answers (Conversifi location).
const GHL_FIELD = {
  website: '0l910MBKCyAa5qlOhKpM',
  businessType: 'cLqHDPPDncCBro6ekRLG',
  agencyServices: 'SDMm881Zj3Ic2Hwvo9l3',
  monthlyRevenue: 'mMRoDu00eGauNGMbCbuB',
};

// Jamal's rule: contacts count as Conversifi's when they did something with Conversifi, not by origin tag.
const ACTIVITY_TAGS = [
  'appointment confirmed', 'signup', 'trial started', 'paying user', 'churned user', 'demo', 'agency demo', 'dfy', 'dfy client',
  'no show', 'rescheduled', 'user set up call', 'setup call requested', 'web registered', 'agencyfunnel-lead', 'agencyfunnel-partial',
  'deal closed', 'voucher demo', 'feedback-scheme', 'diagnostic-call', 'interested', 'not interested', '50%offer', 'signup replied', 'trial replied',
];
const ACTIVITY_SOURCES = ['Calendly', 'Webinar'];

// The GHL tags that still carry meaning once the flows move into Twenty; the rest stay in os.ghl_contacts.
const TAG_OPTIONS: { tag: string; value: string; label: string; color: string }[] = [
  { tag: 'appointment confirmed', value: 'APPOINTMENT_CONFIRMED', label: 'Appointment confirmed', color: 'blue' },
  { tag: 'demo', value: 'DEMO', label: 'Demo', color: 'blue' },
  { tag: 'agency demo', value: 'AGENCY_DEMO', label: 'Agency demo', color: 'turquoise' },
  { tag: 'dfy', value: 'DFY', label: 'DFY', color: 'purple' },
  { tag: 'no show', value: 'NO_SHOW', label: 'No show', color: 'red' },
  { tag: 'rescheduled', value: 'RESCHEDULED', label: 'Rescheduled', color: 'orange' },
  { tag: 'signup', value: 'SIGNUP', label: 'Signup', color: 'sky' },
  { tag: 'trial started', value: 'TRIAL_STARTED', label: 'Trial started', color: 'green' },
  { tag: 'paying user', value: 'PAYING_USER', label: 'Paying user', color: 'green' },
  { tag: 'churned user', value: 'CHURNED_USER', label: 'Churned user', color: 'red' },
  { tag: 'user set up call', value: 'USER_SET_UP_CALL', label: 'Set-up call booked', color: 'green' },
  { tag: 'setup call requested', value: 'SETUP_CALL_REQUESTED', label: 'Set-up call requested', color: 'green' },
  { tag: 'web registered', value: 'WEB_REGISTERED', label: 'Webinar registered', color: 'pink' },
  { tag: 'web entered', value: 'WEB_ENTERED', label: 'Webinar entered', color: 'pink' },
  { tag: 'web reached offer', value: 'WEB_REACHED_OFFER', label: 'Webinar reached offer', color: 'pink' },
  { tag: 'web offer click', value: 'WEB_OFFER_CLICK', label: 'Webinar offer click', color: 'pink' },
  { tag: 'web trial click', value: 'WEB_TRIAL_CLICK', label: 'Webinar trial click', color: 'pink' },
  { tag: 'web paid', value: 'WEB_PAID', label: 'Webinar paid', color: 'pink' },
  { tag: 'agencyfunnel-lead', value: 'AGENCYFUNNEL_LEAD', label: 'Agency funnel lead', color: 'turquoise' },
  { tag: 'agencyfunnel-partial', value: 'AGENCYFUNNEL_PARTIAL', label: 'Agency funnel partial', color: 'turquoise' },
  { tag: 'deal closed', value: 'DEAL_CLOSED', label: 'Deal closed', color: 'green' },
  { tag: 'dfy client', value: 'DFY_CLIENT', label: 'DFY client', color: 'purple' },
  { tag: 'interested', value: 'INTERESTED', label: 'Interested', color: 'green' },
  { tag: 'not interested', value: 'NOT_INTERESTED', label: 'Not interested', color: 'gray' },
  { tag: 'nurture sequence', value: 'NURTURE_SEQUENCE', label: 'Nurture sequence', color: 'gray' },
  { tag: 'human intervention', value: 'HUMAN_INTERVENTION', label: 'Human intervention', color: 'orange' },
  { tag: 'signup replied', value: 'SIGNUP_REPLIED', label: 'Signup replied', color: 'sky' },
  { tag: 'trial replied', value: 'TRIAL_REPLIED', label: 'Trial replied', color: 'sky' },
  { tag: '50%offer', value: 'FIFTY_PERCENT_OFFER', label: '50% offer', color: 'orange' },
  { tag: 'voucher demo', value: 'VOUCHER_DEMO', label: 'Voucher demo', color: 'yellow' },
  { tag: 'feedback-scheme', value: 'FEEDBACK_SCHEME', label: 'Feedback scheme', color: 'yellow' },
  { tag: 'diagnostic-call', value: 'DIAGNOSTIC_CALL', label: 'Diagnostic call', color: 'yellow' },
  { tag: 'linkedin outbound', value: 'LINKEDIN_OUTBOUND', label: 'LinkedIn outbound', color: 'sky' },
  { tag: 'dnd', value: 'DND', label: 'Do not disturb', color: 'gray' },
  { tag: 'enable dnd', value: 'ENABLE_DND', label: 'DND email', color: 'gray' },
  { tag: 'bad egg', value: 'BAD_EGG', label: 'Bad egg', color: 'red' },
  { tag: 'blacklist', value: 'BLACKLIST', label: 'Blacklist', color: 'red' },
];
const TAG_VALUE_BY_TAG = new Map(TAG_OPTIONS.map((option) => [option.tag, option.value]));

const LEAD_SOURCE_OPTIONS = [
  { value: 'DEMO', label: 'Demo booking', color: 'blue' },
  { value: 'AGENCY', label: 'Agency demo', color: 'turquoise' },
  { value: 'DFY', label: 'DFY discovery', color: 'purple' },
  { value: 'AGENCY_FUNNEL', label: 'Agency funnel', color: 'turquoise' },
  { value: 'WEBINAR', label: 'Webinar', color: 'pink' },
  { value: 'SIGNUP', label: 'Self-serve signup', color: 'sky' },
  { value: 'LINKEDIN', label: 'LinkedIn outreach', color: 'sky' },
  { value: 'GROWTH', label: 'Growth', color: 'green' },
  { value: 'ADS', label: 'Ads', color: 'orange' },
  { value: 'ORGANIC', label: 'Organic', color: 'green' },
  { value: 'OTHER', label: 'Other', color: 'gray' },
];

const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'live.co.uk',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'msn.com', 'proton.me', 'protonmail.com', 'pm.me', 'yandex.com', 'mail.com', 'gmx.com',
  'gmx.de', 'ymail.com', 'hey.com', 'zoho.com', 'outlook.co.uk', 'btinternet.com', 'sky.com', 'web.de', 'qq.com', '163.com',
]);

const RECORD_BATCH_SIZE = 100;

const cleanText = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const cleanEmail = (value: unknown) => {
  const email = cleanText(value)?.toLowerCase() ?? null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};
const domainOf = (website: string | null, email: string) => {
  if (website) {
    try {
      const host = new URL(website.startsWith('http') ? website : `https://${website}`).hostname.replace(/^www\./, '').toLowerCase();
      if (host.includes('.')) return host;
    } catch {
      // fall back to the email domain
    }
  }
  const emailDomain = email.split('@')[1]?.toLowerCase() ?? '';
  return emailDomain && !FREE_MAIL_DOMAINS.has(emailDomain) ? emailDomain : null;
};
const companyNameFor = (companyName: string | null, domain: string) =>
  companyName ?? domain.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const leadSourceFor = (row: CandidateRow): string => {
  const tags = new Set(row.ghl_tags ?? []);
  if (tags.has('agencyfunnel-lead') || tags.has('agencyfunnel-partial')) return 'AGENCY_FUNNEL';
  if (tags.has('agency demo')) return 'AGENCY';
  if (tags.has('dfy') || tags.has('dfy client')) return 'DFY';
  if (tags.has('web registered') || row.ghl_source === 'Webinar') return 'WEBINAR';
  if (tags.has('demo') || tags.has('appointment confirmed') || row.ghl_source === 'Calendly' || row.from_calendly) return 'DEMO';
  switch (row.ledger_source) {
    case 'linkedin_outreach': return 'LINKEDIN';
    case 'growth': return 'GROWTH';
    case 'facebook_ads': return 'ADS';
    case 'organic': return 'ORGANIC';
    case 'agency': return 'AGENCY';
    case 'email_marketing': return 'OTHER';
  }
  if (tags.has('linkedin outbound')) return 'LINKEDIN';
  if (tags.has('signup') || tags.has('trial started') || row.from_stripe) return 'SIGNUP';
  return 'OTHER';
};

const closerFor = (row: CandidateRow) => {
  if (row.ledger_closer) return row.ledger_closer;
  const tags = new Set(row.ghl_tags ?? []);
  if (tags.has('therapon')) return 'Therapon Savvas';
  if (tags.has('jamal') || tags.has('jr')) return 'Jamal Robinson';
  return '';
};

const phonesFor = (phone: string | null) => {
  if (!phone) return null;
  const parsed = parsePhoneNumberFromString(phone);
  if (!parsed) return null;
  return {
    primaryPhoneNumber: parsed.nationalNumber,
    primaryPhoneCallingCode: `+${parsed.countryCallingCode}`,
    primaryPhoneCountryCode: parsed.country ?? '',
    additionalPhones: [],
  };
};

// One-off (re-runnable) import of everyone Conversifi has dealt with into Twenty People and
// Companies: the GHL contacts with Conversifi activity, plus every customer, trial and Calendly
// invitee the OS knows about, merged on email.
@Injectable()
export class OsContactsImportService {
  private readonly logger = new Logger(OsContactsImportService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  async loadGhlExport(filePath: string) {
    const lines = readFileSync(filePath, 'utf8').split('\n').filter((line) => line.trim() !== '');
    const contacts: GhlContact[] = lines.map((line) => JSON.parse(line));
    await this.dataSource.query(`
      create table if not exists os.ghl_contacts (
        id text primary key,
        email text,
        first_name text,
        last_name text,
        phone text,
        company_name text,
        website text,
        country text,
        city text,
        timezone text,
        source text,
        date_added timestamptz,
        tags text[] not null default '{}',
        business_type text,
        agency_services text,
        monthly_revenue text,
        raw jsonb not null,
        loaded_at timestamptz not null default now()
      );
      create index if not exists ghl_contacts_email_idx on os.ghl_contacts (lower(email));
    `);
    let written = 0;
    for (let offset = 0; offset < contacts.length; offset += 200) {
      const batch = contacts.slice(offset, offset + 200);
      const params: unknown[] = [];
      const tuples = batch.map((contact) => {
        const field = (id: string) => cleanText(contact.customFields?.find((candidate) => candidate.id === id)?.value);
        const values = [
          contact.id,
          cleanEmail(contact.email),
          cleanText(contact.firstNameRaw) ?? cleanText(contact.firstName),
          cleanText(contact.lastNameRaw) ?? cleanText(contact.lastName),
          cleanText(contact.phone),
          cleanText(contact.companyName),
          cleanText(contact.website) ?? field(GHL_FIELD.website),
          cleanText(contact.country),
          cleanText(contact.city),
          cleanText(contact.timezone),
          cleanText(contact.source),
          contact.dateAdded ?? null,
          contact.tags ?? [],
          field(GHL_FIELD.businessType),
          field(GHL_FIELD.agencyServices),
          field(GHL_FIELD.monthlyRevenue),
          JSON.stringify(contact),
        ];
        const placeholders = values.map((value, index) => {
          params.push(value);
          const cast = index === 11 ? '::timestamptz' : index === 12 ? '::text[]' : index === 16 ? '::jsonb' : '';
          return `$${params.length}${cast}`;
        });
        return `(${placeholders.join(',')})`;
      });
      await this.dataSource.query(
        `insert into os.ghl_contacts (id, email, first_name, last_name, phone, company_name, website, country, city, timezone, source, date_added, tags, business_type, agency_services, monthly_revenue, raw)
         values ${tuples.join(',')}
         on conflict (id) do update set email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name, phone = excluded.phone,
           company_name = excluded.company_name, website = excluded.website, country = excluded.country, city = excluded.city, timezone = excluded.timezone,
           source = excluded.source, date_added = excluded.date_added, tags = excluded.tags, business_type = excluded.business_type,
           agency_services = excluded.agency_services, monthly_revenue = excluded.monthly_revenue, raw = excluded.raw, loaded_at = now()`,
        params,
      );
      written += batch.length;
    }
    return { loaded: written };
  }

  async ensureFields() {
    const personFields: WantedField[] = [
      { name: 'leadSource', label: 'Lead source', type: 'SELECT', icon: 'IconTargetArrow', extra: { options: selectOptions(LEAD_SOURCE_OPTIONS) } },
      { name: 'ghlTags', label: 'Tags (GHL)', type: 'MULTI_SELECT', icon: 'IconTags', extra: { options: selectOptions(TAG_OPTIONS.map(({ value, label, color }) => ({ value, label, color }))) } },
      { name: 'businessType', label: 'Business type', type: 'TEXT', icon: 'IconBriefcase' },
      { name: 'agencyServices', label: 'Agency services', type: 'TEXT', icon: 'IconTool' },
      { name: 'monthlyRevenue', label: 'Monthly revenue', type: 'TEXT', icon: 'IconCoin' },
      { name: 'closer', label: 'Closer', type: 'TEXT', icon: 'IconUser' },
      { name: 'countryCode', label: 'Country', type: 'TEXT', icon: 'IconWorld' },
      { name: 'leadSince', label: 'Lead since', type: 'DATE_TIME', icon: 'IconCalendarPlus' },
      { name: 'ghlContactId', label: 'GHL contact id', type: 'TEXT', icon: 'IconId' },
    ];
    await this.twentyApi.ensureFields('person', personFields);
  }

  async candidates(): Promise<CandidateRow[]> {
    return this.dataSource.query(`
      with ghl as (
        select lower(email) as email, first_name, last_name, phone, company_name, website, country, city, id as ghl_contact_id,
               source as ghl_source, tags as ghl_tags, business_type, agency_services, monthly_revenue, date_added as lead_since
        from os.ghl_contacts
        where email is not null
          and (tags && $1::text[] or source = any($2::text[]))
      ),
      ledger as (
        select lower(coalesce(x.email, x.stripe_email)) as email, x.name, x.source as ledger_source, x.closer as ledger_closer, x.signup_at
        from os.sales_ledger_cache c, jsonb_to_recordset(c.data) as x(email text, stripe_email text, name text, source text, closer text, signup_at timestamptz)
        where coalesce(x.email, x.stripe_email) is not null
      ),
      stripe as (
        select lower(customer_email) as email, max(customer_name) as name, min(created) as created
        from os.stripe_subscriptions where customer_email is not null group by lower(customer_email)
      ),
      calendly as (
        select lower(email) as email, max(name) as name, min(booked_at) as booked_at
        from os.calendly_invitees where email is not null group by lower(email)
      ),
      payments as (
        select lower(email) as email, max(payer_name) as name, min(created) as created
        from os.stripe_payments where email is not null and paid group by lower(email)
      ),
      customers as (
        select lower(coalesce(stripe_email, auth_email)) as email, max(full_name) as name, min(signup_at) as signup_at
        from os.conversifi_customers where coalesce(stripe_email, auth_email) is not null group by lower(coalesce(stripe_email, auth_email))
      ),
      rentals as (
        select lower(email) as email, max(name) as name, min(created_at) as created_at
        from os.rental_clients where email is not null group by lower(email)
      ),
      emails as (
        select email from ghl union select email from ledger union select email from stripe union select email from calendly
        union select email from payments union select email from customers union select email from rentals
      )
      select e.email,
             coalesce(g.first_name, split_part(coalesce(l.name, s.name, c.name, p.name, cu.name, r.name), ' ', 1)) as first_name,
             coalesce(g.last_name, nullif(regexp_replace(coalesce(l.name, s.name, c.name, p.name, cu.name, r.name), '^\\S+\\s*', ''), '')) as last_name,
             g.phone, g.company_name, g.website, g.country, g.city, g.ghl_contact_id, g.ghl_source, g.ghl_tags,
             g.business_type, g.agency_services, g.monthly_revenue,
             least(g.lead_since, l.signup_at, s.created, c.booked_at, p.created, cu.signup_at, r.created_at) as lead_since,
             l.ledger_source, l.ledger_closer,
             g.email is not null as from_ghl, l.email is not null as from_ledger, (s.email is not null or p.email is not null) as from_stripe,
             c.email is not null as from_calendly, cu.email is not null as from_customers, r.email is not null as from_rentals
      from emails e
      left join ghl g on g.email = e.email
      left join (select distinct on (email) * from ledger order by email, signup_at desc nulls last) l on l.email = e.email
      left join stripe s on s.email = e.email
      left join calendly c on c.email = e.email
      left join payments p on p.email = e.email
      left join customers cu on cu.email = e.email
      left join rentals r on r.email = e.email
      order by e.email`,
      [ACTIVITY_TAGS, ACTIVITY_SOURCES],
    );
  }

  async run(options: { dryRun?: boolean } = {}) {
    if (!this.twentyApi.isConfigured()) throw new Error('OS_TWENTY_API_KEY is not set');
    await this.ensureFields();
    const rows = await this.candidates();
    const count = (predicate: (row: CandidateRow) => boolean) => rows.filter(predicate).length;
    this.logger.log(
      `candidates: ${rows.length} (ghl ${count((r) => r.from_ghl)}, ledger ${count((r) => r.from_ledger)}, stripe ${count((r) => r.from_stripe)}, ` +
      `calendly ${count((r) => r.from_calendly)}, customers ${count((r) => r.from_customers)}, rentals ${count((r) => r.from_rentals)}; os-only ${count((r) => !r.from_ghl)})`,
    );

    // Companies first, keyed on domain, so people can point at them.
    const companyByDomain = new Map<string, { name: string; domainName: { primaryLinkUrl: string; primaryLinkLabel: string } }>();
    for (const row of rows) {
      const domain = domainOf(row.website, row.email);
      if (!domain || companyByDomain.has(domain)) continue;
      companyByDomain.set(domain, { name: companyNameFor(row.company_name, domain), domainName: { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: '' } });
    }
    const companyIdByDomain = new Map<string, string>();
    const companies = [...companyByDomain.values()];
    if (!options.dryRun) {
      for (let offset = 0; offset < companies.length; offset += RECORD_BATCH_SIZE) {
        const batch = companies.slice(offset, offset + RECORD_BATCH_SIZE);
        const result = await this.twentyApi.records<{ createCompanies: { id: string; domainName: { primaryLinkUrl: string } }[] }>(
          `mutation UpsertCompanies($data: [CompanyCreateInput!]!) { createCompanies(data: $data, upsert: true) { id domainName { primaryLinkUrl } } }`,
          { data: batch },
        );
        for (const company of result.createCompanies) {
          const domain = company.domainName.primaryLinkUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
          companyIdByDomain.set(domain, company.id);
        }
      }
    }

    const people = rows.map((row) => {
      const domain = domainOf(row.website, row.email);
      const tags = (row.ghl_tags ?? []).map((tag) => TAG_VALUE_BY_TAG.get(tag)).filter((value): value is string => !!value);
      return {
        name: { firstName: row.first_name ?? '', lastName: row.last_name ?? '' },
        emails: { primaryEmail: row.email, additionalEmails: [] },
        phones: phonesFor(row.phone),
        city: row.city ?? '',
        companyId: domain ? companyIdByDomain.get(domain) ?? null : null,
        leadSource: leadSourceFor(row),
        ghlTags: [...new Set(tags)],
        businessType: row.business_type ?? '',
        agencyServices: row.agency_services ?? '',
        monthlyRevenue: row.monthly_revenue ?? '',
        closer: closerFor(row),
        countryCode: row.country ?? '',
        leadSince: row.lead_since,
        ghlContactId: row.ghl_contact_id ?? '',
      };
    });

    let written = 0;
    if (!options.dryRun) {
      for (let offset = 0; offset < people.length; offset += RECORD_BATCH_SIZE) {
        const batch = people.slice(offset, offset + RECORD_BATCH_SIZE);
        await this.twentyApi.records(
          `mutation UpsertPeople($data: [PersonCreateInput!]!) { createPeople(data: $data, upsert: true) { id } }`,
          { data: batch },
        );
        written += batch.length;
        if (written % 500 === 0) this.logger.log(`people upserted: ${written}/${people.length}`);
      }
    }
    return { candidates: rows.length, companies: companies.length, people: written, dryRun: !!options.dryRun };
  }
}
