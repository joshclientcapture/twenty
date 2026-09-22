import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { createHmac, timingSafeEqual } from 'crypto';

import { DataSource } from 'typeorm';

import {
  CHASE_AFTER_MS,
  LADDER_DELAYS_MS,
  ROUTE_BY_SOURCE,
  SMS_ROUTES,
  type SmsRoute,
  systemPromptFor,
  TYPO_AFTER_MS,
} from 'src/conversifi-os/constants/os-sms-routes.constant';
import { userPromptFor } from 'src/conversifi-os/constants/os-sms-prompts.constant';
import { selectOptions, TwentyApiService } from 'src/conversifi-os/services/twenty-api.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';
const CANDIDATE_WINDOW_MS = 45 * 60 * 1000;
const RECHASE_COOLDOWN_DAYS = 30;
const REPLY_DELAY_MIN_MS = 30 * 1000;
const REPLY_DELAY_MAX_MS = 75 * 1000;
const AI_LOCK_MS = 3 * 60 * 1000;
const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt out|optout)\b/i;
// Sender by the lead's country, same split the n8n flow used: UK and EU get the UK number.
const UK_SENDER_PREFIXES = ['+44', '+33', '+49', '+34', '+39', '+31', '+32', '+46', '+47', '+45', '+358', '+353'];
const STAGES_NOT_TO_CHASE = new Set(['PAYING', 'DFY_CLIENT', 'TRIAL', 'NOT_INTERESTED', 'CHURNED']);

const SMS_STATUS_OPTIONS = [
  { value: 'CHASING', label: 'Chasing', color: 'blue' },
  { value: 'REPLIED', label: 'Replied', color: 'orange' },
  { value: 'HANDED_OFF', label: 'Handed off', color: 'red' },
  { value: 'BOOKED', label: 'Booked', color: 'green' },
  { value: 'STOPPED', label: 'Stopped', color: 'gray' },
  { value: 'OPTED_OUT', label: 'Opted out', color: 'gray' },
];

type PersonNode = {
  id: string;
  name: { firstName: string | null; lastName: string | null } | null;
  emails: { primaryEmail: string | null } | null;
  phones: { primaryPhoneNumber: string | null; primaryPhoneCallingCode: string | null } | null;
  latestSource: string | null;
  latestFormAt: string | null;
  stage: string | null;
  nextBookingAt: string | null;
  lastBookingAt: string | null;
  notInterested: boolean | null;
  smsOptOut: boolean | null;
};

type ThreadRow = {
  id: string;
  person_id: string;
  phone: string;
  route: SmsRoute;
  first_name: string | null;
  full_name: string | null;
  status: string;
  form_at: string | null;
  opener_at: string | null;
  ladder_step: number;
  from_number: string | null;
};

type GeminiVerdict = { message: string; needsHumanIntervention: boolean; reason: string; interestLevel: string };

const PERSON_FIELDS = 'id name { firstName lastName } emails { primaryEmail } phones { primaryPhoneNumber primaryPhoneCallingCode } latestSource latestFormAt stage nextBookingAt lastBookingAt notInterested smsOptOut';

export const toE164 = (number: string | null | undefined, callingCode: string | null | undefined): string | null => {
  const raw = (number ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('+')) return '+' + raw.slice(1).replace(/\D/g, '');
  const code = (callingCode ?? '').replace(/\D/g, '');
  const national = raw.replace(/\D/g, '').replace(/^0+/, '');
  if (!code || !national) return null;
  return `+${code}${national}`;
};

const firstNameOf = (person: PersonNode) => (person.name?.firstName ?? '').trim() || 'there';
const fullNameOf = (person: PersonNode) => `${person.name?.firstName ?? ''} ${person.name?.lastName ?? ''}`.trim() || person.emails?.primaryEmail || 'Unknown';

// Melanie's 15-minute SMS chase and reply bot for form leads who did not book. Twilio carries the
// texts, Gemini writes the replies, the person in the CRM carries the outcome, and a closer gets a
// task and a Discord card the moment the bot needs a human.
@Injectable()
export class OsSmsService {
  private readonly logger = new Logger(OsSmsService.name);
  private fieldsReady = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  isDryRun() {
    return env('OS_SMS_DRY_RUN') === 'true' || !env('OS_TWILIO_ACCOUNT_SID') || !env('OS_TWILIO_AUTH_TOKEN');
  }

  // Runs every minute from the cron: queue new form leads, send due openers and ladder steps,
  // answer replies, and notice bookings.
  async tick() {
    if (!this.twentyApi.isConfigured()) return { skipped: 'no OS_TWENTY_API_KEY' };
    if (env('OS_SMS_ENABLED') !== 'true') return { skipped: 'OS_SMS_ENABLED is not true' };
    await this.ensureFields();
    const queued = await this.queueCandidates();
    const booked = await this.noticeBookings();
    const openers = await this.sendDueOpeners();
    const ladder = await this.runLadder();
    const replies = await this.answerReplies();
    return { queued, booked, openers, ladder, replies, dryRun: this.isDryRun() };
  }

  async ensureFields() {
    if (this.fieldsReady) return;
    await this.twentyApi.ensureFields('person', [
      { name: 'smsOptOut', label: 'SMS opt-out', type: 'BOOLEAN', icon: 'IconMessageOff' },
      { name: 'smsStatus', label: 'SMS status', type: 'SELECT', icon: 'IconMessage', extra: { options: selectOptions(SMS_STATUS_OPTIONS) } },
    ]);
    this.fieldsReady = true;
  }

  // ---- queueing --------------------------------------------------------------------------------

  private async queueCandidates() {
    const since = new Date(Date.now() - CANDIDATE_WINDOW_MS).toISOString();
    const data = await this.twentyApi.records<{ people: { edges: { node: PersonNode }[] } }>(
      `query SmsCandidates($since: DateTime) { people(first: 200, filter: { latestFormAt: { gte: $since } }) { edges { node { ${PERSON_FIELDS} } } } }`,
      { since },
    );
    let queued = 0;
    for (const { node: person } of data.people.edges) {
      const route = ROUTE_BY_SOURCE[person.latestSource ?? ''];
      const phone = toE164(person.phones?.primaryPhoneNumber, person.phones?.primaryPhoneCallingCode);
      if (!route || !phone || !person.latestFormAt) continue;
      if (person.smsOptOut || person.notInterested || STAGES_NOT_TO_CHASE.has(person.stage ?? '')) continue;
      const email = person.emails?.primaryEmail ?? null;
      const suppressed: { s: boolean }[] = await this.dataSource.query('select os.is_suppressed($1, $2) as s', [email, fullNameOf(person)]);
      if (suppressed[0]?.s) continue;
      if (email && /@(conversifi\.io|clientcapture\.io)$/i.test(email)) continue;
      const existing: { status: string; created_at: string }[] = await this.dataSource.query(
        `select status, created_at from os.sms_threads where person_id = $1 and (status in ('queued','opener_sent','replied','handed_off','opted_out') or created_at > now() - interval '${RECHASE_COOLDOWN_DAYS} days') order by created_at desc limit 1`,
        [person.id],
      );
      if (existing.length) continue;
      await this.dataSource.query(
        `insert into os.sms_threads (person_id, phone, route, first_name, full_name, email, status, form_at, due_at)
         values ($1, $2, $3, $4, $5, $6, 'queued', $7, $8)`,
        [person.id, phone, route, firstNameOf(person), fullNameOf(person), email, person.latestFormAt, new Date(new Date(person.latestFormAt).getTime() + CHASE_AFTER_MS).toISOString()],
      );
      queued++;
    }
    return queued;
  }

  // ---- bookings and stops --------------------------------------------------------------------------

  private async peopleByIds(ids: string[]): Promise<Map<string, PersonNode>> {
    if (ids.length === 0) return new Map();
    const data = await this.twentyApi.records<{ people: { edges: { node: PersonNode }[] } }>(
      `query SmsPeople($ids: [UUID!]) { people(first: 200, filter: { id: { in: $ids } }) { edges { node { ${PERSON_FIELDS} } } } }`,
      { ids },
    );
    return new Map(data.people.edges.map(({ node }) => [node.id, node]));
  }

  private bookedSince(person: PersonNode, formAt: string | null) {
    if (person.nextBookingAt) return true;
    return !!(person.lastBookingAt && formAt && person.lastBookingAt >= formAt);
  }

  private async noticeBookings() {
    const live: ThreadRow[] = await this.dataSource.query(`select * from os.sms_threads where status in ('queued','opener_sent','replied','handed_off')`);
    if (live.length === 0) return 0;
    const people = await this.peopleByIds([...new Set(live.map((thread) => thread.person_id))]);
    let booked = 0;
    for (const thread of live) {
      const person = people.get(thread.person_id);
      if (!person) continue;
      if (person.smsOptOut) {
        await this.close(thread, 'opted_out', 'person opted out');
        continue;
      }
      if (this.bookedSince(person, thread.form_at)) {
        await this.close(thread, 'booked', 'booked a call');
        await this.setPersonSms(thread.person_id, 'BOOKED');
        booked++;
      } else if (STAGES_NOT_TO_CHASE.has(person.stage ?? '') && thread.status !== 'handed_off') {
        await this.close(thread, 'stopped', `stage ${person.stage}`);
        await this.setPersonSms(thread.person_id, 'STOPPED');
      }
    }
    return booked;
  }

  private async close(thread: ThreadRow, status: string, reason: string) {
    await this.dataSource.query(`update os.sms_threads set status = $2, stop_reason = $3, ladder_due_at = null, ai_due_at = null, updated_at = now() where id = $1`, [thread.id, status, reason]);
  }

  private async setPersonSms(personId: string, smsStatus: string, extra: Record<string, unknown> = {}) {
    try {
      await this.twentyApi.records(`mutation SmsPerson($id: UUID!, $data: PersonUpdateInput!) { updatePerson(id: $id, data: $data) { id } }`, { id: personId, data: { smsStatus, ...extra } });
    } catch (error) {
      this.logger.warn(`sms: could not update person ${personId}: ${(error as Error).message}`);
    }
  }

  // ---- openers and ladder -------------------------------------------------------------------------

  private async sendDueOpeners() {
    const due: ThreadRow[] = await this.dataSource.query(`select * from os.sms_threads where status = 'queued' and due_at <= now() order by due_at limit 50`);
    let sent = 0;
    for (const thread of due) {
      const config = SMS_ROUTES[thread.route];
      const from = this.senderFor(thread.phone);
      const firstName = thread.first_name || 'there';
      const ok = await this.send(thread, from, config.opener(firstName), 'opener');
      if (!ok) continue;
      await this.dataSource.query(
        `update os.sms_threads set status = 'opener_sent', opener_at = now(), from_number = $2, ladder_step = 0, ladder_due_at = now() + ($3 || ' milliseconds')::interval, updated_at = now() where id = $1`,
        [thread.id, from, String(LADDER_DELAYS_MS[0])],
      );
      await this.setPersonSms(thread.person_id, 'CHASING');
      setTimeout(() => {
        this.send(thread, from, config.typoFix, 'typo').catch((error) => this.logger.warn(`sms typo fix failed: ${(error as Error).message}`));
      }, TYPO_AFTER_MS);
      sent++;
    }
    return sent;
  }

  private async runLadder() {
    const due: ThreadRow[] = await this.dataSource.query(`select * from os.sms_threads where status = 'opener_sent' and ladder_due_at <= now() and last_inbound_at is null order by ladder_due_at limit 50`);
    let sent = 0;
    for (const thread of due) {
      const config = SMS_ROUTES[thread.route];
      const step = thread.ladder_step;
      if (step >= config.ladder.length) {
        await this.close(thread, 'stopped', 'no reply after the ladder');
        await this.setPersonSms(thread.person_id, 'STOPPED');
        continue;
      }
      const ok = await this.send(thread, thread.from_number ?? this.senderFor(thread.phone), config.ladder[step](thread.first_name || 'there'), 'ladder');
      if (!ok) continue;
      const next = LADDER_DELAYS_MS[step + 1];
      await this.dataSource.query(
        `update os.sms_threads set ladder_step = $2, ladder_due_at = case when $3::text is null then now() else now() + ($3 || ' milliseconds')::interval end, updated_at = now() where id = $1`,
        [thread.id, step + 1, next === undefined ? null : String(next)],
      );
      sent++;
    }
    return sent;
  }

  // ---- inbound ---------------------------------------------------------------------------------

  async inbound(from: string, to: string, body: string, sid: string | null, payload: Record<string, unknown>) {
    const phone = toE164(from, null);
    const threads: ThreadRow[] = phone
      ? await this.dataSource.query(`select * from os.sms_threads where phone = $1 and status <> 'queued' order by created_at desc limit 1`, [phone])
      : [];
    const thread = threads[0];
    if (!thread) {
      await this.dataSource.query(`insert into os.sms_inbound_unmatched (from_number, to_number, body, provider_sid, payload) values ($1, $2, $3, $4, $5::jsonb)`, [from, to, body, sid, JSON.stringify(payload)]);
      await this.discord('📩 SMS from an unknown number', `${from}: ${body.slice(0, 300)}`, 0x95a5a6);
      return { matched: false };
    }
    await this.dataSource.query(`insert into os.sms_messages (thread_id, direction, kind, body, provider_sid) values ($1, 'in', 'inbound', $2, $3) on conflict (provider_sid) where provider_sid is not null do nothing`, [thread.id, body, sid]);
    if (STOP_WORDS.test(body)) {
      await this.close(thread, 'opted_out', 'replied STOP');
      await this.setPersonSms(thread.person_id, 'OPTED_OUT', { smsOptOut: true });
      return { matched: true, optedOut: true };
    }
    if (thread.status === 'opted_out') return { matched: true, optedOut: true };
    if (thread.status === 'handed_off') {
      await this.dataSource.query(`update os.sms_threads set last_inbound_at = now(), updated_at = now() where id = $1`, [thread.id]);
      await this.discord(`💬 ${thread.full_name ?? from} replied on a handed-off thread`, body.slice(0, 500), 0xe67e22);
      return { matched: true, handedOff: true };
    }
    const delay = REPLY_DELAY_MIN_MS + Math.floor(Math.random() * (REPLY_DELAY_MAX_MS - REPLY_DELAY_MIN_MS));
    await this.dataSource.query(
      `update os.sms_threads set status = case when status in ('booked','stopped') then status else 'replied' end, last_inbound_at = now(), ladder_due_at = null, ai_due_at = now() + ($2 || ' milliseconds')::interval, updated_at = now() where id = $1`,
      [thread.id, String(delay)],
    );
    if (thread.status !== 'booked' && thread.status !== 'stopped') await this.setPersonSms(thread.person_id, 'REPLIED');
    return { matched: true };
  }

  private async answerReplies() {
    // TypeORM hands back [rows, count] for an UPDATE ... RETURNING, unlike a plain SELECT.
    const locked: [ThreadRow[], number] = await this.dataSource.query(
      `update os.sms_threads set ai_busy_until = now() + ($1 || ' milliseconds')::interval where id in (
         select id from os.sms_threads where ai_due_at is not null and ai_due_at <= now() and (ai_busy_until is null or ai_busy_until < now()) and status in ('replied','opener_sent','booked','stopped') order by ai_due_at limit 20
       ) returning *`,
      [String(AI_LOCK_MS)],
    );
    const due = Array.isArray(locked[0]) ? locked[0] : (locked as unknown as ThreadRow[]);
    let answered = 0;
    for (const thread of due) {
      try {
        const verdict = await this.askGemini(thread);
        if (verdict.message.trim()) await this.send(thread, thread.from_number ?? this.senderFor(thread.phone), verdict.message.trim(), 'ai', true);
        await this.dataSource.query(`update os.sms_threads set interest = $2, ai_due_at = null, ai_busy_until = null, updated_at = now() where id = $1`, [thread.id, verdict.interestLevel]);
        if (verdict.needsHumanIntervention) await this.handOff(thread, verdict.reason || 'the bot asked for a human');
        answered++;
      } catch (error) {
        this.logger.error(`sms reply failed for thread ${thread.id}: ${(error as Error).message}`);
        await this.dataSource.query(`update os.sms_threads set ai_due_at = null, ai_busy_until = null, updated_at = now() where id = $1`, [thread.id]);
        await this.handOff(thread, `reply failed: ${(error as Error).message.slice(0, 200)}`);
      }
    }
    return answered;
  }

  private async transcript(threadId: string): Promise<string> {
    const rows: { direction: string; body: string; at: string }[] = await this.dataSource.query(`select direction, body, at from os.sms_messages where thread_id = $1 order by at`, [threadId]);
    return rows
      .map((row) => `[${new Date(row.at).toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}] ${row.direction === 'out' ? 'Agent' : 'Contact'}: ${row.body}`)
      .join('\n\n');
  }

  private async askGemini(thread: ThreadRow): Promise<GeminiVerdict> {
    const key = env('OS_GEMINI_API_KEY');
    if (!key) throw new Error('OS_GEMINI_API_KEY missing');
    const model = env('OS_GEMINI_MODEL') ?? GEMINI_MODEL_DEFAULT;
    const body = {
      contents: [{ parts: [{ text: userPromptFor(thread.full_name ?? 'Unknown', await this.transcript(thread.id), SMS_ROUTES[thread.route].who) }] }],
      systemInstruction: { parts: [{ text: systemPromptFor(thread.route) }] },
      generationConfig: { temperature: 1, maxOutputTokens: 8000, topP: 0.95, thinkingConfig: { thinkingLevel: 'low' } },
    };
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`gemini ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    let text = parts.find((part) => part.text && !part.thought)?.text ?? parts[parts.length - 1]?.text ?? '';
    text = text.trim().replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '');
    try {
      const parsed = JSON.parse(text) as Partial<GeminiVerdict>;
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        needsHumanIntervention: !!parsed.needsHumanIntervention,
        reason: parsed.reason ?? '',
        interestLevel: parsed.interestLevel ?? 'neutral',
      };
    } catch (error) {
      return { message: '', needsHumanIntervention: true, reason: `could not parse the reply: ${(error as Error).message}; raw: ${text.slice(0, 200)}`, interestLevel: 'neutral' };
    }
  }

  private async handOff(thread: ThreadRow, reason: string) {
    await this.dataSource.query(`update os.sms_threads set status = 'handed_off', handoff_reason = $2, ladder_due_at = null, ai_due_at = null, updated_at = now() where id = $1`, [thread.id, reason]);
    await this.setPersonSms(thread.person_id, 'HANDED_OFF');
    const transcript = await this.transcript(thread.id);
    await this.discord(`🙋 SMS handoff: ${thread.full_name ?? thread.phone} (${thread.route.toUpperCase()})`, `**Why:** ${reason}\n\n${transcript.slice(-1500)}`, 0xe74c3c);
    try {
      const created = await this.twentyApi.records<{ createTask: { id: string } }>(
        `mutation SmsTask($data: TaskCreateInput!) { createTask(data: $data) { id } }`,
        { data: { title: `SMS handoff: ${thread.full_name ?? thread.phone}`, status: 'TODO', bodyV2: { markdown: `Melanie's SMS bot needs a human on the ${thread.route.toUpperCase()} thread with ${thread.phone}.\n\n**Why:** ${reason}\n\n---\n\n${transcript}` } } },
      );
      await this.twentyApi.records(`mutation SmsTaskTarget($data: TaskTargetCreateInput!) { createTaskTarget(data: $data) { id } }`, { data: { taskId: created.createTask.id, targetPersonId: thread.person_id } });
    } catch (error) {
      this.logger.warn(`sms: could not create the handoff task: ${(error as Error).message}`);
    }
  }

  // ---- sending ---------------------------------------------------------------------------------

  senderFor(phone: string) {
    const uk = env('OS_TWILIO_FROM_UK');
    const us = env('OS_TWILIO_FROM_US');
    if (uk && UK_SENDER_PREFIXES.some((prefix) => phone.startsWith(prefix))) return uk;
    return us ?? uk ?? '';
  }

  private async send(thread: ThreadRow, from: string, body: string, kind: string, byAi = false): Promise<boolean> {
    if (this.isDryRun()) {
      this.logger.log(`sms DRY RUN ${kind} to ${thread.phone} from ${from || '(no sender)'}: ${body.replace(/\n/g, ' / ')}`);
      await this.dataSource.query(`insert into os.sms_messages (thread_id, direction, kind, body, by_ai, provider_sid, provider_status) values ($1, 'out', $2, $3, $4, $5, 'dry-run')`, [thread.id, kind, body, byAi, `dry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`]);
      await this.dataSource.query(`update os.sms_threads set last_outbound_at = now(), updated_at = now() where id = $1`, [thread.id]);
      return true;
    }
    const sid = env('OS_TWILIO_ACCOUNT_SID')!;
    const token = env('OS_TWILIO_AUTH_TOKEN')!;
    if (!from) {
      this.logger.error('sms: no sender number configured (OS_TWILIO_FROM_US / OS_TWILIO_FROM_UK)');
      return false;
    }
    const form = new URLSearchParams({ To: thread.phone, From: from, Body: body });
    const statusToken = env('OS_TWILIO_WEBHOOK_TOKEN');
    if (statusToken && env('SERVER_URL')) form.set('StatusCallback', `${env('SERVER_URL')}/os/sms/status/${statusToken}`);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const data = (await response.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
    if (!response.ok) {
      this.logger.error(`sms: twilio ${response.status} sending ${kind} to ${thread.phone}: ${data.message ?? ''}`);
      return false;
    }
    await this.dataSource.query(`insert into os.sms_messages (thread_id, direction, kind, body, by_ai, provider_sid, provider_status) values ($1, 'out', $2, $3, $4, $5, $6)`, [thread.id, kind, body, byAi, data.sid ?? null, data.status ?? null]);
    await this.dataSource.query(`update os.sms_threads set last_outbound_at = now(), updated_at = now() where id = $1`, [thread.id]);
    return true;
  }

  async recordStatus(sid: string, status: string) {
    await this.dataSource.query(`update os.sms_messages set provider_status = $2 where provider_sid = $1`, [sid, status]);
  }

  // Twilio signs every webhook: base64(HMAC-SHA1(auth token, url + sorted POST params concatenated)).
  signatureIsValid(url: string, params: Record<string, string>, signature: string | undefined): boolean {
    const token = env('OS_TWILIO_AUTH_TOKEN');
    if (!token) return this.isDryRun();
    if (!signature) return false;
    const data = url + Object.keys(params).sort().map((key) => key + params[key]).join('');
    const expected = createHmac('sha1', token).update(data).digest('base64');
    return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  private async discord(title: string, description: string, color: number) {
    const hook = env('OS_SMS_DISCORD_WEBHOOK') ?? env('OS_HEALTH_DISCORD_WEBHOOK');
    if (!hook) return;
    try {
      await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Melanie SMS', embeds: [{ title: title.slice(0, 250), description: description.slice(0, 1900), color }] }) });
    } catch (error) {
      this.logger.warn(`sms discord failed: ${(error as Error).message}`);
    }
  }

  // ---- reads for the OS pages ------------------------------------------------------------------------

  async threads(limit = 100) {
    return this.dataSource.query(
      `select t.*, (select count(*) from os.sms_messages m where m.thread_id = t.id) as messages from os.sms_threads t order by t.updated_at desc limit $1`,
      [limit],
    );
  }

  async messages(threadId: string) {
    return this.dataSource.query(`select * from os.sms_messages where thread_id = $1 order by at`, [threadId]);
  }
}
