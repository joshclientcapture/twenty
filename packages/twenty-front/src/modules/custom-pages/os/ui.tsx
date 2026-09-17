import { styled } from '@linaria/react';
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconArrowUpRight } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

/* Shared building blocks for the Conversifi OS pages ported into Twenty.
   Everything here uses Twenty's own theme tokens so the pages read as native. */

export const ACCENT = 'var(--t-color-blue, #1b4498)';
export const POSITIVE = t.tag.text.green;
export const CAUTION = t.tag.text.orange;

// Motion values (better-ui / emil-design-eng): exact, not approximate.
// Press feedback is always scale 0.96; entrances use a strong ease-out; hover/colour
// changes get ≤150ms on named properties only, never `transition: all`.
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const PRESS_SCALE = '0.96';

// Drill-down routes that exist in the CRM. Anything else stays a plain (unlinked) tile.
const PORTED_PREFIXES = ['/records', '/sales', '/therapon'];
export const internalHref = (to?: string) =>
  to && PORTED_PREFIXES.some((p) => to === p || to.startsWith(p + '?') || to.startsWith(p + '/')) ? to : undefined;

export const fmtUsd = (n: number) => '$' + Math.round(n).toLocaleString();
export const fmtUsd2 = (n: number) => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtWhen = (s: string | null) =>
  s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
export const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
export const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

/* ---------------- page chrome ---------------- */
export const StyledPage = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: ${t.background.noisy};
  color: ${t.font.color.primary};
  font-family: ${t.font.family};
  font-size: ${t.font.size.md};
`;

export const StyledBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${t.spacing[4]};
`;

export const StyledContent = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[4]};
  margin: 0 auto;
  max-width: 1240px;
  width: 100%;
`;

export const StyledHeaderActions = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[3]};
`;

export const StyledHeaderMeta = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  white-space: nowrap;
  span {
    color: ${t.font.color.secondary};
    font-variant-numeric: tabular-nums;
  }
`;

export const StyledProgress = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[1]};
  width: 200px;
  div[data-track] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.pill};
    height: 3px;
    overflow: hidden;
    width: 100%;
  }
  div[data-fill] {
    background: ${ACCENT};
    height: 100%;
    transition: width 0.3s ease-out;
  }
`;

/* ---------------- cards & text ---------------- */
export const StyledCard = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: ${t.spacing[4]};
  min-width: 0;
`;

export const StyledCardHead = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: ${t.spacing[3]};
  gap: ${t.spacing[2]};
  flex-wrap: wrap;
`;

export const StyledCardTitle = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.md};
  font-weight: ${t.font.weight.medium};
`;

export const StyledCardHint = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  text-align: right;
`;

export const StyledLabel = styled.div`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.medium};
`;

export const StyledBigValue = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.xl};
  font-weight: ${t.font.weight.semiBold};
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
`;

export const StyledSub = styled.span`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin-left: ${t.spacing[2]};
`;

export const StyledMuted = styled.span`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
`;

export const StyledPositive = styled.span`
  color: ${POSITIVE};
`;

export const StyledCaution = styled.span`
  color: ${CAUTION};
`;

export const StyledError = styled.div`
  background: ${t.background.transparent.danger};
  border: 1px solid ${t.border.color.danger};
  border-radius: ${t.border.radius.md};
  color: ${t.font.color.danger};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[3]};
`;

export const StyledNotice = styled.div`
  background: ${t.background.transparent.orange};
  border: 1px solid ${CAUTION};
  border-radius: ${t.border.radius.md};
  color: ${CAUTION};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[2]} ${t.spacing[3]};
`;

export const StyledFootnote = styled.p`
  color: ${t.font.color.tertiary};
  font-size: ${t.font.size.xs};
  margin: ${t.spacing[4]} 0 0;
`;

/* ---------------- layout ---------------- */
export const StyledGrid2 = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
`;

export const StyledGrid3 = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
`;

export const StyledGrid4 = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(4, minmax(0, 1fr));
  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

export const StyledGrid5 = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(5, minmax(0, 1fr));
  @media (max-width: 640px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

export const StyledGrid6 = styled.div`
  display: grid;
  gap: ${t.spacing[3]};
  grid-template-columns: repeat(6, minmax(0, 1fr));
  @media (max-width: 640px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
`;

export const StyledRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[2]};
`;

export const StyledDivider = styled.span`
  background: ${t.border.color.medium};
  height: 16px;
  margin: 0 ${t.spacing[1]};
  width: 1px;
`;

export const StyledStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[4]};
`;

/* ---------------- KPI tile ---------------- */
export const StyledTile = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  box-sizing: border-box;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[2]};
  height: 100%;
  min-height: 92px;
  min-width: 0;
  padding: ${t.spacing[3]};
  transition-property: background-color, border-color, scale;
  transition-duration: 100ms, 100ms, 150ms;
  transition-timing-function: ease, ease, ease-out;
  &[data-clickable] {
    cursor: pointer;
  }
  /* hover gated to real pointers so a tap on touch doesn't leave a stuck hover */
  @media (hover: hover) and (pointer: fine) {
    &[data-clickable]:hover {
      background: ${t.background.transparent.light};
      border-color: ${t.border.color.strong};
    }
  }
  &[data-clickable]:active {
    scale: ${PRESS_SCALE};
  }
  @media (prefers-reduced-motion: reduce) {
    &[data-clickable]:active {
      scale: none;
    }
  }
  div[data-label] {
    align-items: center;
    color: ${t.font.color.tertiary};
    display: flex;
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
    gap: ${t.spacing[1]};
    justify-content: space-between;
    min-width: 0;
    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }
  div[data-value] {
    color: ${t.font.color.primary};
    font-size: clamp(15px, 1.6vw, 20px);
    font-weight: ${t.font.weight.semiBold};
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
    margin-top: auto;
  }
  div[data-value='positive'] {
    color: ${POSITIVE};
  }
  div[data-value='caution'] {
    color: ${CAUTION};
  }
  div[data-delta] {
    font-size: ${t.font.size.xs};
    color: ${t.font.color.tertiary};
  }
  div[data-delta='positive'] {
    color: ${POSITIVE};
  }
  div[data-delta='caution'] {
    color: ${CAUTION};
  }
`;

const StyledTileLink = styled(Link)`
  color: inherit;
  display: block;
  height: 100%;
  text-decoration: none;
`;

export type Kpi = {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: 'positive' | 'caution';
  valueTone?: 'positive' | 'caution';
  to?: string;
};

export const KpiTile = ({ kpi }: { kpi: Kpi }) => {
  const href = internalHref(kpi.to);
  const tile = (
    <StyledTile data-clickable={href ? '' : undefined}>
      <div data-label>
        <span>{kpi.label}</span>
        {href && <IconArrowUpRight size={12} />}
      </div>
      {/* '' keeps the attribute present (so [data-value] styles apply) when there is no tone */}
      <div data-value={kpi.valueTone ?? ''}>{kpi.value}</div>
      {kpi.delta !== undefined && <div data-delta={kpi.tone ?? ''}>{kpi.delta}</div>}
    </StyledTile>
  );
  return href ? <StyledTileLink to={href}>{tile}</StyledTileLink> : tile;
};

/* ---------------- controls ---------------- */
export const PillButton = ({ active, onClick, title, disabled }: { active: boolean; onClick: () => void; title: string; disabled?: boolean }) => (
  <Button
    size="small"
    variant={active ? 'primary' : 'secondary'}
    accent={active ? 'blue' : 'default'}
    title={title}
    onClick={onClick}
    disabled={disabled}
  />
);

export const StyledField = styled.label`
  align-items: center;
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.sm};
  gap: ${t.spacing[1]};
  input,
  select {
    background: ${t.background.primary};
    border: 1px solid ${t.border.color.medium};
    border-radius: ${t.border.radius.sm};
    box-sizing: border-box;
    color: ${t.font.color.primary};
    font-family: inherit;
    font-size: ${t.font.size.sm};
    height: 24px;
    outline: none;
    padding: 0 ${t.spacing[2]};
  }
  input:focus,
  select:focus {
    border-color: ${t.border.color.blue};
  }
  input[data-invalid] {
    border-color: ${CAUTION};
  }
`;

/* ---------------- tables ---------------- */
export const StyledTable = styled.table`
  border-collapse: collapse;
  font-size: ${t.font.size.sm};
  width: 100%;
  th {
    border-bottom: 1px solid ${t.border.color.light};
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-weight: ${t.font.weight.medium};
    padding: 0 ${t.spacing[2]} ${t.spacing[2]};
    text-align: left;
    white-space: nowrap;
  }
  th[data-right],
  td[data-right] {
    text-align: right;
  }
  td {
    border-bottom: 1px solid ${t.border.color.light};
    color: ${t.font.color.primary};
    font-variant-numeric: tabular-nums;
    padding: ${t.spacing[2]};
    text-align: left;
    vertical-align: middle;
  }
  tr:last-child td {
    border-bottom: 0;
  }
  td[data-muted] {
    color: ${t.font.color.secondary};
  }
  td[data-positive] {
    color: ${POSITIVE};
  }
  td[data-accent] {
    color: ${ACCENT};
  }
  tbody tr[data-clickable] {
    cursor: pointer;
    transition-property: background-color;
    transition-duration: 100ms;
    transition-timing-function: ease;
  }
  @media (hover: hover) and (pointer: fine) {
    tbody tr[data-clickable]:hover {
      background: ${t.background.transparent.light};
    }
  }
  tbody tr[data-selected] {
    background: ${t.background.transparent.blue};
  }
  tbody tr[data-subrow] td {
    background: ${t.background.secondary};
  }
  th button {
    align-items: center;
    background: none;
    border: 0;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    gap: ${t.spacing[1]};
    padding: 0;
  }
  th button:hover {
    color: ${t.font.color.primary};
  }
  th button span[data-sort] {
    color: ${t.font.color.extraLight};
    font-size: 8px;
  }
  th button span[data-sort='on'] {
    color: ${ACCENT};
  }
`;

export const StyledTableCard = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  overflow: hidden;
  div[data-scroll] {
    overflow-x: auto;
    padding: ${t.spacing[2]} ${t.spacing[2]} 0;
  }
`;

export const StyledTextLink = styled(Link)`
  color: ${ACCENT};
  font-weight: ${t.font.weight.medium};
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

export const StyledExtLink = styled.a`
  color: ${ACCENT};
  font-size: ${t.font.size.sm};
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

/* ---------------- status chip ---------------- */
export const StyledChip = styled.span`
  align-items: center;
  border-radius: ${t.border.radius.sm};
  display: inline-flex;
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.medium};
  gap: ${t.spacing[1]};
  padding: 2px ${t.spacing[2]};
  white-space: nowrap;
  background: ${t.background.tertiary};
  color: ${t.font.color.secondary};
  &[data-tone='positive'] {
    background: ${t.background.transparent.success};
    color: ${POSITIVE};
  }
  &[data-tone='caution'] {
    background: ${t.background.transparent.orange};
    color: ${CAUTION};
  }
  &[data-tone='accent'] {
    background: ${t.background.transparent.blue};
    color: ${ACCENT};
  }
  &[data-tone='negative'] {
    background: ${t.background.transparent.danger};
    color: var(--t-tag-text-red);
  }
  &[data-button] {
    cursor: pointer;
    border: 1px solid transparent;
    transition-property: border-color, scale;
    transition-duration: 100ms, 150ms;
    transition-timing-function: ease, ease-out;
  }
  @media (hover: hover) and (pointer: fine) {
    &[data-button]:hover {
      border-color: ${t.border.color.strong};
    }
  }
  &[data-button]:active {
    scale: ${PRESS_SCALE};
  }
  @media (prefers-reduced-motion: reduce) {
    &[data-button]:active {
      scale: none;
    }
  }
`;

/* One-shot entrance for content that expands into view (an inline editor, a notice).
   Keyframes are right here: it runs once per open, is not interruptible-by-design,
   and stays under 300ms. Exit is immediate — the user's attention has already moved. */
export const StyledReveal = styled.div`
  animation: os-reveal 160ms ${EASE_OUT} both;
  @keyframes os-reveal {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @keyframes os-reveal-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    animation-name: os-reveal-fade;
  }
`;

/* ---------------- bar rows ---------------- */
export const StyledBars = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[3]};
  div[data-row] {
    align-items: center;
    display: grid;
    gap: ${t.spacing[3]};
    grid-template-columns: minmax(150px, 210px) 1fr 56px 40px;
  }
  div[data-stage] {
    color: ${t.font.color.secondary};
    font-size: ${t.font.size.sm};
    em {
      color: ${POSITIVE};
      font-size: ${t.font.size.xs};
      font-style: normal;
      margin-left: ${t.spacing[1]};
    }
  }
  div[data-track] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.pill};
    height: 8px;
    overflow: hidden;
  }
  div[data-fill] {
    background: ${ACCENT};
    border-radius: ${t.border.radius.pill};
    height: 100%;
  }
  div[data-fill='muted'] {
    background: ${t.font.color.extraLight};
  }
  div[data-fill='positive'] {
    background: ${POSITIVE};
  }
  div[data-fill='caution'] {
    background: ${CAUTION};
  }
  div[data-num] {
    color: ${t.font.color.primary};
    font-size: ${t.font.size.sm};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  div[data-pct] {
    color: ${t.font.color.tertiary};
    font-size: ${t.font.size.xs};
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
`;

export const StyledFooter = styled.div`
  border-top: 1px solid ${t.border.color.light};
  color: ${t.font.color.tertiary};
  display: flex;
  font-size: ${t.font.size.xs};
  justify-content: space-between;
  margin-top: ${t.spacing[4]};
  padding-top: ${t.spacing[3]};
  b {
    color: ${POSITIVE};
    font-weight: ${t.font.weight.medium};
  }
`;
