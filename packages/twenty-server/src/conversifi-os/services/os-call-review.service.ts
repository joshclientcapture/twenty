import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import { DataSource } from 'typeorm';

import {
  CALL_OUTCOME_OPTIONS,
  CALL_REVIEW_PROMPTS,
  CALL_SUMMARY_PROMPT,
  CALL_SUMMARY_SYSTEM_PROMPT,
  type CallType,
  SUMMARY_DELIMITER,
} from 'src/conversifi-os/constants/os-call-review-prompts.constant';
import {
  type MetadataObject,
  TwentyApiService,
} from 'src/conversifi-os/services/twenty-api.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

const FATHOM_API = 'https://api.fathom.ai/external/v1';
const GEMINI_MODEL_DEFAULT = 'gemini-3-flash-preview';
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;
const BOOKING_MATCH_MINUTES = 30;
const DFY_BOOKING_TYPES = new Set(['DISCOVERY']);
const PERSON_PAGE_CALLS_TAB = '5a5c0000-0000-4000-8000-00000000d0f3';
const MIN_TRANSCRIPT_CHARS = 200;

type FathomInvitee = {
  email?: string | null;
  name?: string | null;
  is_external?: boolean | null;
};
type FathomTranscriptItem = {
  speaker?: {
    display_name?: string | null;
    matched_calendar_invitee_email?: string | null;
  } | null;
  text?: string | null;
  timestamp?: string | null;
};
export type FathomMeeting = {
  recording_id?: number | string | null;
  title?: string | null;
  meeting_title?: string | null;
  url?: string | null;
  share_url?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  recording_start_time?: string | null;
  recording_end_time?: string | null;
  created_at?: string | null;
  recorded_by?: { email?: string | null; name?: string | null } | null;
  calendar_invitees?: FathomInvitee[] | null;
  transcript?: FathomTranscriptItem[] | string | null;
  default_summary?:
    | { markdown_formatted?: string | null; text?: string | null }
    | string
    | null;
  action_items?:
    | {
        text?: string | null;
        description?: string | null;
        assignee?: { name?: string | null; email?: string | null } | null;
      }[]
    | null;
};

type CloserRow = {
  id: string;
  name: string;
  login_email: string | null;
  fathom_email: string | null;
  calendly_host_email: string | null;
  discord_webhook: string | null;
  score_calls: boolean;
};
type MatchedBooking = {
  id: string;
  bookingType: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  personId: string | null;
};
type ReviewSummary = {
  overall_score?: number | null;
  outcome?: string | null;
  headline?: string | null;
  sections?:
    | { name?: string; score?: number | null; verdict?: string | null }[]
    | null;
  deductions?: { breach?: string; points?: number }[] | null;
  three_things?: string[] | null;
  confidence?: string | null;
};
type Review = { report: string; summary: ReviewSummary };

const option = (value: string, label: string, color: string) => ({
  value,
  label,
  color,
});
const CALL_TYPE_OPTIONS = [
  option('SOFTWARE', 'Software / agency', 'blue'),
  option('DFY', 'DFY', 'purple'),
];
const STATUS_OPTIONS = [
  option('PENDING', 'Pending', 'gray'),
  option('SCORED', 'Scored', 'green'),
  option('SUMMARISED', 'Summary only', 'blue'),
  option('FAILED', 'Failed', 'red'),
  option('SKIPPED', 'Skipped', 'gray'),
];
const OUTCOME_VALUES = new Set(
  CALL_OUTCOME_OPTIONS.map((entry) => entry.value),
);

// Fathom call recordings into the CRM: every sales call gets a review record on the person (the Head
// of Sales report, score, outcome, scorecard) and a meeting summary note on the timeline. Replaces the n8n "Sales Call Analysis" + "Fathom → GHL Contact Notes" flows.
@Injectable()
export class OsCallReviewService {
  private readonly logger = new Logger(OsCallReviewService.name);
  private metadataReady = false;
  private tablesReady = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly twentyApi: TwentyApiService,
  ) {}

  // ---------- setup ----------

  private async ensureTables() {
    if (this.tablesReady) return;
    await this.dataSource.query(
      `create table if not exists os.app_settings (key text primary key, value text not null, updated_at timestamptz default now())`,
    );
    await this.dataSource.query(
      `create table if not exists os.fathom_events (id text primary key, name text, received_at timestamptz default now(), recording_id text, payload jsonb)`,
    );
    await this.dataSource.query(
      `alter table os.closers add column if not exists score_calls boolean not null default true`,
    );
    this.tablesReady = true;
  }

  async ensureMetadata() {
    if (this.metadataReady) return;
    await this.ensureTables();
    const objects = await this.twentyApi.listObjects();
    const person = objects.find((object) => object.nameSingular === 'person');
    if (!person) throw new Error('person object not found');
    if (!objects.some((object) => object.nameSingular === 'callReview')) {
      const created = await this.twentyApi.metadata<{
        createOneObject: MetadataObject;
      }>(
        `mutation CreateCallReviewObject($input: CreateOneObjectInput!) { createOneObject(input: $input) { id nameSingular fieldsList { id name type } } }`,
        {
          input: {
            object: {
              nameSingular: 'callReview',
              namePlural: 'callReviews',
              labelSingular: 'Call review',
              labelPlural: 'Call reviews',
              icon: 'IconPhone',
              description:
                'A recorded sales call: Fathom recording, Head of Sales review, score and summary',
              isLabelSyncedWithName: false,
            },
          },
        },
      );
      this.logger.log(
        `created callReview object ${created.createOneObject.id}`,
      );
    }
    await this.twentyApi.ensureFields('callReview', [
      {
        name: 'fathomRecordingId',
        label: 'Fathom recording id',
        type: 'TEXT',
        icon: 'IconId',
      },
      {
        name: 'callDate',
        label: 'Call date',
        type: 'DATE',
        icon: 'IconCalendarDue',
      },
      {
        name: 'startedAt',
        label: 'Started at',
        type: 'DATE_TIME',
        icon: 'IconCalendarClock',
      },
      {
        name: 'durationMinutes',
        label: 'Duration (min)',
        type: 'NUMBER',
        icon: 'IconClockPause',
      },
      {
        name: 'closerEmail',
        label: 'Closer email',
        type: 'TEXT',
        icon: 'IconMail',
      },
      { name: 'closerName', label: 'Closer', type: 'TEXT', icon: 'IconUser' },
      {
        name: 'prospectName',
        label: 'Prospect',
        type: 'TEXT',
        icon: 'IconUserCircle',
      },
      {
        name: 'prospectEmail',
        label: 'Prospect email',
        type: 'TEXT',
        icon: 'IconMail',
      },
      {
        name: 'callType',
        label: 'Call type',
        type: 'SELECT',
        icon: 'IconTag',
        extra: {
          options: CALL_TYPE_OPTIONS.map((entry, position) => ({
            ...entry,
            id: randomUUID(),
            position,
          })),
        },
      },
      {
        name: 'outcome',
        label: 'Outcome',
        type: 'SELECT',
        icon: 'IconTargetArrow',
        extra: {
          options: CALL_OUTCOME_OPTIONS.map((entry, position) => ({
            ...entry,
            id: randomUUID(),
            position,
          })),
        },
      },
      {
        name: 'status',
        label: 'Review status',
        type: 'SELECT',
        icon: 'IconProgressCheck',
        extra: {
          options: STATUS_OPTIONS.map((entry, position) => ({
            ...entry,
            id: randomUUID(),
            position,
          })),
        },
      },
      {
        name: 'overallScore',
        label: 'Overall score',
        type: 'NUMBER',
        icon: 'IconTargetArrow',
      },
      { name: 'verdict', label: 'Headline', type: 'TEXT', icon: 'IconNotes' },
      {
        name: 'report',
        label: 'Review report',
        type: 'TEXT',
        icon: 'IconFileText',
      },
      {
        name: 'summary',
        label: 'Meeting summary',
        type: 'TEXT',
        icon: 'IconFileText',
      },
      {
        name: 'scores',
        label: 'Scorecard',
        type: 'RAW_JSON',
        icon: 'IconFileText',
      },
      {
        name: 'keyMoments',
        label: 'Three things to change',
        type: 'RAW_JSON',
        icon: 'IconFileText',
      },
      {
        name: 'deductions',
        label: 'Automatic deductions',
        type: 'RAW_JSON',
        icon: 'IconFileText',
      },
      {
        name: 'confidence',
        label: 'Review confidence',
        type: 'TEXT',
        icon: 'IconNotes',
      },
      {
        name: 'transcript',
        label: 'Transcript',
        type: 'TEXT',
        icon: 'IconFileText',
      },
      {
        name: 'recording',
        label: 'Recording',
        type: 'LINKS',
        icon: 'IconVideo',
      },
      {
        name: 'person',
        label: 'Prospect record',
        type: 'RELATION',
        icon: 'IconUser',
        extra: {
          relationCreationPayload: {
            targetObjectMetadataId: person.id,
            targetFieldLabel: 'Call reviews',
            targetFieldIcon: 'IconPhone',
            type: 'MANY_TO_ONE',
          },
        },
      },
    ]);
    await this.twentyApi.ensureSelectOptions(
      'callReview',
      'outcome',
      CALL_OUTCOME_OPTIONS,
    );
    await this.ensureCallsTab();
    this.metadataReady = true;
  }

  private async ensureCallsTab() {
    const objects = await this.twentyApi.listObjects();
    const personObject = objects.find(
      (object) => object.nameSingular === 'person',
    );
    const field = personObject?.fieldsList.find(
      (candidate) => candidate.name === 'callReviews',
    );
    if (!field) return;
    const existing: { id: string }[] = await this.dataSource.query(
      `select id from core."pageLayoutTab" where id = $1`,
      [PERSON_PAGE_CALLS_TAB],
    );
    if (existing.length) return;
    const template: {
      workspaceId: string;
      applicationId: string;
      pageLayoutId: string;
    }[] = await this.dataSource.query(
      `select "workspaceId", "applicationId", "pageLayoutId" from core."pageLayoutTab" where id = 'eb76f23e-e2f9-42a5-9ae0-80f3fcc318ff'`,
    );
    if (!template[0]) return;
    const { workspaceId, applicationId, pageLayoutId } = template[0];
    await this.dataSource.query(
      `insert into core."pageLayoutTab" (id, title, position, "pageLayoutId", "workspaceId", "universalIdentifier", "applicationId") values ($1, 'Calls', 62, $2, $3, $4, $5)`,
      [
        PERSON_PAGE_CALLS_TAB,
        pageLayoutId,
        workspaceId,
        randomUUID(),
        applicationId,
      ],
    );
    await this.dataSource.query(
      `insert into core."pageLayoutWidget" (id, "pageLayoutTabId", title, type, "objectMetadataId", "gridPosition", configuration, "workspaceId", "universalIdentifier", "applicationId")
       values ($1, $2, 'Call reviews', 'FIELD', $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
      [
        randomUUID(),
        PERSON_PAGE_CALLS_TAB,
        personObject?.id,
        JSON.stringify({ row: 0, column: 0, rowSpan: 1, columnSpan: 12 }),
        JSON.stringify({
          fieldMetadataId: field.id,
          fieldDisplayMode: 'CARD',
          configurationType: 'FIELD',
        }),
        workspaceId,
        randomUUID(),
        applicationId,
      ],
    );
    this.logger.log('calls tab added to the person page');
  }

  // ---------- Fathom webhook ----------

  isFathomConfigured() {
    return !!env('OS_FATHOM_KEY');
  }

  private async setting(key: string): Promise<string | null> {
    await this.ensureTables();
    const rows: { value: string }[] = await this.dataSource.query(
      'select value from os.app_settings where key = $1',
      [key],
    );
    return rows[0]?.value ?? null;
  }

  private async setSetting(key: string, value: string) {
    await this.dataSource.query(
      'insert into os.app_settings (key, value, updated_at) values ($1, $2, now()) on conflict (key) do update set value = excluded.value, updated_at = now()',
      [key, value],
    );
  }

  async webhookPathToken() {
    return this.setting('fathom.webhook.token');
  }

  // Registers our endpoint with Fathom once (transcript, summary and action items included).
  async ensureFathomWebhook(): Promise<{ url: string; registered: boolean }> {
    const serverUrl = env('SERVER_URL');
    const key = env('OS_FATHOM_KEY');
    if (!serverUrl || !key)
      throw new Error('SERVER_URL and OS_FATHOM_KEY are required');
    let token = await this.setting('fathom.webhook.token');
    if (!token) {
      token = randomBytes(24).toString('hex');
      await this.setSetting('fathom.webhook.token', token);
    }
    const url = `${serverUrl}/os/fathom/webhook/${token}`;
    if (await this.setting('fathom.webhook.secret'))
      return { url, registered: false };
    const response = await fetch(`${FATHOM_API}/webhooks`, {
      method: 'POST',
      headers: { 'X-Api-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destination_url: url,
        triggered_for: [
          'my_recordings',
          'shared_team_recordings',
          'my_shared_with_team_recordings',
          'shared_external_recordings',
        ],
        include_transcript: true,
        include_summary: true,
        include_action_items: true,
        include_crm_matches: false,
      }),
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `fathom webhook create ${response.status}: ${text.slice(0, 300)}`,
      );
    const created = JSON.parse(text) as { id?: string; secret?: string };
    if (!created.secret)
      throw new Error(
        `fathom webhook created without a secret: ${text.slice(0, 200)}`,
      );
    await this.setSetting('fathom.webhook.secret', created.secret);
    if (created.id)
      await this.setSetting('fathom.webhook.id', String(created.id));
    this.logger.log(`fathom webhook registered at ${url}`);
    return { url, registered: true };
  }

  // Standard Webhooks: base64(HMAC-SHA256(secret, "<id>.<timestamp>.<body>")), secret after "whsec_".
  async signatureIsValid(
    headers: Record<string, string | undefined>,
    rawBody: Buffer | undefined,
  ): Promise<boolean> {
    const secret = await this.setting('fathom.webhook.secret');
    const id = headers['webhook-id'];
    const timestamp = headers['webhook-timestamp'];
    const signatureHeader = headers['webhook-signature'] ?? '';
    if (!secret || !id || !timestamp || !rawBody) return false;
    if (
      Math.abs(Date.now() - Number(timestamp) * 1000) > SIGNATURE_TOLERANCE_MS
    )
      return false;
    const bare = secret.replace(/^whsec_/, '');
    const message = `${id}.${timestamp}.${rawBody.toString('utf8')}`;
    const provided = signatureHeader
      .split(' ')
      .map((part) => part.split(',')[1] ?? '')
      .filter(Boolean);
    return [Buffer.from(bare, 'base64'), Buffer.from(secret, 'utf8')].some(
      (key) => {
        const expected = createHmac('sha256', key)
          .update(message)
          .digest('base64');
        return provided.some(
          (candidate) =>
            candidate.length === expected.length &&
            timingSafeEqual(Buffer.from(candidate), Buffer.from(expected)),
        );
      },
    );
  }

  async recordEvent(
    id: string,
    name: string,
    recordingId: string | null,
    payload: unknown,
  ): Promise<boolean> {
    await this.ensureTables();
    const inserted = await this.dataSource.query(
      'insert into os.fathom_events (id, name, recording_id, payload) values ($1, $2, $3, $4::jsonb) on conflict (id) do nothing returning id',
      [id, name, recordingId, JSON.stringify(payload)],
    );
    return inserted.length > 0;
  }

  // ---------- ingest ----------

  async ingest(
    meeting: FathomMeeting,
    options: { force?: boolean } = {},
  ): Promise<{ id: string | null; status: string; reason?: string }> {
    await this.ensureMetadata();
    const recordingId =
      meeting.recording_id !== null && meeting.recording_id !== undefined
        ? String(meeting.recording_id)
        : null;
    if (!recordingId)
      return { id: null, status: 'SKIPPED', reason: 'no recording id' };
    const existing = await this.findByRecordingId(recordingId);
    if (existing && !options.force)
      return { id: existing.id, status: 'SKIPPED', reason: 'already reviewed' };

    const recordedBy = (meeting.recorded_by?.email ?? '').toLowerCase();
    const closers = await this.closers();
    const closer =
      closers.find(
        (row) => (row.fathom_email ?? '').toLowerCase() === recordedBy,
      ) ?? null;
    if (!closer)
      return {
        id: null,
        status: 'SKIPPED',
        reason: `recorded by ${recordedBy || 'unknown'}, not a closer`,
      };
    const invitees = (meeting.calendar_invitees ?? []).filter(
      (invitee): invitee is FathomInvitee => !!invitee,
    );
    const external = invitees.filter((invitee) => invitee.is_external === true);
    if (external.length === 0 && !options.force)
      return { id: null, status: 'SKIPPED', reason: 'no external attendee' };

    const transcript = this.transcriptText(meeting.transcript);
    const title = meeting.meeting_title ?? meeting.title ?? 'Sales call';
    const startedAt =
      meeting.recording_start_time ??
      meeting.scheduled_start_time ??
      meeting.created_at ??
      new Date().toISOString();
    const endedAt =
      meeting.recording_end_time ?? meeting.scheduled_end_time ?? null;
    const durationMinutes = endedAt
      ? Math.max(
          0,
          Math.round(
            (new Date(endedAt).getTime() - new Date(startedAt).getTime()) /
              60000,
          ),
        )
      : null;
    const prospect = external[0] ?? null;
    const booking = await this.matchBooking(
      closer,
      meeting.scheduled_start_time ?? startedAt,
      prospect?.email ?? null,
    );
    const prospectEmail =
      (prospect?.email ?? booking?.inviteeEmail ?? null)?.toLowerCase() ?? null;
    const prospectName =
      prospect?.name ??
      booking?.inviteeName ??
      (title.includes(':') ? title.split(':')[0].trim() : null);
    const callType: CallType = booking?.bookingType
      ? DFY_BOOKING_TYPES.has(booking.bookingType)
        ? 'DFY'
        : 'SOFTWARE'
      : /discovery|dfy|done for you/i.test(title)
        ? 'DFY'
        : 'SOFTWARE';
    const personId =
      booking?.personId ??
      (prospectEmail ? await this.personIdByEmail(prospectEmail) : null);
    const recordingUrl = meeting.share_url ?? meeting.url ?? null;

    const base = {
      name: `${prospectName ?? title} · ${startedAt.slice(0, 10)}`,
      fathomRecordingId: recordingId,
      callDate: startedAt.slice(0, 10),
      startedAt,
      durationMinutes,
      closerEmail: closer.fathom_email,
      closerName: closer.name,
      prospectName,
      prospectEmail,
      callType,
      recording: recordingUrl
        ? {
            primaryLinkUrl: recordingUrl,
            primaryLinkLabel: 'Fathom recording',
            secondaryLinks: [],
          }
        : null,
      transcript: transcript.slice(0, 200_000),
      personId,
      status: 'PENDING',
      outcome: 'UNSCORED',
    };
    const id = existing ? existing.id : await this.create(base);
    if (existing) await this.update(id, base);
    if (booking && recordingUrl)
      await this.attachRecordingToBooking(booking.id, recordingUrl);

    // Summary note first (cheap, always useful), the review second (only for closers who are coached).
    let summary: string | null = null;
    try {
      summary = await this.summarise(
        meeting,
        title,
        startedAt,
        endedAt,
        durationMinutes,
        invitees,
        recordingUrl,
        transcript,
      );
      await this.update(id, { summary });
      if (personId)
        await this.noteOnPerson(
          personId,
          title,
          startedAt,
          recordingUrl,
          summary,
        );
    } catch (error) {
      this.logger.warn(
        `call ${recordingId}: summary failed: ${(error as Error).message}`,
      );
    }

    if (!closer.score_calls || transcript.length < MIN_TRANSCRIPT_CHARS) {
      await this.update(id, { status: summary ? 'SUMMARISED' : 'SKIPPED' });
      return {
        id,
        status: summary ? 'SUMMARISED' : 'SKIPPED',
        reason: closer.score_calls
          ? 'transcript too short'
          : 'closer not scored',
      };
    }
    try {
      const companyName = personId ? await this.companyNameOf(personId) : null;
      const { report, summary: parsed } = await this.review(callType, {
        closerName: closer.name,
        prospectName,
        prospectCompany: companyName,
        callDate: startedAt.slice(0, 10),
        transcript,
      });
      const outcome =
        parsed.outcome && OUTCOME_VALUES.has(parsed.outcome)
          ? parsed.outcome
          : 'UNSCORED';
      const overallScore =
        typeof parsed.overall_score === 'number'
          ? Math.round(parsed.overall_score * 10) / 10
          : null;
      await this.update(id, {
        status: 'SCORED',
        outcome,
        overallScore,
        report,
        verdict: parsed.headline ?? null,
        scores: parsed.sections ?? null,
        keyMoments: parsed.three_things ?? null,
        deductions: parsed.deductions ?? null,
        confidence: parsed.confidence ?? null,
      });
      return { id, status: 'SCORED' };
    } catch (error) {
      this.logger.error(
        `call ${recordingId}: review failed: ${(error as Error).message}`,
      );
      await this.update(id, { status: 'FAILED' });
      return { id, status: 'FAILED', reason: (error as Error).message };
    }
  }

  // Pulls recent meetings from the Fathom API, newest first, and reviews the ones not seen yet.
  async backfill(
    days: number,
    options: { limit?: number } = {},
  ): Promise<{ scanned: number; results: Record<string, number> }> {
    const key = env('OS_FATHOM_KEY');
    if (!key) throw new Error('OS_FATHOM_KEY missing');
    const closers = await this.closers();
    const emails = closers
      .map((row) => row.fathom_email)
      .filter((email): email is string => !!email);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const results: Record<string, number> = {};
    let scanned = 0;
    let cursor: string | null = null;
    for (let page = 0; page < 40; page++) {
      const params = new URLSearchParams({
        created_after: since,
        include_transcript: 'true',
        include_summary: 'true',
        include_action_items: 'true',
        calendar_invitees_domains_type: 'one_or_more_external',
        limit: '20',
      });
      for (const email of emails) params.append('recorded_by[]', email);
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(
        `${FATHOM_API}/meetings?${params.toString()}`,
        { headers: { 'X-Api-Key': key } },
      );
      if (!response.ok)
        throw new Error(
          `fathom meetings ${response.status}: ${(await response.text()).slice(0, 200)}`,
        );
      const data = (await response.json()) as {
        items?: FathomMeeting[];
        next_cursor?: string | null;
      };
      for (const meeting of data.items ?? []) {
        scanned++;
        const recordingId =
          meeting.recording_id !== null && meeting.recording_id !== undefined
            ? String(meeting.recording_id)
            : null;
        if (recordingId)
          await this.recordEvent(
            `backfill:${recordingId}`,
            'backfill',
            recordingId,
            meeting,
          );
        const result = await this.ingest(meeting);
        results[result.status] = (results[result.status] ?? 0) + 1;
        if (options.limit && scanned >= options.limit)
          return { scanned, results };
      }
      cursor = data.next_cursor ?? null;
      if (!cursor) break;
    }
    return { scanned, results };
  }

  async rescore(id: string) {
    const review = await this.twentyApi.records<{
      callReview: { fathomRecordingId: string | null } | null;
    }>(
      `query CallReviewRecording($id: UUID) { callReview(filter: { id: { eq: $id } }) { fathomRecordingId } }`,
      { id },
    );
    const recordingId = review.callReview?.fathomRecordingId;
    if (!recordingId) throw new Error('review not found');
    const rows: { payload: FathomMeeting }[] = await this.dataSource.query(
      'select payload from os.fathom_events where recording_id = $1 order by received_at desc limit 1',
      [recordingId],
    );
    const payload = rows[0]?.payload;
    if (!payload)
      throw new Error(
        'no stored Fathom payload for this call; run a backfill instead',
      );
    return this.ingest(payload, { force: true });
  }

  // ---------- helpers ----------

  // Timestamped so the review can point the closer at the moment in the recording.
  private transcriptText(transcript: FathomMeeting['transcript']): string {
    if (!transcript) return '';
    if (typeof transcript === 'string') return transcript;
    return transcript
      .map(
        (item) =>
          `${item.timestamp ? `[${item.timestamp}] ` : ''}${item.speaker?.display_name ?? 'Unknown'}: ${item.text ?? ''}`,
      )
      .join('\n');
  }

  private async closers(): Promise<CloserRow[]> {
    await this.ensureTables();
    return this.dataSource.query(
      `select id, name, login_email, fathom_email, calendly_host_email, discord_webhook, score_calls from os.closers where active`,
    );
  }

  // The Calendly booking this recording belongs to: same closer, start within half an hour. It gives
  // the person, the invitee's real email (Fathom only knows the calendar one) and the call type.
  private async matchBooking(
    closer: CloserRow,
    startIso: string,
    inviteeEmail: string | null,
  ): Promise<MatchedBooking | null> {
    const hostEmail = closer.calendly_host_email ?? closer.login_email;
    if (!hostEmail) return null;
    const from = new Date(
      new Date(startIso).getTime() - BOOKING_MATCH_MINUTES * 60_000,
    ).toISOString();
    const to = new Date(
      new Date(startIso).getTime() + BOOKING_MATCH_MINUTES * 60_000,
    ).toISOString();
    const data = await this.twentyApi.records<{
      bookings: {
        edges: {
          node: MatchedBooking & { startsAt: string; status: string | null };
        }[];
      };
    }>(
      `query CallBooking($host: String, $from: DateTime, $to: DateTime) {
         bookings(filter: { and: [{ closerEmail: { ilike: $host } }, { startsAt: { gte: $from } }, { startsAt: { lte: $to } }] }, first: 10) {
           edges { node { id bookingType inviteeEmail inviteeName personId startsAt status } }
         }
       }`,
      { host: hostEmail, from, to },
    );
    const candidates = data.bookings.edges
      .map((edge) => edge.node)
      .filter(
        (node) => node.status !== 'CANCELLED' && node.status !== 'RESCHEDULED',
      );
    const byEmail = inviteeEmail
      ? candidates.find(
          (node) =>
            (node.inviteeEmail ?? '').toLowerCase() ===
            inviteeEmail.toLowerCase(),
        )
      : undefined;
    if (byEmail) return byEmail;
    candidates.sort(
      (left, right) =>
        Math.abs(
          new Date(left.startsAt).getTime() - new Date(startIso).getTime(),
        ) -
        Math.abs(
          new Date(right.startsAt).getTime() - new Date(startIso).getTime(),
        ),
    );
    return candidates[0] ?? null;
  }

  private async attachRecordingToBooking(
    bookingId: string,
    recordingUrl: string,
  ) {
    try {
      await this.twentyApi.records(
        `mutation BookingRecording($id: UUID!, $data: BookingUpdateInput!) { updateBooking(id: $id, data: $data) { id } }`,
        {
          id: bookingId,
          data: {
            recording: {
              primaryLinkUrl: recordingUrl,
              primaryLinkLabel: 'Fathom',
              secondaryLinks: [],
            },
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `booking ${bookingId}: could not attach the recording: ${(error as Error).message}`,
      );
    }
  }

  private async personIdByEmail(email: string): Promise<string | null> {
    const data = await this.twentyApi.records<{
      people: { edges: { node: { id: string } }[] };
    }>(
      `query CallPerson($email: String) { people(filter: { emails: { primaryEmail: { ilike: $email } } }, first: 1) { edges { node { id } } } }`,
      { email },
    );
    return data.people.edges[0]?.node.id ?? null;
  }

  private async companyNameOf(personId: string): Promise<string | null> {
    try {
      const data = await this.twentyApi.records<{
        person: { company: { name: string | null } | null } | null;
      }>(
        `query CallPersonCompany($id: UUID) { person(filter: { id: { eq: $id } }) { company { name } } }`,
        { id: personId },
      );
      return data.person?.company?.name ?? null;
    } catch {
      return null;
    }
  }

  private async findByRecordingId(
    recordingId: string,
  ): Promise<{ id: string } | null> {
    const data = await this.twentyApi.records<{
      callReviews: { edges: { node: { id: string } }[] };
    }>(
      `query CallReviewByRecording($recordingId: String) { callReviews(filter: { fathomRecordingId: { eq: $recordingId } }, first: 1) { edges { node { id } } } }`,
      { recordingId },
    );
    return data.callReviews.edges[0]?.node ?? null;
  }

  private async create(data: Record<string, unknown>): Promise<string> {
    const created = await this.twentyApi.records<{
      createCallReview: { id: string };
    }>(
      `mutation CreateCallReview($data: CallReviewCreateInput!) { createCallReview(data: $data) { id } }`,
      { data },
    );
    return created.createCallReview.id;
  }

  private async update(id: string, data: Record<string, unknown>) {
    await this.twentyApi.records(
      `mutation UpdateCallReview($id: UUID!, $data: CallReviewUpdateInput!) { updateCallReview(id: $id, data: $data) { id } }`,
      { id, data },
    );
  }

  private async noteOnPerson(
    personId: string,
    title: string,
    startedAt: string,
    recordingUrl: string | null,
    summary: string,
  ) {
    const when = new Date(startedAt).toLocaleString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const markdown = `**${title}** · ${when}${recordingUrl ? `\n[Recording](${recordingUrl})` : ''}\n\n${summary}`;
    const created = await this.twentyApi.records<{
      createNote: { id: string };
    }>(
      `mutation CallNote($data: NoteCreateInput!) { createNote(data: $data) { id } }`,
      { data: { title: `Call: ${title}`, bodyV2: { markdown } } },
    );
    await this.twentyApi.records(
      `mutation CallNoteTarget($data: NoteTargetCreateInput!) { createNoteTarget(data: $data) { id } }`,
      { data: { noteId: created.createNote.id, targetPersonId: personId } },
    );
  }

  private async gemini(body: Record<string, unknown>): Promise<string> {
    const key = env('OS_GEMINI_API_KEY');
    if (!key) throw new Error('OS_GEMINI_API_KEY missing');
    const model = env('OS_GEMINI_MODEL') ?? GEMINI_MODEL_DEFAULT;
    let lastError = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key,
          },
          body: JSON.stringify(body),
        },
      );
      if (response.ok) {
        const data = (await response.json()) as {
          candidates?: {
            content?: { parts?: { text?: string; thought?: boolean }[] };
          }[];
        };
        const parts = (data.candidates?.[0]?.content?.parts ?? []).filter(
          (part) => part.text && !part.thought,
        );
        const text = parts
          .map((part) => part.text)
          .join('')
          .trim();
        if (text) return text;
        lastError = 'empty response';
      } else {
        lastError = `${response.status}: ${(await response.text()).slice(0, 200)}`;
        if (response.status < 500 && response.status !== 429) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
    throw new Error(`gemini ${lastError}`);
  }

  // The report is what the closer reads; the summary line after the delimiter is what the CRM files it by.
  // When the model forgets the line, the score and headline are read from the report instead.
  private parseReview(text: string): Review {
    const at = text.lastIndexOf(SUMMARY_DELIMITER);
    const report = (at >= 0 ? text.slice(0, at) : text).trim();
    let summary: ReviewSummary = {};
    if (at >= 0) {
      const tail = text
        .slice(at + SUMMARY_DELIMITER.length)
        .replace(/```(?:json)?/g, '')
        .trim();
      const candidate = tail.match(/\{[\s\S]*\}/)?.[0];
      if (candidate) {
        try {
          summary = JSON.parse(candidate) as ReviewSummary;
        } catch {
          summary = {};
        }
      }
    }
    if (typeof summary.overall_score !== 'number') {
      const match = report.match(
        /Overall:?\**\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*10/i,
      );
      if (match) summary.overall_score = Number(match[1]);
    }
    if (!summary.headline) {
      const block =
        report.split(/^## +The headline\s*$/im)[1]?.split(/^## /m)[0] ?? '';
      const quote = block
        .split('\n')
        .filter((line) => line.trim().startsWith('>'))
        .map((line) => line.replace(/^>\s?/, '').trim())
        .join(' ')
        .trim();
      if (quote) summary.headline = quote;
    }
    return { report, summary };
  }

  private async review(
    callType: CallType,
    input: {
      closerName: string;
      prospectName: string | null;
      prospectCompany: string | null;
      callDate: string;
      transcript: string;
    },
  ): Promise<Review> {
    const body = {
      contents: [{ parts: [{ text: CALL_REVIEW_PROMPTS[callType](input) }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 24000,
        topP: 0.95,
        thinkingConfig: { thinkingLevel: 'medium' },
      },
    };
    let last: Review | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      last = this.parseReview(await this.gemini(body));
      if (
        last.report.length > 1500 &&
        typeof last.summary.overall_score === 'number'
      )
        return last;
    }
    if (last && last.report.length > 1500) return last;
    throw new Error('the review came back empty or truncated twice');
  }

  private async summarise(
    meeting: FathomMeeting,
    title: string,
    startedAt: string,
    endedAt: string | null,
    durationMinutes: number | null,
    invitees: FathomInvitee[],
    recordingUrl: string | null,
    transcript: string,
  ): Promise<string> {
    const fathomSummary =
      typeof meeting.default_summary === 'string'
        ? meeting.default_summary
        : (meeting.default_summary?.markdown_formatted ??
          meeting.default_summary?.text ??
          null);
    const start = new Date(startedAt);
    const date = start.toLocaleDateString('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const time = `${start.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })} - ${endedAt ? new Date(endedAt).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }) : 'N/A'}${durationMinutes !== null ? ` (${durationMinutes}m)` : ''}`;
    const attendees =
      invitees
        .map(
          (invitee) =>
            `${invitee.name ?? invitee.email ?? 'Unknown'} (${invitee.is_external ? 'External' : 'Internal'})`,
        )
        .join(', ') || 'Unknown';
    const actionItems =
      (meeting.action_items ?? [])
        .map(
          (item, index) =>
            `${index + 1}. ${item.text ?? item.description ?? ''}${item.assignee?.name || item.assignee?.email ? ` (${item.assignee?.name ?? item.assignee?.email})` : ''}`,
        )
        .join('\n') || 'None';
    const content = transcript
      ? `FULL TRANSCRIPT:\n${transcript}`
      : fathomSummary
        ? `FATHOM SUMMARY:\n${fathomSummary}`
        : 'No transcript or summary available.';
    const body = {
      contents: [
        {
          parts: [
            {
              text: CALL_SUMMARY_PROMPT({
                title,
                date,
                time,
                attendees,
                recordingUrl: recordingUrl ?? 'N/A',
                actionItems,
                content,
              }),
            },
          ],
        },
      ],
      systemInstruction: { parts: [{ text: CALL_SUMMARY_SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 8192,
        topP: 0.95,
        thinkingConfig: { thinkingLevel: 'low' },
      },
    };
    return this.gemini(body);
  }

}
