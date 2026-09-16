import { OS_FAST_STEPS, OS_SYNC_STEPS, type OsSyncStep } from 'src/conversifi-os/services/os-sync.service';

export type OsSyncCronKind = 'fast' | 'full' | 'prod' | 'trial-forward' | 'rentals';

export type OsSyncCronJobData = { kind: OsSyncCronKind };

// Same cadence the OS project ran on pg_cron.
export const OS_SYNC_CRON_SCHEDULES: { kind: OsSyncCronKind; pattern: string; steps: OsSyncStep[]; calendlyWindowDays?: number }[] = [
  { kind: 'fast', pattern: '*/15 * * * *', steps: OS_FAST_STEPS, calendlyWindowDays: 3 },
  { kind: 'full', pattern: '30 */4 * * *', steps: OS_SYNC_STEPS.filter((step) => step !== 'prod' && step !== 'trial-forward') },
  { kind: 'prod', pattern: '0 */4 * * *', steps: ['prod'] },
  { kind: 'trial-forward', pattern: '*/15 * * * *', steps: ['trial-forward'] },
  { kind: 'rentals', pattern: '*/30 * * * *', steps: [] },
];
