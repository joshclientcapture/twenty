import { styled } from '@linaria/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { geoContains, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import landTopo from 'world-atlas/land-110m.json';
import { IconFocusCentered, IconMinus, IconPlus, IconRefresh, IconX } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { type CustomerPoint, fetchCustomerPoints, refreshMap } from '@/custom-pages/os/data';
import { fmtUsd, PillButton, StyledField, StyledMuted, StyledTextLink } from '@/custom-pages/os/ui';

// Country centroids for customers Stripe could not geocode past the country.
const COUNTRY: Record<string, { name: string; lat: number; lng: number }> = {
  US: { name: 'United States', lat: 39.8, lng: -98.6 }, GB: { name: 'United Kingdom', lat: 54, lng: -2 },
  CA: { name: 'Canada', lat: 56.1, lng: -106.3 }, AU: { name: 'Australia', lat: -25.3, lng: 133.8 },
  IE: { name: 'Ireland', lat: 53.4, lng: -8.2 }, NZ: { name: 'New Zealand', lat: -41, lng: 174 },
  DE: { name: 'Germany', lat: 51.2, lng: 10.4 }, FR: { name: 'France', lat: 46.6, lng: 2.2 },
  ES: { name: 'Spain', lat: 40.4, lng: -3.7 }, IT: { name: 'Italy', lat: 41.9, lng: 12.6 },
  NL: { name: 'Netherlands', lat: 52.1, lng: 5.3 }, BE: { name: 'Belgium', lat: 50.5, lng: 4.5 },
  PT: { name: 'Portugal', lat: 39.4, lng: -8.2 }, CH: { name: 'Switzerland', lat: 46.8, lng: 8.2 },
  AT: { name: 'Austria', lat: 47.5, lng: 14.6 }, SE: { name: 'Sweden', lat: 60.1, lng: 18.6 },
  NO: { name: 'Norway', lat: 60.5, lng: 8.5 }, DK: { name: 'Denmark', lat: 56.3, lng: 9.5 },
  FI: { name: 'Finland', lat: 61.9, lng: 25.7 }, PL: { name: 'Poland', lat: 51.9, lng: 19.1 },
  CZ: { name: 'Czechia', lat: 49.8, lng: 15.5 }, RO: { name: 'Romania', lat: 45.9, lng: 24.9 },
  GR: { name: 'Greece', lat: 39.1, lng: 21.8 }, HU: { name: 'Hungary', lat: 47.2, lng: 19.5 },
  HR: { name: 'Croatia', lat: 45.1, lng: 15.2 }, BG: { name: 'Bulgaria', lat: 42.7, lng: 25.5 },
  RS: { name: 'Serbia', lat: 44, lng: 21 }, SK: { name: 'Slovakia', lat: 48.7, lng: 19.7 },
  SI: { name: 'Slovenia', lat: 46.1, lng: 15 }, LT: { name: 'Lithuania', lat: 55.2, lng: 23.9 },
  LV: { name: 'Latvia', lat: 56.9, lng: 24.6 }, EE: { name: 'Estonia', lat: 58.6, lng: 25 },
  UA: { name: 'Ukraine', lat: 48.4, lng: 31.2 }, TR: { name: 'Turkey', lat: 38.9, lng: 35.2 },
  IL: { name: 'Israel', lat: 31, lng: 34.9 }, AE: { name: 'UAE', lat: 23.4, lng: 53.8 },
  SA: { name: 'Saudi Arabia', lat: 23.9, lng: 45.1 }, QA: { name: 'Qatar', lat: 25.4, lng: 51.2 },
  IN: { name: 'India', lat: 20.6, lng: 79 }, PK: { name: 'Pakistan', lat: 30.4, lng: 69.3 },
  SG: { name: 'Singapore', lat: 1.35, lng: 103.8 }, MY: { name: 'Malaysia', lat: 4.2, lng: 101.9 },
  ID: { name: 'Indonesia', lat: -0.8, lng: 113.9 }, PH: { name: 'Philippines', lat: 12.9, lng: 121.8 },
  TH: { name: 'Thailand', lat: 15.9, lng: 101 }, VN: { name: 'Vietnam', lat: 14.1, lng: 108.3 },
  JP: { name: 'Japan', lat: 36.2, lng: 138.3 }, KR: { name: 'South Korea', lat: 35.9, lng: 127.8 },
  CN: { name: 'China', lat: 35.9, lng: 104.2 }, HK: { name: 'Hong Kong', lat: 22.3, lng: 114.2 },
  ZA: { name: 'South Africa', lat: -30.6, lng: 22.9 }, NG: { name: 'Nigeria', lat: 9.1, lng: 8.7 },
  KE: { name: 'Kenya', lat: 0, lng: 37.9 }, EG: { name: 'Egypt', lat: 26.8, lng: 30.8 },
  MA: { name: 'Morocco', lat: 31.8, lng: -7.1 }, GH: { name: 'Ghana', lat: 7.9, lng: -1 },
  BR: { name: 'Brazil', lat: -14.2, lng: -51.9 }, MX: { name: 'Mexico', lat: 23.6, lng: -102.6 },
  AR: { name: 'Argentina', lat: -38.4, lng: -63.6 }, CL: { name: 'Chile', lat: -35.7, lng: -71.5 },
  CO: { name: 'Colombia', lat: 4.6, lng: -74.3 }, PE: { name: 'Peru', lat: -9.2, lng: -75 },
  MU: { name: 'Mauritius', lat: -20.3, lng: 57.6 }, MD: { name: 'Moldova', lat: 47.4, lng: 28.4 },
  JO: { name: 'Jordan', lat: 30.6, lng: 36.2 }, AL: { name: 'Albania', lat: 41.2, lng: 20.2 },
  RU: { name: 'Russia', lat: 61.5, lng: 105.3 }, TW: { name: 'Taiwan', lat: 23.7, lng: 121 },
};

const flag = (cc: string) => (cc && cc.length === 2 ? String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0))) : '🌐');
const countryName = (cc: string) => COUNTRY[cc]?.name ?? cc;
const jitter = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; return [((h % 100) / 100 - 0.5) * 6, (((h >> 8) % 100) / 100 - 0.5) * 6]; };
const coordFor = (p: CustomerPoint): [number, number] | null => {
  if (p.lat != null && p.lng != null) return [p.lat, p.lng];
  const c = COUNTRY[p.country];
  if (!c) return null;
  const j = jitter(p.customer_id);
  return [c.lat + j[0], c.lng + j[1]];
};

const W = 1000;
const H = 500;
const GRID_STEP = 1.7; // degrees between land dots; smaller = denser, slower to compute once
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
type Transform = { k: number; x: number; y: number };
const IDENTITY: Transform = { k: 1, x: 0, y: 0 };

const StyledFrame = styled.div`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.md};
  overflow: hidden;
  position: relative;
`;

const StyledToolbar = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing[2]};
  justify-content: space-between;
  left: ${t.spacing[3]};
  pointer-events: none;
  position: absolute;
  right: ${t.spacing[3]};
  top: ${t.spacing[3]};
  z-index: 2;
  > div { align-items: center; display: flex; gap: ${t.spacing[2]}; pointer-events: auto; }
`;

const StyledMap = styled.svg`
  cursor: grab;
  display: block;
  height: auto;
  touch-action: none;
  user-select: none;
  width: 100%;
  &[data-dragging] { cursor: grabbing; }
  circle[data-land] { fill: ${t.font.color.light}; opacity: 0.55; }
  circle[data-halo] { fill: ${t.color.blue}; opacity: 0.14; }
  circle[data-dot] {
    cursor: pointer;
    fill: ${t.color.blue};
    stroke: ${t.background.secondary};
    stroke-width: 1.5;
    transition-property: r;
    transition-duration: 120ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
  }
  circle[data-dot][data-on] { fill: ${t.tag.text.green}; }
  circle[data-dot]:focus-visible { outline: none; stroke: ${t.color.blue}; stroke-width: 3; }
  g[data-inactive] circle[data-dot] { fill: ${t.font.color.light}; }
  g[data-inactive] circle[data-halo] { fill: ${t.font.color.light}; }
`;

const StyledTooltip = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  box-shadow: ${t.boxShadow.light};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[1]} ${t.spacing[2]};
  pointer-events: none;
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  white-space: nowrap;
  z-index: 3;
  div[data-name] { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; }
  div[data-sub] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
`;

// Detail card for a pinned customer. Enters with a short fade and rise; exits by unmounting.
const StyledDetail = styled.div`
  animation: os-map-detail 160ms cubic-bezier(0.2, 0, 0, 1) both;
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  bottom: ${t.spacing[3]};
  box-shadow: ${t.boxShadow.strong};
  left: ${t.spacing[3]};
  max-width: 320px;
  padding: ${t.spacing[3]} ${t.spacing[4]};
  position: absolute;
  z-index: 3;
  @keyframes os-map-detail { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  div[data-head] { align-items: flex-start; display: flex; gap: ${t.spacing[2]}; justify-content: space-between; }
  div[data-name] { color: ${t.font.color.primary}; font-size: ${t.font.size.md}; font-weight: ${t.font.weight.semiBold}; }
  div[data-where] { color: ${t.font.color.secondary}; font-size: ${t.font.size.sm}; margin-top: 2px; }
  div[data-stats] { display: flex; gap: ${t.spacing[4]}; margin-top: ${t.spacing[2]}; }
  div[data-stats] div[data-k] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
  div[data-stats] div[data-v] { color: ${t.font.color.primary}; font-size: ${t.font.size.lg}; font-weight: ${t.font.weight.semiBold}; font-variant-numeric: tabular-nums; }
  div[data-foot] { margin-top: ${t.spacing[2]}; }
`;

const StyledZoom = styled.div`
  bottom: ${t.spacing[3]};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing[1]};
  position: absolute;
  right: ${t.spacing[3]};
  z-index: 2;
`;

const StyledLegend = styled.div`
  align-items: center;
  border-top: 1px solid ${t.border.color.light};
  color: ${t.font.color.tertiary};
  display: flex;
  flex-wrap: wrap;
  font-size: ${t.font.size.xs};
  gap: ${t.spacing[1]} ${t.spacing[2]};
  padding: ${t.spacing[2]} ${t.spacing[3]};
  span[data-chip] {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.sm};
    color: ${t.font.color.secondary};
    padding: 2px ${t.spacing[2]};
  }
  span[data-chip] b { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; }
  span[data-count] { margin-right: auto; }
`;

type Dot = { p: CustomerPoint; x: number; y: number };

export const CustomerMap = () => {
  const [points, setPoints] = useState<CustomerPoint[] | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<Dot | null>(null);
  const [pinned, setPinned] = useState<Dot | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [transform, setTransform] = useState<Transform>(IDENTITY);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null);

  // Mouse position in map units (the 1000x500 viewBox), independent of rendered size.
  const toMapUnits = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { mx: 0, my: 0 };
    return { mx: ((clientX - rect.left) / rect.width) * W, my: ((clientY - rect.top) / rect.height) * H };
  };
  // Translation is limited so the map always covers the frame with no empty edges.
  const clampTransform = (next: Transform): Transform => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.k));
    const x = Math.min(0, Math.max(W - W * k, next.x));
    const y = Math.min(0, Math.max(H - H * k, next.y));
    return { k, x, y };
  };
  const zoomAt = (mx: number, my: number, factor: number) => setTransform((cur) => {
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cur.k * factor));
    const scale = k / cur.k;
    return clampTransform({ k, x: mx - (mx - cur.x) * scale, y: my - (my - cur.y) * scale });
  });
  const zoomCentre = (factor: number) => zoomAt(W / 2, H / 2, factor);

  // Wheel must be non-passive to stop the page scrolling while zooming the map.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { mx, my } = toMapUnits(e.clientX, e.clientY);
      zoomAt(mx, my, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fetchCustomerPoints().then(setPoints).catch(() => setPoints([])); }, []);

  const { projection, landDots } = useMemo(() => {
    const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
    const land = feature(topo, topo.objects.land);
    const proj = geoNaturalEarth1().fitSize([W, H], land);
    geoPath(proj);
    const dots: [number, number][] = [];
    for (let lat = -58; lat <= 84; lat += GRID_STEP) {
      for (let lng = -180; lng < 180; lng += GRID_STEP) {
        if (!geoContains(land, [lng, lat])) continue;
        const xy = proj([lng, lat]);
        if (xy) dots.push([Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10]);
      }
    }
    return { projection: proj, landDots: dots };
  }, []);

  const filtered = useMemo(() => {
    let r = points ?? [];
    if (onlyActive) r = r.filter((p) => p.active);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((p) => [p.name, p.email, p.city, countryName(p.country)].some((v) => (v ?? '').toLowerCase().includes(s)));
    return r;
  }, [points, onlyActive, q]);

  const dots = useMemo<Dot[]>(() => filtered.map((p) => {
    const c = coordFor(p);
    if (!c) return null;
    const xy = projection([c[1], c[0]]);
    return xy ? { p, x: xy[0], y: xy[1] } : null;
  }).filter((d): d is Dot => d !== null), [filtered, projection]);

  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.country, (m.get(p.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [filtered]);
  const activeCount = (points ?? []).filter((p) => p.active).length;

  useEffect(() => { setPinned(null); setHover(null); }, [onlyActive, q]);

  const resync = async () => {
    setSyncing('Starting…');
    setSyncStatus(null);
    try {
      await refreshMap((done, total, label) => setSyncing(`${label} (${done}/${total})`));
      setPoints(await fetchCustomerPoints());
      setSyncStatus({ ok: true, msg: 'Locations updated' });
    } catch (e) {
      setSyncStatus({ ok: false, msg: (e as Error).message });
    } finally {
      setSyncing(null);
    }
  };

  const isOn = (d: Dot) => pinned?.p.customer_id === d.p.customer_id;
  const tip = hover && !isOn(hover) ? hover : null;
  const { k, x: tx, y: ty } = transform;
  const screenX = (d: Dot) => ((tx + d.x * k) / W) * 100;
  const screenY = (d: Dot) => ((ty + d.y * k) / H) * 100;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, x: transform.x, y: transform.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = ((e.clientX - drag.startX) / rect.width) * W;
    const dy = ((e.clientY - drag.startY) / rect.height) * H;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    setDragging(true);
    setTransform((cur) => clampTransform({ k: cur.k, x: drag.x + dx, y: drag.y + dy }));
  };
  const onPointerUp = () => {
    const moved = dragRef.current?.moved;
    dragRef.current = null;
    setDragging(false);
    if (!moved) setPinned(null);
  };

  return (
    <StyledFrame>
      <StyledToolbar>
        <div>
          <PillButton title={`Active · ${activeCount}`} active={onlyActive} onClick={() => setOnlyActive(true)} />
          <PillButton title={`All paid · ${points?.length ?? 0}`} active={!onlyActive} onClick={() => setOnlyActive(false)} />
        </div>
        <div>
          {syncStatus && !syncing && <Tag color={syncStatus.ok ? 'green' : 'orange'} text={syncStatus.msg} />}
          {syncing && <StyledMuted>{syncing}</StyledMuted>}
          <StyledField><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, city or country" style={{ width: 200 }} /></StyledField>
          <Button size="small" variant="secondary" Icon={IconRefresh} title="Refresh" disabled={!!syncing} onClick={resync} />
        </div>
      </StyledToolbar>

      <StyledMap ref={svgRef} viewBox={`0 0 ${W} ${H}`} data-dragging={dragging ? '' : undefined} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} role="img" aria-label="Customer locations">
        <g transform={`translate(${tx} ${ty}) scale(${k})`}>
        {landDots.map(([x, y], i) => <circle key={i} data-land cx={x} cy={y} r={1.25 / Math.sqrt(k)} />)}
        <g data-inactive={onlyActive ? undefined : ''}>
          {dots.map((d) => (
            <g key={d.p.customer_id} data-inactive={d.p.active ? undefined : ''}>
              <circle data-halo cx={d.x} cy={d.y} r={(isOn(d) ? 14 : 9) / k} />
              <circle
                data-dot
                data-on={isOn(d) ? '' : undefined}
                cx={d.x}
                cy={d.y}
                r={(isOn(d) || hover?.p.customer_id === d.p.customer_id ? 5.5 : 3.75) / k}
                style={{ strokeWidth: 1.5 / k }}
                tabIndex={0}
                aria-label={d.p.name}
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(d)}
                onBlur={() => setHover(null)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setPinned((cur) => (cur?.p.customer_id === d.p.customer_id ? null : d)); }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPinned((cur) => (cur?.p.customer_id === d.p.customer_id ? null : d)); } }}
              />
            </g>
          ))}
        </g>
        </g>
      </StyledMap>

      <StyledZoom>
        <Button size="small" variant="secondary" Icon={IconPlus} title="" ariaLabel="Zoom in" onClick={() => zoomCentre(1.5)} />
        <Button size="small" variant="secondary" Icon={IconMinus} title="" ariaLabel="Zoom out" onClick={() => zoomCentre(1 / 1.5)} />
        <Button size="small" variant="secondary" Icon={IconFocusCentered} title="" ariaLabel="Reset view" disabled={k === 1} onClick={() => setTransform(IDENTITY)} />
      </StyledZoom>

      {tip && (
        <StyledTooltip style={{ left: `${screenX(tip)}%`, top: `${screenY(tip)}%` }}>
          <div data-name>{tip.p.name}</div>
          <div data-sub>{flag(tip.p.country)} {tip.p.city ? `${tip.p.city}, ` : ''}{countryName(tip.p.country)} · {fmtUsd(tip.p.total_paid)}</div>
        </StyledTooltip>
      )}

      {pinned && (
        <StyledDetail onClick={(e) => e.stopPropagation()}>
          <div data-head>
            <div>
              <div data-name>{pinned.p.name}</div>
              <div data-where>{flag(pinned.p.country)} {pinned.p.city ? `${pinned.p.city}, ` : ''}{pinned.p.state ? `${pinned.p.state}, ` : ''}{countryName(pinned.p.country)}{!pinned.p.active && ' · inactive'}</div>
            </div>
            <Button size="small" variant="tertiary" Icon={IconX} title="" onClick={() => setPinned(null)} />
          </div>
          <div data-stats>
            <div><div data-k>Total paid</div><div data-v>{fmtUsd(pinned.p.total_paid)}</div></div>
            <div><div data-k>Payments</div><div data-v>{pinned.p.payments}</div></div>
          </div>
          <div data-foot>
            <StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(pinned.p.customer_id)}&name=${encodeURIComponent(pinned.p.name)}&back=/customers?view=map`}>Payment history →</StyledTextLink>
            {pinned.p.email && <StyledMuted style={{ marginLeft: 12 }}>{pinned.p.email}</StyledMuted>}
          </div>
        </StyledDetail>
      )}

      <StyledLegend>
        <span data-count>{points === null ? 'Loading…' : `${dots.length} customers on the map · scroll to zoom, drag to move, click a dot for details`}</span>
        {countries.map(([cc, n]) => <span key={cc} data-chip>{flag(cc)} {countryName(cc)} <b>{n}</b></span>)}
      </StyledLegend>
    </StyledFrame>
  );
};
