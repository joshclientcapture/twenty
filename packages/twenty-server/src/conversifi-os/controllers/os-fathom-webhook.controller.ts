import {
  Body,
  Controller,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import { type Request } from 'express';
import { ApiPath } from 'twenty-shared/types';

import {
  type FathomMeeting,
  OsCallReviewService,
} from 'src/conversifi-os/services/os-call-review.service';

// Fathom posts each finished recording here (transcript, summary, action items). Verified with the
// Standard Webhooks signature and the random path token, acknowledged at once, reviewed in the
// background: scoring a call takes a minute and Fathom would otherwise retry.
@Controller(`${ApiPath.Os}/fathom`)
export class OsFathomWebhookController {
  private readonly logger = new Logger(OsFathomWebhookController.name);

  constructor(private readonly calls: OsCallReviewService) {}

  // Machine endpoint: locked by the path token and the Fathom signature, no user session exists.
  // oxlint-disable-next-line twenty/rest-api-methods-should-be-guarded
  @Post('webhook/:token')
  @HttpCode(200)
  async receive(
    @Param('token') token: string,
    @Body() body: FathomMeeting & { id?: string },
    @Req() request: Request & { rawBody?: Buffer },
  ) {
    const expected = await this.calls.webhookPathToken();
    if (!expected || token !== expected) throw new NotFoundException();
    const headers = {
      'webhook-id': request.header('webhook-id'),
      'webhook-timestamp': request.header('webhook-timestamp'),
      'webhook-signature': request.header('webhook-signature'),
    };
    if (!(await this.calls.signatureIsValid(headers, request.rawBody))) {
      this.logger.warn('fathom webhook with a bad signature ignored');
      throw new NotFoundException();
    }
    const recordingId =
      body?.recording_id !== null && body?.recording_id !== undefined
        ? String(body.recording_id)
        : null;
    const eventId =
      headers['webhook-id'] ?? `${recordingId ?? 'unknown'}:${Date.now()}`;
    if (
      !(await this.calls.recordEvent(
        eventId,
        'new_meeting_content_ready',
        recordingId,
        body,
      ))
    )
      return { ok: true, duplicate: true };
    this.calls.ingest(body).then(
      (result) =>
        this.logger.log(
          `fathom ${recordingId}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`,
        ),
      (error) =>
        this.logger.error(`fathom ${recordingId}: ${(error as Error).message}`),
    );
    return { ok: true };
  }
}
