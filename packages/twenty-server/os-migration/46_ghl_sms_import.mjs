// Pulls every SMS conversation out of GoHighLevel into the CRM inbox (Twenty message model on the
// "Melanie (SMS)" channel), one thread per GHL conversation, attached to the matching person.
// Run on the VPS from packages/twenty-server: node os-migration/46_ghl_sms_import.mjs [--dry]
//   token: /root/.secrets/ghl.tok (GHL private integration token, never in the repo)
import { readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import pg from 'pg';

const envText = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const API_KEY = env.OS_TWENTY_API_KEY;
const BASE = `http://127.0.0.1:${env.NODE_PORT ?? '3000'}`;
const WORKSPACE = 'workspace_a1aip8pgko71t0v2lrw9rnizs';
const SMS_CHANNEL_ID = '5a5c0000-0000-4000-8000-00000000c0df';
const LOCATION_ID = 'XDYmIFR4Ph8RqOwSjZfI';
const GHL = 'https://services.leadconnectorhq.com';
const TOKEN = readFileSync('/root/.secrets/ghl.tok', 'utf8').trim();
const DRY = process.argv.includes('--dry');

const gql = async (query, variables = {}) => {
  const response = await fetch(`${BASE}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const payload = await response.json();
  if (payload.errors) throw new Error(payload.errors.map((error) => error.message).join('; '));
  return payload.data;
};
const ghl = async (path) => {
  const response = await fetch(`${GHL}${path}`, { headers: { Authorization: `Bearer ${TOKEN}`, Version: '2021-04-15', Accept: 'application/json' } });
  if (response.status === 429) { await new Promise((resolve) => setTimeout(resolve, 2000)); return ghl(path); }
  if (!response.ok) throw new Error(`ghl ${path} ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
};
const pgClient = new pg.Client({ connectionString: env.PG_DATABASE_URL });
await pgClient.connect();

// ---------- people index: GHL contact id, email, phone ----------
const byGhlId = new Map();
const byEmail = new Map();
const byPhone = new Map();
const digits = (value) => String(value ?? '').replace(/\D/g, '');
let after = null;
for (;;) {
  const page = (await gql(`query ($after: String) { people(first: 200, after: $after) { edges { cursor node { id ghlContactId emails { primaryEmail additionalEmails } phones { primaryPhoneNumber primaryPhoneCallingCode } name { firstName lastName } } } pageInfo { hasNextPage endCursor } } }`, { after })).people;
  for (const { node } of page.edges) {
    const name = `${node.name?.firstName ?? ''} ${node.name?.lastName ?? ''}`.trim();
    const person = { id: node.id, name };
    if (node.ghlContactId) byGhlId.set(node.ghlContactId, person);
    for (const email of [node.emails?.primaryEmail, ...(node.emails?.additionalEmails ?? [])]) if (email) byEmail.set(email.toLowerCase(), person);
    const phone = digits(`${node.phones?.primaryPhoneCallingCode ?? ''}${node.phones?.primaryPhoneNumber ?? ''}`);
    if (phone.length >= 8) byPhone.set(phone.slice(-9), person);
  }
  if (!page.pageInfo.hasNextPage) break;
  after = page.pageInfo.endCursor;
}
console.log(`people indexed: ${byGhlId.size} by GHL id, ${byEmail.size} by email, ${byPhone.size} by phone`);

// ---------- existing inbox messages from GHL, so a rerun adds nothing twice ----------
const existing = new Set((await pgClient.query(`select "headerMessageId" from ${WORKSPACE}.message where "headerMessageId" like 'ghl:%' and "deletedAt" is null`)).rows.map((row) => row.headerMessageId));
await pgClient.query(`create table if not exists os.ghl_sms_threads (conversation_id text primary key, message_thread_id uuid not null, person_id uuid, imported_at timestamptz default now())`);
const threadByConversation = new Map((await pgClient.query('select conversation_id, message_thread_id from os.ghl_sms_threads')).rows.map((row) => [row.conversation_id, row.message_thread_id]));

// ---------- walk every GHL conversation ----------
const conversations = [];
let startAfterDate = null;
for (;;) {
  const page = await ghl(`/conversations/search?locationId=${LOCATION_ID}&limit=100&sort=desc&sortBy=last_message_date${startAfterDate ? `&startAfterDate=${startAfterDate}` : ''}`);
  const batch = page.conversations ?? [];
  conversations.push(...batch);
  if (batch.length < 100) break;
  startAfterDate = batch[batch.length - 1].lastMessageDate;
  if (conversations.length > 20000) break;
}
console.log(`ghl conversations: ${conversations.length}`);

let imported = 0;
let skippedNoPerson = 0;
let conversationsWithSms = 0;
const unmatched = [];
for (const conversation of conversations) {
  const messages = [];
  let lastMessageId = null;
  for (;;) {
    const page = await ghl(`/conversations/${conversation.id}/messages?limit=100&type=TYPE_SMS${lastMessageId ? `&lastMessageId=${lastMessageId}` : ''}`);
    const batch = page.messages?.messages ?? [];
    messages.push(...batch.filter((message) => message.messageType === 'TYPE_SMS' && message.body));
    if (!page.messages?.nextPage || batch.length === 0) break;
    lastMessageId = page.messages.lastMessageId;
  }
  if (messages.length === 0) continue;
  conversationsWithSms++;
  const person = byGhlId.get(conversation.contactId) ?? byEmail.get((conversation.email ?? '').toLowerCase()) ?? byPhone.get(digits(conversation.phone).slice(-9)) ?? null;
  if (!person) { skippedNoPerson += messages.length; unmatched.push(`${conversation.fullName ?? ''} <${conversation.email ?? ''}> ${conversation.phone ?? ''} (${messages.length})`); continue; }
  const fresh = messages.filter((message) => !existing.has(`ghl:${message.id}`));
  if (fresh.length === 0) continue;
  if (DRY) { imported += fresh.length; continue; }

  let threadId = threadByConversation.get(conversation.id);
  if (!threadId) {
    threadId = (await gql(`mutation ($data: MessageThreadCreateInput!) { createMessageThread(data: $data) { id } }`, { data: { subject: `Text conversation with ${person.name || conversation.fullName || conversation.phone}` } })).createMessageThread.id;
    await pgClient.query('insert into os.ghl_sms_threads (conversation_id, message_thread_id, person_id) values ($1, $2, $3) on conflict (conversation_id) do nothing', [conversation.id, threadId, person.id]);
    threadByConversation.set(conversation.id, threadId);
  }
  const contactName = person.name || conversation.fullName || conversation.phone || 'Contact';
  for (const message of fresh.sort((a, b) => new Date(a.dateAdded) - new Date(b.dateAdded))) {
    const inbound = message.direction === 'inbound';
    const created = await gql(`mutation ($data: MessageCreateInput!) { createMessage(data: $data) { id } }`, {
      data: { headerMessageId: `ghl:${message.id}`, subject: inbound ? `Text from ${contactName}` : `Text to ${contactName}`, text: message.body, receivedAt: message.dateAdded, messageThreadId: threadId },
    });
    const messageId = created.createMessage.id;
    const contact = { handle: conversation.phone ?? '', displayName: contactName, personId: person.id };
    const us = { handle: 'GHL', displayName: 'Conversifi (SMS)' };
    const from = inbound ? contact : us;
    const to = inbound ? us : contact;
    await gql(`mutation ($data: [MessageParticipantCreateInput!]!) { createMessageParticipants(data: $data) { id } }`, {
      data: [
        { messageId, role: 'FROM', handle: from.handle, displayName: from.displayName, ...(from.personId ? { personId: from.personId } : {}) },
        { messageId, role: 'TO', handle: to.handle, displayName: to.displayName, ...(to.personId ? { personId: to.personId } : {}) },
      ],
    });
    await pgClient.query(
      `insert into ${WORKSPACE}."messageChannelMessageAssociation" (id, "messageChannelId", "messageId", "messageThreadId", direction, "messageExternalId", "messageThreadExternalId") values ($1, $2, $3, $4, $5::${WORKSPACE}."messageChannelMessageAssociation_direction_enum", $6, $7)`,
      [randomUUID(), SMS_CHANNEL_ID, messageId, threadId, inbound ? 'INCOMING' : 'OUTGOING', message.id, conversation.id],
    );
    existing.add(`ghl:${message.id}`);
    imported++;
  }
}
console.log(`${DRY ? 'would import' : 'imported'}: ${imported} texts across ${conversationsWithSms} conversations with SMS; skipped ${skippedNoPerson} texts with no matching person (${unmatched.length} conversations)`);
if (unmatched.length) console.log('unmatched:\n  ' + unmatched.slice(0, 40).join('\n  '));
await pgClient.end();
