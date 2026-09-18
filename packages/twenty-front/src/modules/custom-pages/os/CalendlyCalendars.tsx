import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { IconExternalLink, IconX } from 'twenty-ui/icon';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { osRpc } from '@/custom-pages/os/transport';
import { OsSelect } from '@/custom-pages/os/OsSelect';
import { StyledMuted } from '@/custom-pages/os/ui';

type CalendlyEventType = {
  uri: string;
  name: string;
  active: boolean;
  duration: number;
  kind: string;
  url: string | null;
  hosts: string;
  recent: number;
  booking_type: string | null;
};

// The three sales calendars drive stages, pre-call emails, no-show follow-up and closer stats.
// Only calendars attached here (plus the fixed support calendars named below) are saved to the CRM.
const SLOTS: { value: string; label: string }[] = [
  { value: 'DISCOVERY', label: 'DFY discovery' },
  { value: 'DEMO', label: 'Software demo' },
  { value: 'AGENCY_DEMO', label: 'Agency demo' },
];

const shortUrl = (row: CalendlyEventType) =>
  row.url
    ? row.url.replace(/^https?:\/\/(www\.)?calendly\.com\//, '')
    : (row.uri.split('/').pop() ?? row.uri);

export const CalendlyCalendars = () => {
  const [rows, setRows] = useState<CalendlyEventType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(
        (await osRpc<CalendlyEventType[]>('get_calendly_event_types')) ?? [],
      );
      setError(null);
    } catch (loadError) {
      setError((loadError as Error).message);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const assign = async (uri: string, bookingType: string | null) => {
    setSaving(uri);
    try {
      await osRpc('set_calendly_event_type', {
        p_uri: uri,
        p_booking_type: bookingType,
      });
      setRows((current) =>
        (current ?? []).map((row) =>
          row.uri === uri ? { ...row, booking_type: bookingType } : row,
        ),
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const unattached = (rows ?? []).filter((row) => row.booking_type === null);

  return (
    <StyledSection>
      <div>
        <h3>Calendars</h3>
        <StyledMuted>
          Which Calendly calendar is which sales call. Diagnostics, next steps,
          set-up, onboarding, feedback and webinar calendars are recognised by
          name; 30-minute meetings and recruitment calendars stay out of the
          CRM.
        </StyledMuted>
      </div>
      {error && <StyledMuted data-tone="negative">{error}</StyledMuted>}
      {rows === null && <StyledMuted>Loading…</StyledMuted>}
      {rows !== null && (
        <StyledSlots>
          {SLOTS.map((slot) => {
            const attached = rows.filter(
              (row) => row.booking_type === slot.value,
            );
            return (
              <StyledSlot key={slot.value}>
                <StyledSlotTitle>{slot.label}</StyledSlotTitle>
                {attached.map((row) => (
                  <StyledCalendar key={row.uri} data-inactive={!row.active}>
                    <div>
                      <StyledName>{row.name}</StyledName>
                      <StyledMuted>
                        {row.hosts || 'no host yet'} · {row.recent} booking
                        {row.recent === 1 ? '' : 's'} in 180 d
                        {!row.active ? ' · inactive in Calendly' : ''}
                      </StyledMuted>
                      {row.url && (
                        <StyledUrl
                          href={row.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.url.replace(/^https?:\/\//, '')}{' '}
                          <IconExternalLink size={12} />
                        </StyledUrl>
                      )}
                    </div>
                    <StyledRemove
                      type="button"
                      title="Detach"
                      disabled={saving === row.uri}
                      onClick={() => void assign(row.uri, null)}
                    >
                      <IconX size={14} />
                    </StyledRemove>
                  </StyledCalendar>
                ))}
                {attached.length === 0 && (
                  <StyledMuted>No calendar attached</StyledMuted>
                )}
                <OsSelect
                  id={`calendar-${slot.value}`}
                  value=""
                  disabled={saving !== null || unattached.length === 0}
                  withSearch
                  fullWidth
                  options={[
                    {
                      value: '',
                      label: attached.length
                        ? 'Attach another calendar…'
                        : 'Attach a calendar…',
                    },
                    ...unattached.map((row) => ({
                      value: row.uri,
                      label: `${row.name} · ${shortUrl(row)}${row.recent ? ` · ${row.recent} recent` : ''}`,
                    })),
                  ]}
                  onChange={(value) => {
                    if (value) void assign(value, slot.value);
                  }}
                />
              </StyledSlot>
            );
          })}
        </StyledSlots>
      )}
    </StyledSection>
  );
};

const StyledSection = styled.section`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  padding: ${t.spacing[4]};

  h3 {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.semiBold};
    margin: 0 0 ${t.spacing[1]};
  }
`;

const StyledSlots = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
`;

const StyledSlot = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  padding: ${t.spacing[3]};
`;

const StyledSlotTitle = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  font-weight: ${t.font.weight.medium};
`;

const StyledCalendar = styled.div`
  align-items: flex-start;
  background: ${t.background.transparent.lighter};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.sm};
  display: flex;
  gap: ${t.spacing[2]};
  justify-content: space-between;
  padding: ${t.spacing[2]};

  &[data-inactive='true'] {
    opacity: 0.7;
  }
`;

const StyledName = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
`;

const StyledUrl = styled.a`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: inline-flex;
  font-size: ${t.font.size.xs};
  gap: 4px;
  margin-top: 2px;
  text-decoration: none;
  word-break: break-all;

  &:hover {
    color: ${t.font.color.primary};
    text-decoration: underline;
  }
`;

const StyledRemove = styled.button`
  align-items: center;
  background: none;
  border: none;
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.light};
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  height: 22px;
  justify-content: center;
  padding: 0;
  width: 22px;

  &:hover {
    background: ${t.background.transparent.medium};
    color: ${t.font.color.primary};
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;
