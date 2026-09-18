// Registers (once) the organization-wide Calendly webhook subscription that pushes invitee.created
// and invitee.canceled to the server's /os/calendly/<token> endpoint. Reads the server .env; the
// token and signing key must already be there (OS_CALENDLY_WEBHOOK_TOKEN, OS_CALENDLY_SIGNING_KEY).
// Usage: node os-migration/26_calendly_webhook.mjs [--remove]
import { readFileSync } from 'fs';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const token = env.OS_CALENDLY_TOKEN;
const webhookToken = env.OS_CALENDLY_WEBHOOK_TOKEN;
const signingKey = env.OS_CALENDLY_SIGNING_KEY;
if (!token || !webhookToken || !signingKey) throw new Error('OS_CALENDLY_TOKEN, OS_CALENDLY_WEBHOOK_TOKEN and OS_CALENDLY_SIGNING_KEY must be set');
const PUBLIC_BASE = (env.SERVER_URL ?? 'https://crm.conversifi.io').replace(/\/$/, '');
const url = `${PUBLIC_BASE}/os/calendly/${webhookToken}`;
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const api = async (path, init = {}) => {
  const response = await fetch(`https://api.calendly.com${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) throw new Error(`calendly ${path} ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
};

const me = (await api('/users/me')).resource;
const organization = me.current_organization;
const existing = (await api(`/webhook_subscriptions?organization=${encodeURIComponent(organization)}&scope=organization&count=100`)).collection ?? [];
for (const subscription of existing) console.log(`existing: ${subscription.state} ${subscription.callback_url.replace(/\/os\/calendly\/.*/, '/os/calendly/<token>')} ${subscription.events.join(',')}`);

const ours = existing.filter((subscription) => subscription.callback_url === url);
if (process.argv.includes('--remove')) {
  for (const subscription of ours) { await api(`/webhook_subscriptions/${subscription.uri.split('/').pop()}`, { method: 'DELETE' }); console.log('removed', subscription.uri); }
} else if (ours.length) {
  console.log('already registered');
} else {
  const created = await api('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({ url, events: ['invitee.created', 'invitee.canceled'], organization, scope: 'organization', signing_key: signingKey }),
  });
  console.log('registered:', created.resource.state, created.resource.events.join(','));
}
