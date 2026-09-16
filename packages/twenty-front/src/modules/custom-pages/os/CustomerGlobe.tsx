import { styled } from '@linaria/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import createGlobe from 'cobe';
import { IconRefresh } from 'twenty-ui/icon';
import { Button } from 'twenty-ui/input';
import { Tag } from 'twenty-ui/data-display';
import { themeCssVariables as t } from 'twenty-ui/theme-constants';

import { type CustomerPoint, fetchCustomerPoints, refreshMap } from '@/custom-pages/os/data';
import { fmtUsd, PillButton, StyledCard, StyledField, StyledMuted, StyledRow, StyledTable, StyledTextLink } from '@/custom-pages/os/ui';

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

const MAX_MARKERS = 128; // cobe's marker cap
const THETA = 0.25;
const DEG = Math.PI / 180;
const RF = 0.4;
type PlacedPoint = CustomerPoint & { _lat: number; _lng: number };

// Screen position of a lat/lng on cobe's globe, mirroring cobe 0.6.3's own rotation maths,
// so HTML markers can sit exactly on the rendered sphere.
const project = (lat: number, lng: number, phi: number) => {
  const o = lng * DEG - Math.PI;
  const cl = Math.cos(lat * DEG);
  const sl = Math.sin(lat * DEG);
  const px = -cl * Math.cos(o);
  const py = sl;
  const pz = cl * Math.sin(o);
  const cph = Math.cos(phi);
  const sph = Math.sin(phi);
  const cth = Math.cos(THETA);
  const sth = Math.sin(THETA);
  const vx = cph * px + sph * sth * py - sph * cth * pz;
  const vy = cth * py + sth * pz;
  const vz = sph * px - cph * sth * py + cph * cth * pz;
  return { x: 0.5 + RF * vx, y: 0.5 - RF * vy, visible: vz > 0 };
};

const StyledLayout = styled.div`
  display: grid;
  gap: ${t.spacing[4]};
  grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;

const StyledGlobeWrap = styled.div`
  aspect-ratio: 1;
  cursor: grab;
  max-width: 560px;
  margin: 0 auto;
  position: relative;
  width: 100%;
  &:active { cursor: grabbing; }
  canvas { height: 100%; width: 100%; }
  button[data-marker] {
    background: ${t.color.blue};
    border: 2px solid ${t.background.primary};
    border-radius: 50%;
    box-shadow: 0 0 0 2px color-mix(in srgb, ${t.color.blue} 35%, transparent);
    cursor: pointer;
    height: 10px;
    margin: -5px 0 0 -5px;
    padding: 0;
    position: absolute;
    transition-property: opacity, transform;
    transition-duration: 120ms;
    transition-timing-function: cubic-bezier(0.2, 0, 0, 1);
    width: 10px;
  }
  button[data-marker][data-on] { background: ${t.tag.text.green}; transform: scale(1.6); z-index: 1; }
  button[data-marker]:focus-visible { outline: 2px solid ${t.color.blue}; outline-offset: 2px; }
`;

const StyledTooltip = styled.div`
  background: ${t.background.primary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  box-shadow: ${t.boxShadow.light};
  font-size: ${t.font.size.sm};
  padding: ${t.spacing[2]} ${t.spacing[3]};
  pointer-events: none;
  position: absolute;
  white-space: nowrap;
  z-index: 2;
  div[data-name] { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; }
  div[data-sub] { color: ${t.font.color.tertiary}; font-size: ${t.font.size.xs}; }
`;

const StyledList = styled.div`
  max-height: 520px;
  overflow: auto;
  tr[data-on] td { background: ${t.background.tertiary}; }
  tbody tr { cursor: pointer; }
`;

const StyledCountries = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing[1]};
  margin-bottom: ${t.spacing[3]};
  span {
    background: ${t.background.tertiary};
    border-radius: ${t.border.radius.sm};
    color: ${t.font.color.secondary};
    font-size: ${t.font.size.xs};
    padding: 2px ${t.spacing[2]};
  }
  span b { color: ${t.font.color.primary}; font-weight: ${t.font.weight.medium}; }
`;

const Globe = ({ points, onSelect, onHover, focus }: { points: PlacedPoint[]; onSelect: (p: PlacedPoint) => void; onHover: (p: PlacedPoint | null, e?: React.MouseEvent) => void; focus: PlacedPoint | null }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const markerEls = useRef(new Map<string, HTMLButtonElement>());
  const pointerInteracting = useRef<number | null>(null);
  const rotationRef = useRef(0);
  const pointsRef = useRef(points);
  const focusRef = useRef<PlacedPoint | null>(null);
  pointsRef.current = points;
  focusRef.current = focus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let phi = 0;
    let width = canvas.offsetWidth;
    const onResize = () => { width = canvas.offsetWidth; };
    window.addEventListener('resize', onResize);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches;
    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: THETA,
      dark: dark ? 1 : 0,
      diffuse: 1.1,
      mapSamples: 16000,
      mapBrightness: dark ? 6 : 8,
      baseColor: dark ? [0.22, 0.24, 0.3] : [0.85, 0.87, 0.92],
      markerColor: [0.106, 0.267, 0.596],
      glowColor: dark ? [0.1, 0.1, 0.14] : [0.98, 0.99, 1],
      markers: pointsRef.current.slice(0, MAX_MARKERS).map((p) => ({ location: [p._lat, p._lng] as [number, number], size: 0.03 })),
      onRender: (state) => {
        const target = focusRef.current;
        if (target) {
          // Rotate so the selected customer sits front and centre, easing in.
          const wanted = -(target._lng * DEG - Math.PI) - Math.PI / 2;
          const current = phi + rotationRef.current;
          let delta = wanted - current;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          phi += delta * 0.08;
        } else if (pointerInteracting.current === null) {
          phi += 0.003;
        }
        const angle = phi + rotationRef.current;
        state.phi = angle;
        state.width = width * 2;
        state.height = width * 2;
        for (const p of pointsRef.current) {
          const el = markerEls.current.get(p.customer_id);
          if (!el) continue;
          const pos = project(p._lat, p._lng, angle);
          if (pos.visible) {
            el.style.opacity = '1';
            el.style.pointerEvents = 'auto';
            el.style.left = `${pos.x * width}px`;
            el.style.top = `${pos.y * width}px`;
          } else {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
          }
        }
      },
    });
    return () => { globe.destroy(); window.removeEventListener('resize', onResize); };
    // Markers are re-created with the globe when the point set changes.
  }, [points]);

  return (
    <StyledGlobeWrap
      onPointerDown={(e) => { pointerInteracting.current = e.clientX - rotationRef.current * 200; }}
      onPointerUp={() => { pointerInteracting.current = null; }}
      onPointerOut={() => { pointerInteracting.current = null; }}
      onPointerMove={(e) => { if (pointerInteracting.current !== null) rotationRef.current = (e.clientX - pointerInteracting.current) / 200; }}
    >
      <canvas ref={canvasRef} />
      {points.map((p) => (
        <button
          key={p.customer_id}
          data-marker
          data-on={focus?.customer_id === p.customer_id ? '' : undefined}
          aria-label={p.name}
          ref={(el) => { if (el) markerEls.current.set(p.customer_id, el); else markerEls.current.delete(p.customer_id); }}
          onMouseEnter={(e) => onHover(p, e)}
          onMouseLeave={() => onHover(null)}
          onClick={(e) => { e.stopPropagation(); onSelect(p); }}
          style={{ opacity: 0 }}
        />
      ))}
    </StyledGlobeWrap>
  );
};

export const CustomerGlobe = () => {
  const [points, setPoints] = useState<CustomerPoint[] | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);
  const [q, setQ] = useState('');
  const [hover, setHover] = useState<{ p: PlacedPoint; x: number; y: number } | null>(null);
  const [pinned, setPinned] = useState<PlacedPoint | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => { fetchCustomerPoints().then(setPoints).catch(() => setPoints([])); }, []);

  const filtered = useMemo(() => {
    let r = points ?? [];
    if (onlyActive) r = r.filter((p) => p.active);
    const s = q.trim().toLowerCase();
    if (s) r = r.filter((p) => [p.name, p.email, p.city, countryName(p.country)].some((v) => (v ?? '').toLowerCase().includes(s)));
    return r;
  }, [points, onlyActive, q]);
  const placed = useMemo<PlacedPoint[]>(() => filtered.map((p) => { const c = coordFor(p); return c ? { ...p, _lat: c[0], _lng: c[1] } : null; }).filter((p): p is PlacedPoint => p !== null), [filtered]);
  const countries = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of filtered) m.set(p.country, (m.get(p.country) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [filtered]);
  const activeCount = (points ?? []).filter((p) => p.active).length;

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

  return (
    <StyledLayout>
      <StyledCard>
        <StyledRow style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <StyledRow>
            <PillButton title={`Active · ${activeCount}`} active={onlyActive} onClick={() => setOnlyActive(true)} />
            <PillButton title={`All paid · ${points?.length ?? 0}`} active={!onlyActive} onClick={() => setOnlyActive(false)} />
          </StyledRow>
          <StyledRow>
            {syncStatus && !syncing && <Tag color={syncStatus.ok ? 'green' : 'orange'} text={syncStatus.msg} />}
            {syncing && <StyledMuted>{syncing}</StyledMuted>}
            <Button size="small" variant="secondary" Icon={IconRefresh} title="Refresh locations" disabled={!!syncing} onClick={resync} />
          </StyledRow>
        </StyledRow>
        <div style={{ position: 'relative' }}>
          <Globe points={placed} focus={pinned} onSelect={(p) => setPinned((cur) => (cur?.customer_id === p.customer_id ? null : p))} onHover={(p, e) => setHover(p && e ? { p, x: e.clientX, y: e.clientY } : null)} />
          {hover && (
            <StyledTooltip style={{ left: 12, bottom: 12 }}>
              <div data-name>{hover.p.name}</div>
              <div data-sub>{flag(hover.p.country)} {hover.p.city ? `${hover.p.city}, ` : ''}{countryName(hover.p.country)} · {hover.p.payments} payment{hover.p.payments === 1 ? '' : 's'} · {fmtUsd(hover.p.total_paid)}</div>
            </StyledTooltip>
          )}
        </div>
        <StyledMuted>{placed.length} customers on the globe · drag to spin · click a dot or a row to focus</StyledMuted>
      </StyledCard>

      <StyledCard>
        <StyledRow style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <StyledField><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, city or country" style={{ width: 220 }} /></StyledField>
          {pinned && <Button size="small" variant="tertiary" title="Clear focus" onClick={() => setPinned(null)} />}
        </StyledRow>
        <StyledCountries>
          {countries.map(([cc, n]) => <span key={cc}>{flag(cc)} {countryName(cc)} <b>{n}</b></span>)}
        </StyledCountries>
        <StyledList>
          <StyledTable>
            <thead><tr><th>Customer</th><th>Location</th><th>Paid</th></tr></thead>
            <tbody>
              {points === null && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>Loading…</StyledMuted></td></tr>}
              {points !== null && filtered.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24 }}><StyledMuted>No matches.</StyledMuted></td></tr>}
              {placed.map((p) => (
                <tr key={p.customer_id} data-on={pinned?.customer_id === p.customer_id ? '' : undefined} onClick={() => setPinned((cur) => (cur?.customer_id === p.customer_id ? null : p))}>
                  <td>
                    <StyledTextLink to={`/records?type=customer_payments&arg=${encodeURIComponent(p.customer_id)}&name=${encodeURIComponent(p.name)}&back=/customers?view=map`} onClick={(e) => e.stopPropagation()}>{p.name}</StyledTextLink>
                    {!p.active && <StyledMuted style={{ marginLeft: 6 }}>inactive</StyledMuted>}
                  </td>
                  <td>{flag(p.country)} {p.city ?? countryName(p.country)}</td>
                  <td>{fmtUsd(p.total_paid)}</td>
                </tr>
              ))}
            </tbody>
          </StyledTable>
        </StyledList>
      </StyledCard>
    </StyledLayout>
  );
};
