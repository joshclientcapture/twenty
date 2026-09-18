import { Body, Controller, Header, HttpCode, NotFoundException, Options, Param, Post } from '@nestjs/common';

import { ApiPath } from 'twenty-shared/types';

import { INTAKE_EVENTS, type IntakeEvent, OsIntakeService } from 'src/conversifi-os/services/os-intake.service';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

// Public, like the GoHighLevel inbound webhooks it replaces: the only guard is the unguessable
// path token, because the booking forms post straight from the visitor's browser.
@Controller(`${ApiPath.Os}/intake`)
export class OsIntakeController {
  constructor(private readonly intake: OsIntakeService) {}

  @Options(':token/:event')
  @HttpCode(204)
  @Header('Access-Control-Allow-Origin', '*')
  @Header('Access-Control-Allow-Methods', 'POST, OPTIONS')
  @Header('Access-Control-Allow-Headers', 'Content-Type')
  @Header('Access-Control-Max-Age', '86400')
  preflight() {
    return;
  }

  @Post(':token/:event')
  @HttpCode(200)
  @Header('Access-Control-Allow-Origin', '*')
  async receive(@Param('token') token: string, @Param('event') event: string, @Body() body: unknown) {
    const expected = env('OS_INTAKE_TOKEN');
    if (!expected || token !== expected || !INTAKE_EVENTS.includes(event as IntakeEvent)) throw new NotFoundException();
    const payload = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    return this.intake.handle(event as IntakeEvent, payload);
  }
}
