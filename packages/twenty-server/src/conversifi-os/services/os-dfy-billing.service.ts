import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { randomBytes, randomUUID } from 'crypto';

import { DataSource } from 'typeorm';

import { OsAirwallexService } from 'src/conversifi-os/services/os-airwallex.service';
import { type MetadataObject, TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

const WORKSPACE_SCHEMA = 'workspace_a1aip8pgko71t0v2lrw9rnizs';
const PERSON_PAGE_INVOICING_TAB = '5a5c0000-0000-4000-8000-00000000d0f1';
const TERM_DAYS = 90;
const SECOND_INSTALMENT_DAYS = 45;
const RENEWAL_OFFER_DAYS_BEFORE_END = 30;
const INVOICE_AHEAD_DAYS = 7;
const OVERDUE_TASK_DAYS = 3;
const OVERDUE_PAUSE_DAYS = 7;

export type DfyPlan = 'PIF' | 'TWO_PAY';
export type DfyEngagementStatus = 'PENDING' | 'LIVE' | 'PAUSED' | 'COMPLETE' | 'RENEWED' | 'CHURNED';
export type DfyInstalmentStatus = 'SCHEDULED' | 'INVOICED' | 'PENDING' | 'PAID' | 'FAILED' | 'OVERDUE' | 'CANCELLED';
export type DfyMethod = 'PUSH' | 'DEBIT';
export type DfyInstalmentKind = 'INSTALMENT' | 'RENEWAL';

const option = (value: string, label: string, color: string) => ({ value, label, color });
const PLAN_OPTIONS = [option('PIF', 'Pay in full', 'green'), option('TWO_PAY', 'Two payments (now + 45 days)', 'blue')];
const ENGAGEMENT_STATUS_OPTIONS = [
  option('PENDING', 'Pending go-live', 'gray'), option('LIVE', 'Live', 'green'), option('PAUSED', 'Paused', 'orange'),
  option('COMPLETE', 'Complete', 'blue'), option('RENEWED', 'Renewed', 'turquoise'), option('CHURNED', 'Churned', 'red'),
];
const INSTALMENT_STATUS_OPTIONS = [
  option('SCHEDULED', 'Scheduled', 'gray'), option('INVOICED', 'Invoiced', 'blue'), option('PENDING', 'Pending (in flight)', 'yellow'),
  option('PAID', 'Paid', 'green'), option('FAILED', 'Failed', 'red'), option('OVERDUE', 'Overdue', 'orange'), option('CANCELLED', 'Cancelled', 'gray'),
];
const METHOD_OPTIONS = [option('PUSH', 'Bank transfer (client sends)', 'blue'), option('DEBIT', 'Direct debit (we collect)', 'purple')];
const KIND_OPTIONS = [option('INSTALMENT', 'Instalment', 'blue'), option('RENEWAL', 'Renewal', 'turquoise')];

type Money = { amountMicros: number | string | null; currencyCode: string | null } | null;
type EngagementRecord = {
  id: string; name: string; package: string | null; paymentPlan: DfyPlan | null; status: DfyEngagementStatus | null;
  price: Money; contractDate: string | null; goLiveDate: string | null; endDate: string | null; pausedAt: string | null;
  volumeTarget: number | null; volumeDelivered: number | null; daysPaused: number | null; keepChasingIfChurned: boolean | null;
  closerEmail: string | null; personId: string | null; renewalOfferSentAt: string | null;
  person?: { id: string; name: { firstName: string | null; lastName: string | null } | null; emails: { primaryEmail: string | null } | null; closerEmail: string | null } | null;
};
type InstalmentRecord = {
  id: string; name: string; number: number | null; kind: DfyInstalmentKind | null; amount: Money; dueDate: string | null;
  method: DfyMethod | null; status: DfyInstalmentStatus | null; invoiceReference: string | null; providerReference: string | null;
  paidAt: string | null; paidAmount: Money; engagementId: string | null; personId: string | null; overdueTaskAt: string | null; paymentInstructions: string | null;
};

export type CreateEngagementInput = {
  personId?: string; personEmail?: string; package: string; priceUsd: number; plan: DfyPlan; contractDate?: string; volumeTarget?: number;
  method?: DfyMethod; closerEmail?: string | null; notes?: string | null;
};
export type MarkPaidInput = { method?: DfyMethod; reference?: string | null; paidAt?: string; amountUsd?: number; source?: 'transfer' | 'airwallex' | 'manual' };

type PersonSummary = { id: string; name: { firstName: string | null; lastName: string | null } | null; closerEmail: string | null };

const usdToMicros = (usd: number) => Math.round(usd * 1_000_000);
const microsToUsd = (money: Money) => (money?.amountMicros ? Number(money.amountMicros) / 1_000_000 : 0);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return isoDate(next);
};
const daysBetween = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
const today = () => isoDate(new Date());

// DFY billing: one engagement per package sold, a schedule of instalments under it. Money has its
// own calendar (from the day they sign), the work has its own (from go-live), and the only place
// they meet is "no payment, no delivery". Paid instalments land in the same ledger as Whop did, so
// commission, Revenue and the Discord card need no new code.
@Injectable()
export class OsDfyBillingService {
  private readonly logger = new Logger(OsDfyBillingService.name);
  private metadataReady = false;
  private fieldIds: Record<string, string> = {};

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
    private readonly airwallex: OsAirwallexService,
  ) {}

  // ---------- metadata ----------

  async ensureMetadata() {
    if (this.metadataReady) return;
    const objects = await this.twentyApi.listObjects();
    const person = objects.find((object) => object.nameSingular === 'person');
    if (!person) throw new Error('person object not found');

    const engagement = await this.ensureObject(objects, {
      nameSingular: 'dfyEngagement', namePlural: 'dfyEngagements', labelSingular: 'DFY engagement', labelPlural: 'DFY engagements',
      icon: 'IconFileText', description: 'A DFY package sold to a client: the 90-day term, its volume and its payment plan',
    });
    await this.twentyApi.ensureFields('dfyEngagement', [
      { name: 'package', label: 'Package', type: 'TEXT', icon: 'IconTag' },
      { name: 'paymentPlan', label: 'Payment plan', type: 'SELECT', icon: 'IconCoins', extra: { options: PLAN_OPTIONS.map((entry, position) => ({ ...entry, id: randomUUID(), position })) } },
      { name: 'status', label: 'Status', type: 'SELECT', icon: 'IconProgressCheck', extra: { options: ENGAGEMENT_STATUS_OPTIONS.map((entry, position) => ({ ...entry, id: randomUUID(), position })) } },
      { name: 'price', label: 'Package price', type: 'CURRENCY', icon: 'IconCurrencyDollar' },
      { name: 'contractDate', label: 'Signed on', type: 'DATE', icon: 'IconCalendarDue' },
      { name: 'goLiveDate', label: 'Live from', type: 'DATE', icon: 'IconRocket' },
      { name: 'endDate', label: 'Term ends', type: 'DATE', icon: 'IconCalendarDue' },
      { name: 'pausedAt', label: 'Paused on', type: 'DATE', icon: 'IconPlayerPause' },
      { name: 'renewalOfferSentAt', label: 'Renewal offer sent', type: 'DATE_TIME', icon: 'IconRepeat' },
      { name: 'volumeTarget', label: 'Outreach volume', type: 'NUMBER', icon: 'IconTargetArrow' },
      { name: 'volumeDelivered', label: 'Outreach delivered', type: 'NUMBER', icon: 'IconProgressCheck' },
      { name: 'daysPaused', label: 'Days paused', type: 'NUMBER', icon: 'IconPlayerPause' },
      { name: 'keepChasingIfChurned', label: 'Keep chasing if churned', type: 'BOOLEAN', icon: 'IconAlertTriangle', extra: { defaultValue: true } },
      { name: 'closerEmail', label: 'Closer email', type: 'TEXT', icon: 'IconMail' },
      { name: 'notes', label: 'Notes', type: 'TEXT', icon: 'IconNotes' },
      { name: 'person', label: 'Client', type: 'RELATION', icon: 'IconUser', extra: { relationCreationPayload: { targetObjectMetadataId: person.id, targetFieldLabel: 'DFY engagements', targetFieldIcon: 'IconFileText', type: 'MANY_TO_ONE' } } },
    ]);

    const refreshedObjects = await this.twentyApi.listObjects();
    const engagementObject = refreshedObjects.find((object) => object.nameSingular === 'dfyEngagement') ?? engagement;
    await this.ensureObject(refreshedObjects, {
      nameSingular: 'dfyInstalment', namePlural: 'dfyInstalments', labelSingular: 'DFY instalment', labelPlural: 'DFY instalments',
      icon: 'IconFileText', description: 'One payment on a DFY engagement: when it is due, how it is collected and whether it landed',
    });
    await this.twentyApi.ensureFields('dfyInstalment', [
      { name: 'number', label: 'Number', type: 'NUMBER', icon: 'IconId' },
      { name: 'kind', label: 'Kind', type: 'SELECT', icon: 'IconTag', extra: { options: KIND_OPTIONS.map((entry, position) => ({ ...entry, id: randomUUID(), position })) } },
      { name: 'amount', label: 'Amount', type: 'CURRENCY', icon: 'IconCurrencyDollar' },
      { name: 'dueDate', label: 'Due', type: 'DATE', icon: 'IconCalendarDue' },
      { name: 'method', label: 'Collection', type: 'SELECT', icon: 'IconCoins', extra: { options: METHOD_OPTIONS.map((entry, position) => ({ ...entry, id: randomUUID(), position })) } },
      { name: 'status', label: 'Status', type: 'SELECT', icon: 'IconProgressCheck', extra: { options: INSTALMENT_STATUS_OPTIONS.map((entry, position) => ({ ...entry, id: randomUUID(), position })) } },
      { name: 'invoiceReference', label: 'Invoice reference', type: 'TEXT', icon: 'IconFileText' },
      { name: 'providerReference', label: 'Payment reference', type: 'TEXT', icon: 'IconId' },
      { name: 'paymentInstructions', label: 'Payment instructions', type: 'TEXT', icon: 'IconFileText' },
      { name: 'paidAt', label: 'Paid at', type: 'DATE_TIME', icon: 'IconCheck' },
      { name: 'paidAmount', label: 'Amount received', type: 'CURRENCY', icon: 'IconCoins' },
      { name: 'overdueTaskAt', label: 'Overdue task raised', type: 'DATE_TIME', icon: 'IconAlertTriangle' },
      { name: 'notes', label: 'Notes', type: 'TEXT', icon: 'IconNotes' },
      { name: 'engagement', label: 'Engagement', type: 'RELATION', icon: 'IconFileText', extra: { relationCreationPayload: { targetObjectMetadataId: engagementObject.id, targetFieldLabel: 'Instalments', targetFieldIcon: 'IconFileText', type: 'MANY_TO_ONE' } } },
      { name: 'person', label: 'Client', type: 'RELATION', icon: 'IconUser', extra: { relationCreationPayload: { targetObjectMetadataId: person.id, targetFieldLabel: 'DFY instalments', targetFieldIcon: 'IconFileText', type: 'MANY_TO_ONE' } } },
    ]);
    await this.twentyApi.ensureSelectOptions('dfyEngagement', 'status', ENGAGEMENT_STATUS_OPTIONS);
    await this.twentyApi.ensureSelectOptions('dfyInstalment', 'status', INSTALMENT_STATUS_OPTIONS);

    const finalObjects = await this.twentyApi.listObjects();
    const personObject = finalObjects.find((object) => object.nameSingular === 'person');
    this.fieldIds = Object.fromEntries((personObject?.fieldsList ?? []).map((field) => [field.name, field.id]));
    await this.ensureInvoicingTab();
    this.metadataReady = true;
  }

  private async ensureObject(objects: MetadataObject[], spec: { nameSingular: string; namePlural: string; labelSingular: string; labelPlural: string; icon: string; description: string }) {
    const existing = objects.find((object) => object.nameSingular === spec.nameSingular);
    if (existing) return existing;
    const created = await this.twentyApi.metadata<{ createOneObject: MetadataObject }>(
      `mutation CreateDfyObject($input: CreateOneObjectInput!) { createOneObject(input: $input) { id nameSingular fieldsList { id name type } } }`,
      { input: { object: { ...spec, isLabelSyncedWithName: false } } },
    );
    this.logger.log(`created ${spec.nameSingular} object ${created.createOneObject.id}`);
    return created.createOneObject;
  }

  // The person page gets an "Invoicing" tab showing the two relation lists; the page layout is core data.
  private async ensureInvoicingTab() {
    const engagementsField = this.fieldIds['dfyEngagements'];
    const instalmentsField = this.fieldIds['dfyInstalments'];
    if (!engagementsField || !instalmentsField) {
      this.logger.warn('invoicing tab skipped: person relation fields not found yet');
      return;
    }
    const layout: { id: string; objectMetadataId: string }[] = await this.dataSource.query(
      `select l.id, l."objectMetadataId" from core."pageLayout" l join core."objectMetadata" o on o.id = l."objectMetadataId"
        where o."nameSingular" = 'person' and o."workspaceId" = (select "workspaceId" from core."pageLayoutTab" where id = 'eb76f23e-e2f9-42a5-9ae0-80f3fcc318ff' limit 1) and l."deletedAt" is null limit 1`,
    );
    if (!layout[0]) return;
    const tab: { id: string }[] = await this.dataSource.query(`select id from core."pageLayoutTab" where id = $1`, [PERSON_PAGE_INVOICING_TAB]);
    if (tab.length) return;
    // Same workspace and application as the Messages tab; every layout row needs both plus a universal id.
    const template: { workspaceId: string; applicationId: string }[] = await this.dataSource.query(`select "workspaceId", "applicationId" from core."pageLayoutTab" where id = 'eb76f23e-e2f9-42a5-9ae0-80f3fcc318ff'`);
    const workspaceId = template[0]?.workspaceId;
    const applicationId = template[0]?.applicationId;
    if (!workspaceId || !applicationId) return;
    await this.dataSource.query(
      `insert into core."pageLayoutTab" (id, title, position, "pageLayoutId", "workspaceId", "universalIdentifier", "applicationId") values ($1, 'Invoicing', 65, $2, $3, $4, $5)`,
      [PERSON_PAGE_INVOICING_TAB, layout[0].id, workspaceId, randomUUID(), applicationId],
    );
    for (const [index, [title, fieldMetadataId]] of [['DFY engagements', engagementsField], ['DFY instalments', instalmentsField]].entries()) {
      await this.dataSource.query(
        `insert into core."pageLayoutWidget" (id, "pageLayoutTabId", title, type, "objectMetadataId", "gridPosition", configuration, "workspaceId", "universalIdentifier", "applicationId")
         values ($1, $2, $3, 'FIELD', $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
        [randomUUID(), PERSON_PAGE_INVOICING_TAB, title, layout[0].objectMetadataId, JSON.stringify({ row: index, column: 0, rowSpan: 1, columnSpan: 12 }), JSON.stringify({ fieldMetadataId, fieldDisplayMode: 'CARD', configurationType: 'FIELD' }), workspaceId, randomUUID(), applicationId],
      );
    }
    this.logger.log('invoicing tab added to the person page');
  }

  // ---------- reads ----------

  private async engagement(id: string): Promise<EngagementRecord> {
    const data = await this.twentyApi.records<{ dfyEngagement: EngagementRecord | null }>(
      `query DfyEngagement($id: UUID) { dfyEngagement(filter: { id: { eq: $id } }) { id name package paymentPlan status price { amountMicros currencyCode } contractDate goLiveDate endDate pausedAt renewalOfferSentAt volumeTarget volumeDelivered daysPaused keepChasingIfChurned closerEmail personId person { id name { firstName lastName } emails { primaryEmail } closerEmail } } }`,
      { id },
    );
    if (!data.dfyEngagement) throw new BadRequestException('engagement not found');
    return data.dfyEngagement;
  }

  private async instalments(engagementId: string): Promise<InstalmentRecord[]> {
    const data = await this.twentyApi.records<{ dfyInstalments: { edges: { node: InstalmentRecord }[] } }>(
      `query DfyInstalments($engagementId: UUID) { dfyInstalments(filter: { engagementId: { eq: $engagementId } }, orderBy: { number: AscNullsLast }, first: 50) { edges { node { id name number kind amount { amountMicros currencyCode } dueDate method status invoiceReference providerReference paidAt paidAmount { amountMicros currencyCode } engagementId personId overdueTaskAt } } } }`,
      { engagementId },
    );
    return data.dfyInstalments.edges.map((edge) => edge.node);
  }

  private async instalment(id: string): Promise<InstalmentRecord> {
    const data = await this.twentyApi.records<{ dfyInstalment: InstalmentRecord | null }>(
      `query DfyInstalment($id: UUID) { dfyInstalment(filter: { id: { eq: $id } }) { id name number kind amount { amountMicros currencyCode } dueDate method status invoiceReference providerReference paidAt paidAmount { amountMicros currencyCode } engagementId personId overdueTaskAt paymentInstructions } }`,
      { id },
    );
    if (!data.dfyInstalment) throw new BadRequestException('instalment not found');
    return data.dfyInstalment;
  }

  // ---------- writes ----------

  async createEngagement(input: CreateEngagementInput) {
    await this.ensureMetadata();
    if (!input.package?.trim() || !(input.priceUsd > 0)) throw new BadRequestException('package and price are required');
    if (!input.personId && !input.personEmail?.trim()) throw new BadRequestException('personId or personEmail is required');
    const personData = input.personId
      ? await this.twentyApi.records<{ person: PersonSummary | null }>(
          `query DfyPerson($id: UUID) { person(filter: { id: { eq: $id } }) { id name { firstName lastName } closerEmail } }`,
          { id: input.personId },
        )
      : await this.personByEmail(input.personEmail!.trim());
    if (!personData.person) throw new BadRequestException(input.personId ? 'person not found' : `no person with the email ${input.personEmail}`);
    input = { ...input, personId: personData.person.id };
    const clientName = `${personData.person.name?.firstName ?? ''} ${personData.person.name?.lastName ?? ''}`.trim() || 'Client';
    const contractDate = input.contractDate ?? today();
    const method: DfyMethod = input.method ?? 'PUSH';
    const created = await this.twentyApi.records<{ createDfyEngagement: { id: string } }>(
      `mutation CreateDfyEngagement($data: DfyEngagementCreateInput!) { createDfyEngagement(data: $data) { id } }`,
      {
        data: {
          name: `${input.package.trim()} · ${clientName}`,
          package: input.package.trim(), paymentPlan: input.plan, status: 'PENDING',
          price: { amountMicros: usdToMicros(input.priceUsd), currencyCode: 'USD' },
          contractDate, volumeTarget: input.volumeTarget ?? null, volumeDelivered: 0, daysPaused: 0, keepChasingIfChurned: true,
          closerEmail: input.closerEmail ?? personData.person.closerEmail ?? null, notes: input.notes ?? null, personId: personData.person.id,
        },
      },
    );
    const engagementId = created.createDfyEngagement.id;
    // Money calendar: instalment 1 on signing; instalment 2 provisionally 45 days later and
    // re-anchored to the day instalment 1 is actually paid.
    const rows = input.plan === 'PIF'
      ? [{ number: 1, amountUsd: input.priceUsd, dueDate: contractDate }]
      : [{ number: 1, amountUsd: input.priceUsd / 2, dueDate: contractDate }, { number: 2, amountUsd: input.priceUsd / 2, dueDate: addDays(contractDate, SECOND_INSTALMENT_DAYS) }];
    for (const row of rows) {
      await this.createInstalment({ engagementId, personId: personData.person.id, number: row.number, total: rows.length, kind: 'INSTALMENT', amountUsd: row.amountUsd, dueDate: row.dueDate, method });
    }
    await this.log(engagementId, `engagement created: ${input.package} ${input.plan} $${input.priceUsd} for ${clientName}`);
    return { engagementId };
  }

  private async personByEmail(email: string): Promise<{ person: PersonSummary | null }> {
    const data = await this.twentyApi.records<{ people: { edges: { node: PersonSummary }[] } }>(
      `query DfyPersonByEmail($email: String) { people(filter: { emails: { primaryEmail: { ilike: $email } } }, first: 1) { edges { node { id name { firstName lastName } closerEmail } } } }`,
      { email },
    );
    return { person: data.people.edges[0]?.node ?? null };
  }

  private async createInstalment(row: { engagementId: string; personId: string; number: number; total: number; kind: DfyInstalmentKind; amountUsd: number; dueDate: string; method: DfyMethod }) {
    const name = row.kind === 'RENEWAL' ? 'Renewal' : `Instalment ${row.number} of ${row.total}`;
    const created = await this.twentyApi.records<{ createDfyInstalment: { id: string } }>(
      `mutation CreateDfyInstalment($data: DfyInstalmentCreateInput!) { createDfyInstalment(data: $data) { id } }`,
      {
        data: {
          name, number: row.number, kind: row.kind, amount: { amountMicros: usdToMicros(row.amountUsd), currencyCode: 'USD' }, dueDate: row.dueDate,
          method: row.method, status: 'SCHEDULED', invoiceReference: this.reference(), engagementId: row.engagementId, personId: row.personId,
        },
      },
    );
    return created.createDfyInstalment.id;
  }

  private reference() {
    return `DFY-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private async updateInstalment(id: string, data: Record<string, unknown>) {
    await this.twentyApi.records(`mutation UpdateDfyInstalment($id: UUID!, $data: DfyInstalmentUpdateInput!) { updateDfyInstalment(id: $id, data: $data) { id } }`, { id, data });
  }

  private async updateEngagement(id: string, data: Record<string, unknown>) {
    await this.twentyApi.records(`mutation UpdateDfyEngagement($id: UUID!, $data: DfyEngagementUpdateInput!) { updateDfyEngagement(id: $id, data: $data) { id } }`, { id, data });
  }

  // Work calendar starts here: 90 days, and the renewal falls due on the last day.
  async setGoLive(engagementId: string, goLiveDate?: string) {
    await this.ensureMetadata();
    const engagement = await this.engagement(engagementId);
    const liveFrom = goLiveDate ?? today();
    const endDate = addDays(liveFrom, TERM_DAYS);
    await this.updateEngagement(engagementId, { status: 'LIVE', goLiveDate: liveFrom, endDate, pausedAt: null });
    const existing = await this.instalments(engagementId);
    if (!existing.some((row) => row.kind === 'RENEWAL')) {
      const price = microsToUsd(engagement.price);
      const renewalAmount = engagement.paymentPlan === 'TWO_PAY' ? price / 2 : price;
      const method = existing[0]?.method ?? 'PUSH';
      await this.createInstalment({ engagementId, personId: engagement.personId ?? '', number: existing.length + 1, total: existing.length + 1, kind: 'RENEWAL', amountUsd: renewalAmount, dueDate: endDate, method });
    }
    await this.log(engagementId, `live from ${liveFrom}, term ends ${endDate}`);
    return { goLiveDate: liveFrom, endDate };
  }

  async pause(engagementId: string, reason?: string) {
    const engagement = await this.engagement(engagementId);
    if (engagement.status !== 'LIVE') throw new BadRequestException('only a live engagement can be paused');
    await this.updateEngagement(engagementId, { status: 'PAUSED', pausedAt: today() });
    await this.log(engagementId, `paused${reason ? `: ${reason}` : ''}`);
    return { pausedAt: today() };
  }

  // Resuming pushes the end date and the renewal out by the days lost, so the client keeps what they paid for.
  async resume(engagementId: string) {
    const engagement = await this.engagement(engagementId);
    if (engagement.status !== 'PAUSED' || !engagement.pausedAt) throw new BadRequestException('engagement is not paused');
    const lost = Math.max(0, daysBetween(engagement.pausedAt, today()));
    const endDate = engagement.endDate ? addDays(engagement.endDate, lost) : null;
    await this.updateEngagement(engagementId, { status: 'LIVE', pausedAt: null, daysPaused: (engagement.daysPaused ?? 0) + lost, ...(endDate ? { endDate } : {}) });
    if (endDate) {
      for (const row of await this.instalments(engagementId)) {
        if (row.kind === 'RENEWAL' && row.status !== 'PAID' && row.status !== 'CANCELLED') await this.updateInstalment(row.id, { dueDate: endDate });
      }
    }
    await this.log(engagementId, `resumed after ${lost} day(s); term now ends ${endDate ?? 'n/a'}`);
    return { daysLost: lost, endDate };
  }

  async invoice(instalmentId: string) {
    const row = await this.instalment(instalmentId);
    if (row.status === 'PAID' || row.status === 'CANCELLED') throw new BadRequestException(`instalment is ${row.status}`);
    const reference = row.invoiceReference ?? this.reference();
    const instructions = await this.transferInstructions(row);
    await this.updateInstalment(instalmentId, {
      status: row.status === 'OVERDUE' ? 'OVERDUE' : 'INVOICED', invoiceReference: reference,
      ...(instructions ? { providerReference: instructions.intentId, paymentInstructions: instructions.text } : {}),
    });
    if (row.engagementId) await this.log(row.engagementId, `${row.name} invoiced (${reference}${instructions?.reference ? `, transfer ref ${instructions.reference}` : ''})`);
    return { reference, transferReference: instructions?.reference ?? null };
  }

  // A push instalment gets its own Airwallex bank-transfer intent: the client pays into the
  // account it names with its reference, and the webhook marks the row paid when it lands.
  private async transferInstructions(row: InstalmentRecord) {
    if (!this.airwallex.isConfigured() || (row.method ?? 'PUSH') !== 'PUSH' || !row.engagementId) return null;
    if (row.providerReference && row.paymentInstructions) return null;
    try {
      const engagement = await this.engagement(row.engagementId);
      const client = engagement.person;
      return await this.airwallex.createBankTransfer({
        instalmentId: row.id, amount: microsToUsd(row.amount), currency: row.amount?.currencyCode ?? 'USD',
        email: client?.emails?.primaryEmail ?? null, name: `${client?.name?.firstName ?? ''} ${client?.name?.lastName ?? ''}`.trim() || null,
        description: `${engagement.package ?? engagement.name} · ${row.name}`,
      });
    } catch (error) {
      // The invoice still goes out with the static bank details; the reference is the fallback.
      this.logger.warn(`airwallex transfer intent failed for ${row.id}: ${(error as Error).message}`);
      return null;
    }
  }

  async cancelInstalment(instalmentId: string, reason?: string) {
    const row = await this.instalment(instalmentId);
    if (row.status === 'PAID') throw new BadRequestException('a paid instalment cannot be cancelled');
    await this.updateInstalment(instalmentId, { status: 'CANCELLED', notes: reason ?? null });
    if (row.engagementId) await this.log(row.engagementId, `${row.name} cancelled${reason ? `: ${reason}` : ''}`);
    return { ok: true };
  }

  // The one write that touches money: marks the row, mirrors it into the ledger so commission and
  // Revenue see it, re-anchors instalment 2 to the real payment day, and pings Discord.
  async markPaid(instalmentId: string, input: MarkPaidInput = {}) {
    await this.ensureMetadata();
    const row = await this.instalment(instalmentId);
    if (row.status === 'PAID') return { ok: true, alreadyPaid: true };
    if (row.status === 'CANCELLED') throw new BadRequestException('instalment was cancelled');
    if (!row.engagementId) throw new BadRequestException('instalment has no engagement');
    const engagement = await this.engagement(row.engagementId);
    const paidAt = input.paidAt ?? new Date().toISOString();
    const amountUsd = input.amountUsd ?? microsToUsd(row.amount);
    const method = input.method ?? row.method ?? 'PUSH';
    const source = input.source ?? (method === 'DEBIT' ? 'airwallex' : 'transfer');
    await this.updateInstalment(instalmentId, {
      status: 'PAID', paidAt, method, providerReference: input.reference ?? row.providerReference ?? null,
      paidAmount: { amountMicros: usdToMicros(amountUsd), currencyCode: 'USD' },
    });

    const client = engagement.person;
    const clientName = `${client?.name?.firstName ?? ''} ${client?.name?.lastName ?? ''}`.trim();
    await this.dataSource.query(
      `insert into os.stripe_payments (id, customer_id, amount_cents, amount_refunded_cents, currency, created, status, paid, refunded, email, payer_name, description, synced_at, source)
       values ($1, $2, $3, 0, 'usd', $4, 'succeeded', true, false, $5, $6, $7, now(), $8)
       on conflict (id) do update set amount_cents = excluded.amount_cents, created = excluded.created, email = excluded.email, payer_name = excluded.payer_name, description = excluded.description, synced_at = now(), source = excluded.source`,
      [`dfy:${instalmentId}`, `dfy:${engagement.personId}`, Math.round(amountUsd * 100), paidAt, client?.emails?.primaryEmail?.toLowerCase() ?? null, clientName || null, `DFY: ${engagement.package ?? engagement.name} · ${row.name}`, source],
    );
    await this.dataSource.query('select os.refresh_sales_ledger()').catch((error) => this.logger.warn(`ledger refresh failed: ${(error as Error).message}`));

    if (row.kind === 'INSTALMENT' && row.number === 1 && engagement.paymentPlan === 'TWO_PAY') {
      const second = (await this.instalments(row.engagementId)).find((candidate) => candidate.kind === 'INSTALMENT' && candidate.number === 2 && candidate.status === 'SCHEDULED');
      if (second) await this.updateInstalment(second.id, { dueDate: addDays(paidAt.slice(0, 10), SECOND_INSTALMENT_DAYS) });
    }
    if (row.kind === 'RENEWAL') await this.updateEngagement(row.engagementId, { status: 'RENEWED' });
    if (engagement.status === 'PAUSED') await this.resume(row.engagementId).catch(() => undefined);

    await this.log(row.engagementId, `${row.name} paid $${amountUsd} by ${method.toLowerCase()}${input.reference ? ` (${input.reference})` : ''}`);
    await this.discord(`💸 DFY payment received`, [
      `**Client**: ${clientName || 'Unknown'}`, `**Package**: ${engagement.package ?? engagement.name}`, `**Payment**: ${row.name} · $${amountUsd.toLocaleString()}`,
      `**How**: ${method === 'DEBIT' ? 'direct debit' : 'bank transfer'}`, `**Closer**: ${engagement.closerEmail ?? client?.closerEmail ?? 'unassigned'}`,
    ].join('\n'), 0x2ecc71);
    return { ok: true, amountUsd, paidAt };
  }

  // Daily: overdue marking, invoices a week ahead, renewal offers a month before the end, and
  // automatic pauses. Tasks and emails are raised by the native workflows watching these fields.
  async tick() {
    await this.ensureMetadata();
    const now = today();
    const due: { id: string; status: string; dueDate: string; engagementId: string | null; overdueTaskAt: string | null }[] = await this.dataSource.query(
      `select id, status::text, "dueDate"::text, "engagementId", "overdueTaskAt" from ${WORKSPACE_SCHEMA}."_dfyInstalment" where "deletedAt" is null and status::text in ('SCHEDULED','INVOICED','PENDING','OVERDUE')`,
    );
    let invoiced = 0; let overdue = 0; let paused = 0; let offers = 0;
    for (const row of due) {
      if (row.status === 'SCHEDULED' && row.dueDate <= addDays(now, INVOICE_AHEAD_DAYS)) { await this.invoice(row.id).catch((error) => this.logger.warn(`auto-invoice ${row.id} failed: ${(error as Error).message}`)); invoiced++; continue; }
      if ((row.status === 'INVOICED' || row.status === 'PENDING') && row.dueDate < now) { await this.updateInstalment(row.id, { status: 'OVERDUE' }); overdue++; continue; }
      if (row.status === 'OVERDUE' && row.engagementId) {
        const daysLate = daysBetween(row.dueDate, now);
        if (daysLate >= OVERDUE_TASK_DAYS && !row.overdueTaskAt) await this.updateInstalment(row.id, { overdueTaskAt: new Date().toISOString() });
        if (daysLate >= OVERDUE_PAUSE_DAYS) {
          const engagement = await this.engagement(row.engagementId);
          if (engagement.status === 'LIVE') { await this.pause(row.engagementId, `instalment ${daysLate} days overdue`); paused++; }
        }
      }
    }
    const live: { id: string; endDate: string | null; renewalOfferSentAt: string | null }[] = await this.dataSource.query(
      `select id, "endDate"::text, "renewalOfferSentAt" from ${WORKSPACE_SCHEMA}."_dfyEngagement" where "deletedAt" is null and status::text = 'LIVE'`,
    );
    for (const engagement of live) {
      if (!engagement.endDate) continue;
      if (!engagement.renewalOfferSentAt && daysBetween(now, engagement.endDate) <= RENEWAL_OFFER_DAYS_BEFORE_END) { await this.updateEngagement(engagement.id, { renewalOfferSentAt: new Date().toISOString() }); offers++; }
      if (engagement.endDate < now) await this.updateEngagement(engagement.id, { status: 'COMPLETE' });
    }
    return { invoiced, overdue, paused, offers };
  }

  private async log(engagementId: string, line: string) {
    this.logger.log(`dfy ${engagementId}: ${line}`);
  }

  private async discord(title: string, description: string, color: number) {
    const hook = env('OS_DFY_DISCORD_WEBHOOK') ?? env('OS_WHOP_DISCORD_WEBHOOK');
    if (!hook) return;
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'DFY billing', embeds: [{ title, description, color }] }) });
    } catch (error) {
      this.logger.warn(`dfy discord failed: ${(error as Error).message}`);
    }
  }
}
