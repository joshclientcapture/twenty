import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import {
  companyNameFor,
  domainOf,
  isExcluded,
  nameFromEmail,
  phonesFor,
  TAG_VALUE_BY_TAG,
} from 'src/conversifi-os/services/os-contacts-import.service';
import { TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';

export type IntakeEvent = 'form' | 'stripe' | 'webinar' | 'churn';
export const INTAKE_EVENTS: IntakeEvent[] = ['form', 'stripe', 'webinar', 'churn'];

type Payload = Record<string, unknown>;

type ExistingPerson = {
  id: string;
  name: { firstName: string; lastName: string };
  leadSource: string | null;
  ghlTags: string[] | null;
  companyId: string | null;
  phones: { primaryPhoneNumber: string | null } | null;
  businessType: string;
  agencyServices: string;
  monthlyRevenue: string;
};

type PersonPatch = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  website?: string | null;
  companyName?: string | null;
  businessType?: string;
  agencyServices?: string;
  monthlyRevenue?: string;
  leadSource?: string;
  addTags?: string[];
  removeTags?: string[];
  leadSince?: string;
};

// A workflow step forwards "{{trigger.body.x}}" literally when the app omitted x; treat that as empty.
const text = (value: unknown) => (typeof value === 'string' && value.trim() !== '' && !value.includes('{{') ? value.trim() : null);
const email = (value: unknown) => {
  const candidate = text(value)?.toLowerCase() ?? null;
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
};
const notAsked = (value: string | null) => (value && !/^not (asked|applicable)$/i.test(value) ? value : null);

// The form's route label (see demo-form-data.ts in the app) decides the first-touch source.
const ROUTE_SOURCE: Record<string, { source: string; tags: string[] }> = {
  demo: { source: 'DEMO', tags: ['DEMO'] },
  'agency demo': { source: 'AGENCY', tags: ['AGENCY_DEMO'] },
  agency: { source: 'AGENCY_FUNNEL', tags: ['AGENCYFUNNEL_LEAD'] },
  dfy: { source: 'DFY', tags: ['DFY'] },
  webinar: { source: 'WEBINAR', tags: ['WEB_REGISTERED'] },
};

// Receives what the Conversifi app used to send only to GoHighLevel and n8n, and applies it to
// the Person in Twenty (create or update, tags merged, first-touch lead source kept).
@Injectable()
export class OsIntakeService {
  private readonly logger = new Logger(OsIntakeService.name);
  private tableReady = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  async handle(event: IntakeEvent, payload: Payload): Promise<{ ok: boolean; outcome: string }> {
    await this.ensureTable();
    const address = email(payload.email);
    let outcome = 'ignored';
    try {
      if (!address) {
        outcome = 'no email';
      } else if (isExcluded({ email: address, first_name: text(payload.first_name), last_name: text(payload.last_name) })) {
        outcome = 'excluded';
      } else {
        const patch = this.patchFor(event, payload);
        outcome = await this.applyPatch(address, patch);
      }
    } catch (error) {
      outcome = `error: ${(error as Error).message.slice(0, 300)}`;
      this.logger.error(`intake ${event} for ${address ?? '?'} failed: ${(error as Error).message}`);
    }
    await this.dataSource.query(
      `insert into os.intake_events (event, email, payload, outcome) values ($1, $2, $3::jsonb, $4)`,
      [event, address, JSON.stringify(payload), outcome],
    );
    return { ok: !outcome.startsWith('error'), outcome };
  }

  private patchFor(event: IntakeEvent, payload: Payload): PersonPatch {
    switch (event) {
      case 'form': {
        const route = text(payload.route_label)?.toLowerCase() ?? null;
        const routed = route ? ROUTE_SOURCE[route] ?? ROUTE_SOURCE[route.replace(/\s+demo$/, '')] : undefined;
        return {
          firstName: text(payload.first_name) ?? undefined,
          lastName: text(payload.last_name) ?? undefined,
          phone: text(payload.phone),
          website: text(payload.website),
          businessType: notAsked(text(payload.business_type)) ?? undefined,
          agencyServices: notAsked(text(payload.agency_services)) ?? undefined,
          monthlyRevenue: notAsked(text(payload.revenue)) ?? undefined,
          leadSource: routed?.source,
          addTags: routed?.tags ?? [],
          leadSince: new Date().toISOString(),
        };
      }
      case 'stripe': {
        const type = text(payload.event_type);
        const [firstName, ...rest] = (text(payload.name) ?? '').split(/\s+/).filter(Boolean);
        const tags = type === 'signup' ? ['SIGNUP'] : type === 'trial_started' ? ['TRIAL_STARTED'] : type === 'subscription_started' ? ['PAYING_USER'] : [];
        return {
          firstName: firstName || undefined,
          lastName: rest.length ? rest.join(' ') : undefined,
          leadSource: 'SIGNUP',
          addTags: tags,
          removeTags: type === 'subscription_started' ? ['CHURNED_USER'] : [],
          leadSince: new Date().toISOString(),
        };
      }
      case 'webinar': {
        const tag = text(payload.tag);
        const mapped = tag ? TAG_VALUE_BY_TAG.get(tag) : undefined;
        return {
          firstName: text(payload.first_name) ?? undefined,
          lastName: text(payload.last_name) ?? undefined,
          leadSource: 'WEBINAR',
          addTags: mapped ? [mapped] : [],
          removeTags: mapped === 'WEB_PAID' ? ['CHURNED_USER'] : [],
          leadSince: new Date().toISOString(),
        };
      }
      case 'churn': {
        const action = text(payload.action);
        return action === 'add_churned'
          ? { addTags: ['CHURNED_USER'], removeTags: ['PAYING_USER'] }
          : action === 'remove_churned'
            ? { addTags: ['PAYING_USER'], removeTags: ['CHURNED_USER'] }
            : {};
      }
    }
  }

  private async applyPatch(address: string, patch: PersonPatch): Promise<string> {
    const existing = await this.findPerson(address);
    const domain = domainOf(patch.website ?? null, address);
    let companyId: string | null | undefined;
    if (domain && (!existing || !existing.companyId)) companyId = await this.upsertCompany(domain, patch.companyName ?? null, patch.leadSince);

    if (!existing) {
      const name = patch.firstName || patch.lastName ? { firstName: patch.firstName ?? '', lastName: patch.lastName ?? '' } : nameFromEmail(address);
      await this.twentyApi.records(
        `mutation IntakeCreatePerson($data: PersonCreateInput!) { createPerson(data: $data) { id } }`,
        {
          data: {
            name,
            emails: { primaryEmail: address, additionalEmails: [] },
            phones: phonesFor(patch.phone ?? null),
            companyId: companyId ?? null,
            leadSource: patch.leadSource ?? 'OTHER',
            ghlTags: [...new Set(patch.addTags ?? [])],
            businessType: patch.businessType ?? '',
            agencyServices: patch.agencyServices ?? '',
            monthlyRevenue: patch.monthlyRevenue ?? '',
            leadSince: patch.leadSince ?? new Date().toISOString(),
          },
        },
      );
      return 'created';
    }

    const tags = new Set(existing.ghlTags ?? []);
    for (const tag of patch.addTags ?? []) tags.add(tag);
    for (const tag of patch.removeTags ?? []) tags.delete(tag);
    const update: Record<string, unknown> = { ghlTags: [...tags] };
    // First touch wins for lead source; names and intake answers fill gaps but never overwrite.
    if (!existing.leadSource && patch.leadSource) update.leadSource = patch.leadSource;
    if (!existing.name.firstName && !existing.name.lastName && (patch.firstName || patch.lastName)) update.name = { firstName: patch.firstName ?? '', lastName: patch.lastName ?? '' };
    if (!existing.phones?.primaryPhoneNumber && patch.phone) update.phones = phonesFor(patch.phone);
    if (!existing.businessType && patch.businessType) update.businessType = patch.businessType;
    if (!existing.agencyServices && patch.agencyServices) update.agencyServices = patch.agencyServices;
    if (!existing.monthlyRevenue && patch.monthlyRevenue) update.monthlyRevenue = patch.monthlyRevenue;
    if (!existing.companyId && companyId) update.companyId = companyId;
    await this.twentyApi.records(
      `mutation IntakeUpdatePerson($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`,
      { id: existing.id, data: update },
    );
    return 'updated';
  }

  private async findPerson(address: string): Promise<ExistingPerson | null> {
    const result = await this.twentyApi.records<{ people: { edges: { node: ExistingPerson }[] } }>(
      `query IntakeFindPerson($email: String!) {
         people(filter: { emails: { primaryEmail: { eq: $email } } }, first: 1) {
           edges { node { id name { firstName lastName } leadSource ghlTags companyId phones { primaryPhoneNumber } businessType agencyServices monthlyRevenue } }
         }
       }`,
      { email: address },
    );
    if (result.people.edges[0]) return result.people.edges[0].node;
    // A merged person may carry this address as a secondary one.
    const byEmail = await this.twentyApi.peopleByEmail();
    const id = byEmail.get(address);
    if (!id) return null;
    const byId = await this.twentyApi.records<{ person: ExistingPerson }>(
      `query IntakePersonById($id: UUID!) { person(filter: { id: { eq: $id } }) { id name { firstName lastName } leadSource ghlTags companyId phones { primaryPhoneNumber } businessType agencyServices monthlyRevenue } }`,
      { id },
    );
    return byId.person ?? null;
  }

  private async upsertCompany(domain: string, companyName: string | null, createdAt?: string): Promise<string | null> {
    const result = await this.twentyApi.records<{ createCompanies: { id: string }[] }>(
      `mutation IntakeUpsertCompany($data: [CompanyCreateInput!]!) { createCompanies(data: $data, upsert: true) { id } }`,
      { data: [{ name: companyNameFor(companyName, domain), domainName: { primaryLinkUrl: `https://${domain}`, primaryLinkLabel: '' }, ...(createdAt ? { createdAt } : {}) }] },
    );
    return result.createCompanies[0]?.id ?? null;
  }

  private async ensureTable() {
    if (this.tableReady) return;
    await this.dataSource.query(`
      create table if not exists os.intake_events (
        id bigserial primary key,
        event text not null,
        email text,
        payload jsonb not null,
        outcome text,
        received_at timestamptz not null default now()
      );
      create index if not exists intake_events_email_idx on os.intake_events (lower(email), received_at desc);
    `);
    this.tableReady = true;
  }
}
