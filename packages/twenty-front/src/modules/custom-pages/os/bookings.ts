export type BookingStatus = 'UPCOMING' | 'IN_PROGRESS' | 'PENDING' | 'SHOWED' | 'NO_SHOW' | 'CANCELLED' | 'RESCHEDULED';
export type BookingType =
  | 'DEMO' | 'DISCOVERY' | 'AGENCY_DEMO' | 'WEBINAR' | 'SETUP_CALL' | 'ONBOARDING' | 'DIAGNOSTICS' | 'FEEDBACK' | 'NEXT_STEPS' | 'OTHER';

// Shaped for useFindManyRecords, which requires the base record fields plus an open index.
export type BookingRecord = {
  __typename: 'Booking';
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  name: string;
  startsAt: string;
  endsAt: string | null;
  bookingType: BookingType | null;
  status: BookingStatus | null;
  closer: string;
  closerId: string;
  inviteeName: string;
  inviteeEmail: string;
  eventName: string;
  recording: { primaryLinkUrl: string | null } | null;
  joinLink: { primaryLinkUrl: string | null } | null;
  personId: string | null;
  [key: string]: unknown;
};

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; color: string }> = {
  UPCOMING: { label: 'Upcoming', color: 'var(--t-tag-text-blue, #2563eb)' },
  IN_PROGRESS: { label: 'In progress', color: 'var(--t-tag-text-purple, #7c3aed)' },
  PENDING: { label: 'Awaiting recording', color: 'var(--t-tag-text-yellow, #a16207)' },
  SHOWED: { label: 'Showed', color: 'var(--t-tag-text-green, #15803d)' },
  NO_SHOW: { label: 'No show', color: 'var(--t-tag-text-red, #b91c1c)' },
  CANCELLED: { label: 'Cancelled', color: 'var(--t-font-color-light, #9ca3af)' },
  RESCHEDULED: { label: 'Rescheduled', color: 'var(--t-tag-text-orange, #c2410c)' },
};

export const BOOKING_TYPE_LABELS: Record<BookingType, string> = {
  DEMO: 'Demo',
  DISCOVERY: 'Discovery',
  AGENCY_DEMO: 'Agency demo',
  WEBINAR: 'Webinar',
  SETUP_CALL: 'Set-up call',
  ONBOARDING: 'Onboarding',
  DIAGNOSTICS: 'Diagnostics',
  FEEDBACK: 'Feedback',
  NEXT_STEPS: 'Next steps',
  OTHER: 'Other',
};

// Closer badge hues that never collide with the status colours (blue upcoming, green showed, red no show, orange rescheduled).
const CLOSER_PALETTE = ['#4f46e5', '#0f766e', '#7c3aed', '#be185d', '#0e7490', '#92400e', '#4d7c0f', '#a21caf'];
export const closerColor = (index: number) => CLOSER_PALETTE[((index % CLOSER_PALETTE.length) + CLOSER_PALETTE.length) % CLOSER_PALETTE.length];

export const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

// Weeks start on Monday, matching how the team plans.
export const startOfWeek = (date: Date) => {
  const day = startOfDay(date);
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  return day;
};

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const minutesIntoDay = (date: Date) => date.getHours() * 60 + date.getMinutes();

export type PlacedBooking = {
  booking: BookingRecord;
  startMinutes: number;
  endMinutes: number;
  column: number;
  columns: number;
};

const DEFAULT_DURATION_MINUTES = 30;

// Interval partitioning: overlapping bookings in one day share the width, each in its own lane,
// so three closers on calls at 14:00 show as three cards side by side rather than a pile.
export const placeBookings = (bookings: BookingRecord[]): PlacedBooking[] => {
  const items = bookings
    .map((booking) => {
      const start = new Date(booking.startsAt);
      const end = booking.endsAt ? new Date(booking.endsAt) : new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60000);
      const startMinutes = minutesIntoDay(start);
      const endMinutes = Math.max(startMinutes + 15, Math.min(24 * 60, startMinutes + Math.round((end.getTime() - start.getTime()) / 60000)));
      return { booking, startMinutes, endMinutes, column: 0, columns: 1 };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);

  let cluster: PlacedBooking[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const closeCluster = () => {
    const columns = Math.max(1, laneEnds.length);
    for (const item of cluster) item.columns = columns;
    cluster = [];
    laneEnds = [];
  };
  for (const item of items) {
    if (cluster.length && item.startMinutes >= clusterEnd) closeCluster();
    let lane = laneEnds.findIndex((end) => end <= item.startMinutes);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMinutes);
    } else {
      laneEnds[lane] = item.endMinutes;
    }
    item.column = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  closeCluster();
  return items;
};

export const formatTime = (date: Date) => date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const formatDayLong = (date: Date) => date.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
export const formatRange = (from: Date, to: Date) => {
  const sameMonth = from.getMonth() === to.getMonth();
  const left = from.toLocaleDateString([], { day: 'numeric', month: sameMonth ? undefined : 'short' });
  const right = to.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
  return `${left} – ${right}`;
};
