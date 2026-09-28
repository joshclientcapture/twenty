import { Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';

import { ApiPath } from 'twenty-shared/types';
import { DataSource } from 'typeorm';

const env = (name: string) => {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
};

type CloserRow = { id: string; name: string; login_email: string | null; calendly_host_email: string | null; discord_webhook: string | null };

// Small lookups the native workflows call over HTTP, guarded by the workflow token. They keep closer
// facts in os.closers rather than inside every workflow, so adding a closer never means a rebuild.
@Controller(`${ApiPath.Os}/hook`)
export class OsHooksController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Who is this booking host: their display name and Discord channel.
  @Post('closer/:token')
  @HttpCode(200)
  async closer(@Param('token') token: string, @Body() body: { email?: string }) {
    this.guard(token);
    const email = (body?.email ?? '').trim().toLowerCase();
    if (!email) return { found: '', name: '', email: '', discordUrl: '' };
    const rows: CloserRow[] = await this.dataSource.query(
      `select id, name, login_email, calendly_host_email, discord_webhook from os.closers
       where active and (lower(calendly_host_email) = $1 or lower(login_email) = $1 or lower(fathom_email) = $1) limit 1`,
      [email],
    );
    const closer = rows[0];
    if (!closer) return { found: '', name: email, email, discordUrl: env('OS_HEALTH_DISCORD_WEBHOOK') ?? '' };
    return { found: 'yes', name: closer.name, email: closer.login_email ?? email, discordUrl: closer.discord_webhook ?? env('OS_HEALTH_DISCORD_WEBHOOK') ?? '' };
  }

  private guard(token: string) {
    const expected = env('OS_WORKFLOW_TOKEN') ?? env('OS_TWILIO_WEBHOOK_TOKEN');
    if (!expected || token !== expected) throw new NotFoundException();
  }
}
