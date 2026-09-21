import { styled } from '@linaria/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  IconChevronLeft,
  IconChevronRight,
  IconExternalLink,
  IconUserCircle,
  IconVideo,
  IconX,
} from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { useIsMobile } from '@/ui/utilities/responsive/hooks/useIsMobile';
import {
  addDays,
  BOOKING_STATUS_META,
  BOOKING_TYPE_LABELS,
  closerColor,
  formatDayLong,
  formatRange,
  formatTime,
  minutesIntoDay,
  placeBookings,
  sameDay,
  startOfDay,
  startOfWeek,
  type BookingRecord,
  type BookingStatus,
  type BookingType,
  type PlacedBooking,
} from '@/custom-pages/os/bookings';
import { fetchClosers, type Closer } from '@/custom-pages/os/closers';
import {
  ACCENT,
  EASE_OUT,
  isoDate,
  PillButton,
  PRESS_SCALE,
  StyledChip,
  StyledError,
  StyledField,
  StyledMuted,
  StyledReveal,
} from '@/custom-pages/os/ui';
import { OsSelect } from '@/custom-pages/os/OsSelect';

const HOUR_HEIGHT = 72;
const GUTTER_WIDTH = 52;
const DEFAULT_FIRST_HOUR = 7;
const DEFAULT_LAST_HOUR = 21;
const DRAWER_WIDTH = 320;

// Fills Twenty's record index body (the view bar above stays Twenty's own).
const StyledLayout = styled.div`
  box-sizing: border-box;
  color: ${t.font.color.primary};
  display: flex;
  font-family: ${t.font.family};
  font-size: ${t.font.size.md};
  gap: ${t.spacing[3]};
  height: 100%;
  min-height: 0;
  padding: ${t.spacing[2]} ${t.spacing[3]} ${t.spacing[3]} 0;
`;

const StyledRangeLabel = styled.span`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
  padding: 0 ${t.spacing[1]};
  white-space: nowrap;
  span {
    color: ${t.font.color.tertiary};
    font-weight: ${t.font.weight.regular};
  }
`;

const StyledMain = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: ${t.spacing[3]};
  min-height: 0;
  min-width: 0;
`;

const StyledToolbar = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
  row-gap: ${t.spacing[2]};
`;

const StyledToolbarGroup = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[1]};
`;

const StyledToolbarSpacer = styled.div`
  flex: 1;
`;

const StyledCloserDot = styled.span`
  background: var(--closer-color);
  border-radius: ${t.border.radius.pill};
  display: inline-block;
  height: 8px;
  margin-right: ${t.spacing[1]};
  width: 8px;
`;

const StyledSummary = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
`;

const StyledGridFrame = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`;

const StyledDayHeader = styled.div<{ days: number }>`
  border-bottom: 1px solid ${t.border.color.medium};
  display: grid;
  flex: none;
  grid-template-columns: ${GUTTER_WIDTH}px repeat(
      ${({ days }) => days},
      minmax(0, 1fr)
    );
`;

const StyledDayHeaderCell = styled.div`
  align-items: baseline;
  border-left: 1px solid ${t.border.color.light};
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.xs};
  gap: ${t.spacing[1]};
  min-width: 0;
  overflow: hidden;
  padding: ${t.spacing[2]} ${t.spacing[2]};
  text-transform: uppercase;
  letter-spacing: 0.04em;
  white-space: nowrap;
  span[data-date] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.medium};
    letter-spacing: 0;
    text-transform: none;
  }
  &[data-today='true'] span[data-date] {
    background: ${ACCENT};
    border-radius: ${t.border.radius.pill};
    color: ${t.font.color.inverted};
    padding: 0 ${t.spacing[2]};
  }
  span[data-count] {
    color: ${t.font.color.light};
    letter-spacing: 0;
    text-transform: none;
  }
`;

const StyledScroller = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
`;

const StyledGrid = styled.div<{ days: number; hours: number }>`
  display: grid;
  grid-template-columns: ${GUTTER_WIDTH}px repeat(
      ${({ days }) => days},
      minmax(0, 1fr)
    );
  height: ${({ hours }) => hours * HOUR_HEIGHT}px;
  min-width: 100%;
  position: relative;
`;

const StyledGutter = styled.div`
  position: relative;
  span {
    color: ${t.font.color.light};
    font-size: ${t.font.size.xs};
    font-variant-numeric: tabular-nums;
    position: absolute;
    right: ${t.spacing[2]};
    transform: translateY(-50%);
  }
`;

const StyledDayColumn = styled.div`
  border-left: 1px solid ${t.border.color.light};
  min-width: 0;
  position: relative;
  &[data-today='true'] {
    background: ${t.background.transparent.lighter};
  }
  &[data-weekend='true'] {
    background: ${t.background.secondary};
  }
  div[data-hour-line] {
    border-top: 1px solid ${t.border.color.light};
    left: 0;
    pointer-events: none;
    position: absolute;
    right: 0;
  }
`;

const StyledNowLine = styled.div`
  border-top: 2px solid var(--t-tag-text-red, #b91c1c);
  left: 0;
  pointer-events: none;
  position: absolute;
  right: 0;
  z-index: 2;
  &::before {
    background: var(--t-tag-text-red, #b91c1c);
    border-radius: ${t.border.radius.pill};
    content: '';
    height: 8px;
    left: -4px;
    position: absolute;
    top: -5px;
    width: 8px;
  }
`;

const StyledEvent = styled.button`
  align-items: flex-start;
  appearance: none;
  background: color-mix(
    in srgb,
    var(--status-color) 9%,
    ${t.background.primary}
  );
  border: 1px solid color-mix(in srgb, var(--status-color) 26%, transparent);
  border-left: 3px solid var(--status-color);
  border-radius: ${t.border.radius.sm};
  box-sizing: border-box;
  color: ${t.font.color.primary};
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font-family: inherit;
  gap: 1px;
  overflow: hidden;
  padding: 3px 6px;
  position: absolute;
  text-align: left;
  transition-duration: 120ms;
  transition-property: box-shadow, transform, border-color;
  transition-timing-function: ${EASE_OUT};
  z-index: 1;
  &:hover {
    box-shadow: ${t.boxShadow.light};
    z-index: 3;
  }
  &:active {
    transform: scale(${PRESS_SCALE});
  }
  &:focus-visible {
    outline: 2px solid ${ACCENT};
    outline-offset: 1px;
    z-index: 3;
  }
  &[data-selected='true'] {
    border-color: ${ACCENT};
    box-shadow: 0 0 0 1px ${ACCENT};
    z-index: 3;
  }
  &[data-status='CANCELLED'] {
    opacity: 0.55;
  }
  &[data-status='CANCELLED'] span[data-name] {
    text-decoration: line-through;
  }
  span[data-line] {
    align-items: center;
    display: flex;
    gap: 4px;
    max-width: 100%;
    min-width: 0;
    width: 100%;
  }
  span[data-time] {
    color: ${t.font.color.tertiary};
    flex: none;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    white-space: nowrap;
  }
  span[data-name] {
    flex: 1;
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
    line-height: 1.3;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  span[data-closer] {
    background: var(--closer-color);
    border-radius: ${t.border.radius.pill};
    color: #fff;
    flex: none;
    font-size: 9px;
    font-weight: ${t.font.weight.semiBold};
    letter-spacing: 0.02em;
    line-height: 14px;
    padding: 0 4px;
  }
  span[data-kind] {
    color: ${t.font.color.tertiary};
    font-size: 10px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const StyledEmpty = styled.div`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.sm};
  inset: 0;
  justify-content: center;
  pointer-events: none;
  position: absolute;
`;

const StyledDrawer = styled.aside`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex: none;
  flex-direction: column;
  gap: ${t.spacing[3]};
  max-height: 100%;
  overflow-y: auto;
  padding: ${t.spacing[4]};
  width: ${DRAWER_WIDTH}px;
  &[data-overlay='true'] {
    bottom: ${t.spacing[3]};
    left: ${t.spacing[3]};
    position: fixed;
    right: ${t.spacing[3]};
    top: auto;
    width: auto;
    z-index: 20;
    box-shadow: ${t.boxShadow.strong};
  }
`;

const StyledDrawerHead = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${t.spacing[2]};
  justify-content: space-between;
  h3 {
    font-size: ${t.font.size.lg};
    font-weight: ${t.font.weight.semiBold};
    line-height: 1.3;
    margin: 0;
    overflow-wrap: anywhere;
  }
`;

const StyledDrawerRows = styled.dl`
  display: grid;
  gap: ${t.spacing[2]} ${t.spacing[3]};
  grid-template-columns: max-content minmax(0, 1fr);
  margin: 0;
  dt {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    padding-top: 2px;
  }
  dd {
    font-size: ${t.font.size.sm};
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  a {
    color: ${ACCENT};
    text-decoration: none;
  }
  a:hover {
    text-decoration: underline;
  }
`;

const StyledDrawerActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
  margin-top: auto;
`;

type ViewMode = 'week' | 'day';

const RECORD_FIELDS = {
  id: true,
  name: true,
  startsAt: true,
  endsAt: true,
  bookingType: true,
  status: true,
  closer: true,
  closerId: true,
  inviteeName: true,
  inviteeEmail: true,
  eventName: true,
  recording: true,
  joinLink: true,
  personId: true,
};

// A status the server adds before the front knows it must not take the calendar down.
const statusMeta = (status: BookingStatus | null) =>
  BOOKING_STATUS_META[status ?? 'UPCOMING'] ?? { label: status ?? 'Unknown', color: BOOKING_STATUS_META.UPCOMING.color };
const statusColor = (status: BookingStatus | null) => statusMeta(status).color;
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export const BookingsCalendar = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<ViewMode>(isMobile ? 'day' : 'week');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [closerFilter, setCloserFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<BookingType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>(
    'all',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closers, setClosers] = useState<Closer[]>([]);
  const [closersError, setClosersError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    fetchClosers()
      .then(setClosers)
      .catch((error: Error) => setClosersError(error.message));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  const days = mode === 'week' ? 7 : 1;
  const rangeStart = mode === 'week' ? startOfWeek(anchor) : startOfDay(anchor);
  const rangeEnd = addDays(rangeStart, days);
  const dayList = useMemo(
    () =>
      Array.from({ length: days }, (_, index) => addDays(rangeStart, index)),
    [rangeStart.getTime(), days],
  );

  const { records, loading, error, hasNextPage, fetchMoreRecords } =
    useFindManyRecords<BookingRecord>({
      objectNameSingular: 'booking',
      // Twenty allows one operator per field filter, so the range is two clauses.
      filter: {
        and: [
          { startsAt: { gte: rangeStart.toISOString() } },
          { startsAt: { lt: rangeEnd.toISOString() } },
        ],
      },
      orderBy: [{ startsAt: 'AscNullsLast' }],
      limit: 200,
      recordGqlFields: RECORD_FIELDS,
    });

  useEffect(() => {
    if (hasNextPage && !loading) fetchMoreRecords();
  }, [hasNextPage, loading, fetchMoreRecords]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'ArrowLeft')
        setAnchor((current) => addDays(current, -days));
      if (event.key === 'ArrowRight')
        setAnchor((current) => addDays(current, days));
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [days]);

  const activeClosers = useMemo(
    () => closers.filter((closer) => closer.active),
    [closers],
  );
  const colorByCloserId = useMemo(() => {
    const map = new Map<string, string>();
    activeClosers.forEach((closer, index) =>
      map.set(closer.id, closerColor(index)),
    );
    return map;
  }, [activeClosers]);
  const colorFor = (booking: BookingRecord) =>
    colorByCloserId.get(booking.closerId) ??
    'var(--t-font-color-light, #9ca3af)';

  const visible = useMemo(
    () =>
      records.filter(
        (booking) =>
          (closerFilter === 'all' || booking.closerId === closerFilter) &&
          (typeFilter === 'all' || booking.bookingType === typeFilter) &&
          (statusFilter === 'all' || booking.status === statusFilter),
      ),
    [records, closerFilter, typeFilter, statusFilter],
  );

  const placedByDay = useMemo(
    () =>
      dayList.map((day) =>
        placeBookings(
          visible.filter((booking) => sameDay(new Date(booking.startsAt), day)),
        ),
      ),
    [dayList, visible],
  );

  // The grid covers working hours by default and stretches only when a call falls outside them.
  const { firstHour, lastHour } = useMemo(() => {
    let first = DEFAULT_FIRST_HOUR;
    let last = DEFAULT_LAST_HOUR;
    for (const placed of placedByDay.flat()) {
      first = Math.min(first, Math.floor(placed.startMinutes / 60));
      last = Math.max(last, Math.ceil(placed.endMinutes / 60));
    }
    return { firstHour: first, lastHour: Math.min(24, last) };
  }, [placedByDay]);
  const hours = lastHour - firstHour;

  const counts = useMemo(() => {
    const tally = {
      booked: visible.length,
      showed: 0,
      noShow: 0,
      upcoming: 0,
      cancelled: 0,
    };
    for (const booking of visible) {
      if (booking.status === 'SHOWED' || booking.status === 'COMPLETED') tally.showed++;
      else if (booking.status === 'NO_SHOW') tally.noShow++;
      else if (
        booking.status === 'UPCOMING' ||
        booking.status === 'IN_PROGRESS'
      )
        tally.upcoming++;
      else if (
        booking.status === 'CANCELLED' ||
        booking.status === 'RESCHEDULED'
      )
        tally.cancelled++;
    }
    return tally;
  }, [visible]);

  const selected = selectedId
    ? (records.find((booking) => booking.id === selectedId) ?? null)
    : null;
  const isToday = (day: Date) => sameDay(day, now);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef(true);
  useEffect(() => {
    pendingScrollRef.current = true;
  }, [rangeStart.getTime(), mode]);
  useEffect(() => {
    if (loading || !pendingScrollRef.current || !scrollerRef.current) return;
    const earliest = Math.min(
      ...placedByDay.flat().map((placed) => placed.startMinutes),
      Number.POSITIVE_INFINITY,
    );
    const target = Number.isFinite(earliest) ? earliest - 45 : 9 * 60;
    scrollerRef.current.scrollTo({
      top: Math.max(0, (target - firstHour * 60) * (HOUR_HEIGHT / 60)),
    });
    pendingScrollRef.current = false;
  }, [loading, placedByDay, firstHour]);
  const nowOffset = (minutesIntoDay(now) - firstHour * 60) * (HOUR_HEIGHT / 60);

  const rangeLabel =
    mode === 'week'
      ? formatRange(rangeStart, addDays(rangeEnd, -1))
      : formatDayLong(rangeStart);

  return (
    <StyledLayout>
      <StyledMain>
        {(error || closersError) && (
          <StyledError>{error?.message ?? closersError}</StyledError>
        )}
        <StyledToolbar>
          <StyledToolbarGroup>
            <Button
              size="small"
              variant="secondary"
              Icon={IconChevronLeft}
              onClick={() => setAnchor(addDays(anchor, -days))}
              ariaLabel="Previous"
            />
            <Button
              size="small"
              variant="secondary"
              title="Today"
              onClick={() => setAnchor(startOfDay(new Date()))}
            />
            <Button
              size="small"
              variant="secondary"
              Icon={IconChevronRight}
              onClick={() => setAnchor(addDays(anchor, days))}
              ariaLabel="Next"
            />
            <StyledField>
              <input
                type="date"
                value={isoDate(anchor)}
                onChange={(event) => {
                  const [y, m, d] = event.target.value.split('-').map(Number);
                  if (y && m && d) setAnchor(new Date(y, m - 1, d));
                }}
              />
            </StyledField>
            <StyledRangeLabel>
              {rangeLabel}
              <span>
                {loading
                  ? ' · loading'
                  : ` · ${visible.length} booking${visible.length === 1 ? '' : 's'}`}
              </span>
            </StyledRangeLabel>
          </StyledToolbarGroup>
          <StyledToolbarGroup>
            <PillButton
              active={mode === 'week'}
              title="Week"
              onClick={() => setMode('week')}
            />
            <PillButton
              active={mode === 'day'}
              title="Day"
              onClick={() => setMode('day')}
            />
          </StyledToolbarGroup>
          <StyledToolbarGroup>
            <PillButton
              active={closerFilter === 'all'}
              title="All closers"
              onClick={() => setCloserFilter('all')}
            />
            {activeClosers.map((closer) => (
              <Button
                key={closer.id}
                size="small"
                variant={closerFilter === closer.id ? 'primary' : 'secondary'}
                accent={closerFilter === closer.id ? 'blue' : 'default'}
                title={closer.name.split(' ')[0]}
                Icon={() => (
                  <StyledCloserDot
                    style={{
                      ['--closer-color' as string]: colorByCloserId.get(
                        closer.id,
                      ),
                    }}
                  />
                )}
                onClick={() =>
                  setCloserFilter(
                    closerFilter === closer.id ? 'all' : closer.id,
                  )
                }
              />
            ))}
          </StyledToolbarGroup>
          <StyledToolbarSpacer />
          <StyledField>
            Type
            <OsSelect<BookingType | 'all'>
              id="calendar-type"
              value={typeFilter}
              onChange={setTypeFilter}
              options={[
                { value: 'all', label: 'All' },
                ...(Object.keys(BOOKING_TYPE_LABELS) as BookingType[]).map(
                  (type) => ({ value: type, label: BOOKING_TYPE_LABELS[type] }),
                ),
              ]}
            />
          </StyledField>
          <StyledField>
            Status
            <OsSelect<BookingStatus | 'all'>
              id="calendar-status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All' },
                ...(Object.keys(BOOKING_STATUS_META) as BookingStatus[]).map(
                  (status) => ({
                    value: status,
                    label: BOOKING_STATUS_META[status].label,
                  }),
                ),
              ]}
            />
          </StyledField>
        </StyledToolbar>

        <StyledSummary>
          <StyledChip>{counts.booked} booked</StyledChip>
          <StyledChip data-tone="positive">{counts.showed} showed</StyledChip>
          <StyledChip data-tone="negative">{counts.noShow} no show</StyledChip>
          <StyledChip>{counts.upcoming} upcoming</StyledChip>
          <StyledMuted>{counts.cancelled} cancelled or rescheduled</StyledMuted>
        </StyledSummary>

        <StyledGridFrame>
          <StyledDayHeader days={days}>
            <div />
            {dayList.map((day, index) => (
              <StyledDayHeaderCell
                key={day.toISOString()}
                data-today={isToday(day)}
              >
                {day.toLocaleDateString([], { weekday: 'short' })}
                <span data-date>{day.getDate()}</span>
                {placedByDay[index].length > 0 && (
                  <span data-count>{placedByDay[index].length}</span>
                )}
              </StyledDayHeaderCell>
            ))}
          </StyledDayHeader>
          <StyledScroller ref={scrollerRef}>
            <StyledGrid days={days} hours={hours}>
              <StyledGutter>
                {Array.from(
                  { length: hours + 1 },
                  (_, index) => firstHour + index,
                ).map((hour) => (
                  <span
                    key={hour}
                    style={{ top: (hour - firstHour) * HOUR_HEIGHT }}
                  >
                    {hour === firstHour || hour === lastHour
                      ? ''
                      : formatTime(new Date(2000, 0, 1, hour))}
                  </span>
                ))}
              </StyledGutter>
              {dayList.map((day, dayIndex) => (
                <StyledDayColumn
                  key={day.toISOString()}
                  data-today={isToday(day)}
                  data-weekend={day.getDay() === 0 || day.getDay() === 6}
                >
                  {Array.from({ length: hours }, (_, index) => (
                    <div
                      key={index}
                      data-hour-line
                      style={{ top: index * HOUR_HEIGHT }}
                    />
                  ))}
                  {isToday(day) &&
                    nowOffset >= 0 &&
                    nowOffset <= hours * HOUR_HEIGHT && (
                      <StyledNowLine style={{ top: nowOffset }} />
                    )}
                  {placedByDay[dayIndex].map((placed: PlacedBooking) => {
                    const { booking } = placed;
                    const top =
                      (placed.startMinutes - firstHour * 60) *
                      (HOUR_HEIGHT / 60);
                    const height = Math.max(
                      26,
                      (placed.endMinutes - placed.startMinutes) *
                        (HOUR_HEIGHT / 60) -
                        2,
                    );
                    const width = 100 / placed.columns;
                    const start = new Date(booking.startsAt);
                    return (
                      <StyledEvent
                        key={booking.id}
                        type="button"
                        data-selected={selectedId === booking.id}
                        data-status={booking.status ?? 'UPCOMING'}
                        title={`${booking.inviteeName || booking.name} · ${BOOKING_TYPE_LABELS[booking.bookingType ?? 'OTHER']} · ${booking.closer}`}
                        style={{
                          top,
                          height,
                          left: `calc(${placed.column * width}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                          ['--closer-color' as string]: colorFor(booking),
                          ['--status-color' as string]: statusColor(
                            booking.status,
                          ),
                        }}
                        onClick={() =>
                          setSelectedId(
                            selectedId === booking.id ? null : booking.id,
                          )
                        }
                      >
                        <span data-line>
                          <span data-time>{formatTime(start)}</span>
                          <span data-name>
                            {booking.inviteeName || booking.name}
                          </span>
                          {placed.columns <= 2 && (
                            <span data-closer>
                              {initialsOf(booking.closer)}
                            </span>
                          )}
                        </span>
                        {height >= 46 && (
                          <span data-kind>
                            {
                              BOOKING_TYPE_LABELS[
                                booking.bookingType ?? 'OTHER'
                              ]
                            }
                            {placed.columns === 1
                              ? ` · ${booking.closer.split(' ')[0]}`
                              : ''}
                          </span>
                        )}
                      </StyledEvent>
                    );
                  })}
                </StyledDayColumn>
              ))}
            </StyledGrid>
            {!loading && visible.length === 0 && (
              <StyledEmpty>
                No bookings {mode === 'week' ? 'this week' : 'on this day'}.
              </StyledEmpty>
            )}
          </StyledScroller>
        </StyledGridFrame>
      </StyledMain>

      {selected && (
        <StyledReveal>
          <StyledDrawer data-overlay={isMobile}>
            <StyledDrawerHead>
              <div>
                <StyledChip style={{ color: statusColor(selected.status) }}>
                  {statusMeta(selected.status).label}
                </StyledChip>
                <h3 style={{ marginTop: 6 }}>
                  {selected.inviteeName || selected.name}
                </h3>
              </div>
              <Button
                size="small"
                variant="tertiary"
                Icon={IconX}
                onClick={() => setSelectedId(null)}
                ariaLabel="Close"
              />
            </StyledDrawerHead>
            <StyledDrawerRows>
              <dt>When</dt>
              <dd>
                {formatDayLong(new Date(selected.startsAt))}
                <br />
                {formatTime(new Date(selected.startsAt))}
                {selected.endsAt
                  ? ` – ${formatTime(new Date(selected.endsAt))}`
                  : ''}
              </dd>
              <dt>Type</dt>
              <dd>
                {BOOKING_TYPE_LABELS[selected.bookingType ?? 'OTHER']}
                {selected.eventName ? (
                  <StyledMuted> · {selected.eventName}</StyledMuted>
                ) : null}
              </dd>
              <dt>Closer</dt>
              <dd>
                <StyledCloserDot
                  style={{ ['--closer-color' as string]: colorFor(selected) }}
                />
                {selected.closer || 'Unassigned'}
              </dd>
              <dt>Email</dt>
              <dd>
                {selected.inviteeEmail ? (
                  <a href={`mailto:${selected.inviteeEmail}`}>
                    {selected.inviteeEmail}
                  </a>
                ) : (
                  <StyledMuted>Unknown</StyledMuted>
                )}
              </dd>
            </StyledDrawerRows>
            <StyledDrawerActions>
              {selected.status === 'UPCOMING' &&
                selected.joinLink?.primaryLinkUrl && (
                  <Button
                    size="small"
                    variant="primary"
                    accent="blue"
                    Icon={IconVideo}
                    title="Join call"
                    onClick={() =>
                      window.open(
                        selected.joinLink?.primaryLinkUrl ?? '',
                        '_blank',
                        'noopener',
                      )
                    }
                  />
                )}
              {selected.recording?.primaryLinkUrl && (
                <Button
                  size="small"
                  variant="secondary"
                  Icon={IconVideo}
                  title="Recording"
                  onClick={() =>
                    window.open(
                      selected.recording?.primaryLinkUrl ?? '',
                      '_blank',
                      'noopener',
                    )
                  }
                />
              )}
              {selected.personId && (
                <Button
                  size="small"
                  variant="secondary"
                  Icon={IconUserCircle}
                  title="Open person"
                  onClick={() =>
                    navigate(`/object/person/${selected.personId}`)
                  }
                />
              )}
              <Button
                size="small"
                variant="secondary"
                Icon={IconExternalLink}
                title="Booking record"
                onClick={() => navigate(`/object/booking/${selected.id}`)}
              />
            </StyledDrawerActions>
          </StyledDrawer>
        </StyledReveal>
      )}
    </StyledLayout>
  );
};
