import { Body, Controller, Header, HttpCode, Logger, NotFoundException, Param, Post, Req } from '@nestjs/common';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import { OsSmsService } from 'src/conversifi-os/services/os-sms.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

type TwilioInbound = { From?: string; To?: string; Body?: string; MessageSid?: string; SmsSid?: string; MessageStatus?: string; SmsStatus?: string };

// Twilio posts inbound texts and delivery receipts here, form-encoded, signed with the auth token.
// The path token keeps strangers out; the signature keeps forgeries out.
@Controller(`${ApiPath.Os}/sms`)
export class OsSmsWebhookController {
  private readonly logger = new Logger(OsSmsWebhookController.name);

  constructor(private readonly sms: OsSmsService) {}

  @Post('inbound/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async inbound(@Param('token') token: string, @Body() body: TwilioInbound, @Req() request: Request) {
    this.guard(token, request, body as Record<string, string>, 'inbound');
    const from = body.From ?? '';
    const text = body.Body ?? '';
    const result = await this.sms.inbound(from, body.To ?? '', text, body.MessageSid ?? body.SmsSid ?? null, body as Record<string, unknown>);
    this.logger.log(`sms inbound from ${from}: ${text.slice(0, 80)} -> ${JSON.stringify(result)}`);
    // An empty TwiML reply, so Twilio sends nothing on its own.
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  @Post('status/:token')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async status(@Param('token') token: string, @Body() body: TwilioInbound, @Req() request: Request) {
    this.guard(token, request, body as Record<string, string>, 'status');
    const sid = body.MessageSid ?? body.SmsSid;
    const status = body.MessageStatus ?? body.SmsStatus;
    if (sid && status) await this.sms.recordStatus(sid, status);
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }

  // The four calls the native SMS workflows make, guarded by the same path token (server to server, no Twilio signature).
  @Post('thread/:token')
  @HttpCode(200)
  async thread(@Param('token') token: string, @Body() body: { personId?: string; route?: string }) {
    this.tokenOnly(token);
    if (!body?.personId) return { go: '', reason: 'personId missing' };
    return this.sms.ensureThread(body.personId, body.route ?? null);
  }

  @Post('state/:token')
  @HttpCode(200)
  async state(@Param('token') token: string, @Body() body: { threadId?: string }) {
    this.tokenOnly(token);
    if (!body?.threadId) return { found: '', status: 'missing', replied: '', booked: '', live: '', transcript: '' };
    return this.sms.state(body.threadId);
  }

  @Post('send/:token')
  @HttpCode(200)
  async send(@Param('token') token: string, @Body() body: { threadId?: string; body?: string; kind?: string }) {
    this.tokenOnly(token);
    if (!body?.threadId || !body?.body?.trim()) return { ok: '', reason: 'threadId or body missing' };
    return this.sms.sendForThread(body.threadId, body.body.trim(), body.kind ?? 'ai');
  }

  @Post('mark/:token')
  @HttpCode(200)
  async mark(@Param('token') token: string, @Body() body: { threadId?: string; status?: string; reason?: string }) {
    this.tokenOnly(token);
    if (!body?.threadId || !body?.status) return { ok: '', reason: 'threadId or status missing' };
    return this.sms.setStatus(body.threadId, body.status, body.reason ?? '');
  }

  private tokenOnly(token: string) {
    const expected = env('OS_TWILIO_WEBHOOK_TOKEN');
    if (!expected || token !== expected) throw new NotFoundException();
  }

  private guard(token: string, request: Request, params: Record<string, string>, path: string) {
    const expected = env('OS_TWILIO_WEBHOOK_TOKEN');
    if (!expected || token !== expected) throw new NotFoundException();
    const url = `${env('SERVER_URL') ?? ''}/os/sms/${path}/${token}`;
    const signature = request.header('x-twilio-signature');
    if (!this.sms.signatureIsValid(url, params, signature)) {
      this.logger.warn(`sms webhook with a bad signature ignored (${path})`);
      throw new NotFoundException();
    }
  }
}
