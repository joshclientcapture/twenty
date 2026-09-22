import { AGENCY_SYSTEM_PROMPT, DEMO_SYSTEM_PROMPT, DFY_SYSTEM_PROMPT } from 'src/conversifi-os/constants/os-sms-prompts.constant';

export type SmsRoute = 'dfy' | 'demo' | 'agency';

export type SmsRouteConfig = {
  bookingLink: string;
  // Who the contact is, for the prompt's one line of framing.
  who: string;
  opener: (firstName: string) => string;
  // The deliberate typo correction sent 15 seconds after the opener, so the thread reads human.
  typoFix: string;
  ladder: [(firstName: string) => string, (firstName: string) => string, (firstName: string) => string];
  systemPrompt: string;
};

// Which form route on the person becomes which chase.
export const ROUTE_BY_SOURCE: Record<string, SmsRoute> = {
  DFY: 'dfy',
  DEMO: 'demo',
  AGENCY: 'agency',
  AGENCY_FUNNEL: 'agency',
};

// GHL's "AI SMS - Lead not booked after 15 min" ladder: +30 min, +1 day, +3 days.
export const LADDER_DELAYS_MS = [30 * 60 * 1000, 24 * 60 * 60 * 1000, 3 * 24 * 60 * 60 * 1000];
export const CHASE_AFTER_MS = 15 * 60 * 1000;
export const TYPO_AFTER_MS = 15 * 1000;

const noBetterDay = (firstName: string) =>
  `Look ${firstName}, there's no better day than today.\n\nI know you might be busy, but if you're still serious about getting sales appointments through LinkedIn, let's get this meeting locked in.\n\nAre you free tomorrow or the day after?`;

const worldWaits = (link: string) => (firstName: string) =>
  `${firstName}, the world waits for no one.\n\nIf you ever want to take action and finally see some real growth, you can check us out here: ${link}`;

const allGood = (firstName: string) => `all good ${firstName}?`;

export const SMS_ROUTES: Record<SmsRoute, SmsRouteConfig> = {
  agency: {
    bookingLink: 'https://agencies.conversifi.io/book',
    who: 'the agency owner we are trying to book in',
    opener: (firstName) => `Hey ${firstName}, it's Melanie from Conversifi.\n\nYou started boking an agency demo with us but didn't finish it.\n\nIs there anything I can clear up for you?`,
    typoFix: 'booking*',
    ladder: [allGood, noBetterDay, worldWaits('https://ga.clientcapture.io')],
    systemPrompt: AGENCY_SYSTEM_PROMPT,
  },
  demo: {
    bookingLink: 'https://conversifi.io/demo',
    who: 'the prospect we are trying to book in',
    opener: (firstName) => `Hey ${firstName}, it's Melanie from Conversifi.\n\nYou started boking a demo of our LinkedIn software but didn't finish it.\n\nIs there anything I can clear up for you?`,
    typoFix: 'booking*',
    ladder: [allGood, noBetterDay, worldWaits('https://conversifi.io/demo')],
    systemPrompt: DEMO_SYSTEM_PROMPT,
  },
  dfy: {
    bookingLink: 'https://conversifi.io/calendar',
    who: 'the professional we are trying to book in',
    opener: (firstName) => `Hey ${firstName}, it's Melanie from Conversifi.\n\nYou started booking a call with us about having your LinkedIn outreach run for you, but didn't finsih it.\n\nIs there anything I can clear up for you?`,
    typoFix: 'finish*',
    ladder: [allGood, noBetterDay, worldWaits('https://conversifi.io/calendar')],
    systemPrompt: DFY_SYSTEM_PROMPT,
  },
};

export const systemPromptFor = (route: SmsRoute) => SMS_ROUTES[route].systemPrompt.split('{{BOOKING_LINK}}').join(SMS_ROUTES[route].bookingLink);
