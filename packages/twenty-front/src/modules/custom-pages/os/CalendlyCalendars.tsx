import { styled } from '@linaria/react';
import { useEffect, useState } from 'react';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { osRpc } from '@/custom-pages/os/transport';
import { StyledMuted, StyledTable } from '@/custom-pages/os/ui';

type CalendlyEventType = {
  uri: string;
  name: string;
  active: boolean;
  duration: number;
  kind: string;
  hosts: string;
  recent: number;
  booking_type: string | null;
};

// Mirrors the Booking object's type options; "Auto" leaves the choice to the event name.
const BOOKING_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'Auto (by name)' },
  { value: 'DISCOVERY', label: 'DFY discovery' },
  { value: 'DEMO', label: 'Software demo' },
  { value: 'AGENCY_DEMO', label: 'Agency demo' },
  { value: 'WEBINAR', label: 'Webinar' },
  { value: 'SETUP_CALL', label: 'Set-up call' },
  { value: 'ONBOARDING', label: 'Onboarding' },
  { value: 'DIAGNOSTICS', label: 'Diagnostics' },
  { value: 'FEEDBACK', label: 'Feedback' },
  { value: 'NEXT_STEPS', label: 'Next steps' },
  { value: 'OTHER', label: 'Other' },
];

// Admin section on the Closers page: which Calendly event type counts as which kind of call.
// The mapping drives Booking.bookingType, so the pre-call sequences follow a renamed or new
// calendar without a code change.
export const CalendlyCalendars = () => {
  const [rows, setRows] = useState<CalendlyEventType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

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

  const save = async (uri: string, bookingType: string) => {
    setSaving(uri);
    try {
      await osRpc('set_calendly_event_type', {
        p_uri: uri,
        p_booking_type: bookingType || null,
      });
      setRows((current) =>
        (current ?? []).map((row) =>
          row.uri === uri ? { ...row, booking_type: bookingType || null } : row,
        ),
      );
    } catch (saveError) {
      setError((saveError as Error).message);
    } finally {
      setSaving(null);
    }
  };

  const visible = (rows ?? []).filter(
    (row) => showAll || row.recent > 0 || row.booking_type !== null,
  );

  return (
    <StyledSection>
      <StyledHeading>
        <div>
          <h3>Calendars</h3>
          <StyledMuted>
            Which Calendly event is which kind of call. Renaming or replacing a
            calendar only needs a change here.
          </StyledMuted>
        </div>
        <StyledLink type="button" onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Hide unused' : `Show all (${rows?.length ?? 0})`}
        </StyledLink>
      </StyledHeading>
      {error && <StyledMuted data-tone="negative">{error}</StyledMuted>}
      <StyledTable>
        <thead>
          <tr>
            <th>Calendly event</th>
            <th>Hosts</th>
            <th data-right>Bookings (180 d)</th>
            <th>Counts as</th>
          </tr>
        </thead>
        <tbody>
          {rows === null && (
            <tr>
              <td colSpan={4} data-muted>
                Loading…
              </td>
            </tr>
          )}
          {visible.map((row) => (
            <tr key={row.uri} data-inactive={!row.active}>
              <td>
                <StyledName>{row.name}</StyledName>
                <StyledMuted>
                  {row.duration} min · {row.kind}
                  {!row.active ? ' · inactive' : ''}
                </StyledMuted>
              </td>
              <td data-muted>{row.hosts || '—'}</td>
              <td data-right>{row.recent}</td>
              <td>
                <StyledSelect
                  value={row.booking_type ?? ''}
                  disabled={saving === row.uri}
                  data-set={row.booking_type ? 'true' : 'false'}
                  onChange={(event) => void save(row.uri, event.target.value)}
                >
                  {BOOKING_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </StyledSelect>
              </td>
            </tr>
          ))}
          {rows !== null && visible.length === 0 && (
            <tr>
              <td colSpan={4} data-muted>
                No Calendly event types synced yet.
              </td>
            </tr>
          )}
        </tbody>
      </StyledTable>
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

  tr[data-inactive='true'] td {
    opacity: 0.6;
  }
`;

const StyledHeading = styled.div`
  align-items: flex-start;
  display: flex;
  gap: ${t.spacing[3]};
  justify-content: space-between;

  h3 {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.md};
    font-weight: ${t.font.weight.semiBold};
    margin: 0 0 ${t.spacing[1]};
  }
`;

const StyledLink = styled.button`
  background: none;
  border: none;
  color: ${t.font.color.tertiary};
  cursor: pointer;
  font-size: ${t.font.size.sm};
  padding: 0;
  white-space: nowrap;

  &:hover {
    color: ${t.font.color.primary};
  }
`;

const StyledName = styled.div`
  color: ${t.font.color.primary};
  font-weight: ${t.font.weight.medium};
`;

const StyledSelect = styled.select`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.secondary};
  font-size: ${t.font.size.sm};
  height: 28px;
  min-width: 160px;
  padding: 0 ${t.spacing[2]};

  &[data-set='true'] {
    color: ${t.font.color.primary};
    font-weight: ${t.font.weight.medium};
  }

  &:disabled {
    opacity: 0.6;
  }
`;
