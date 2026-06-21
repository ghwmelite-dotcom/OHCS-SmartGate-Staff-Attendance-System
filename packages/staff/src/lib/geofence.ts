// Mirrors the server polygons in packages/api/src/routes/clock.ts so the
// staff app can fail fast (and give a meaningful error) before opening the
// camera. The server is still the source of truth — this is a UX gate, not
// a security boundary. Keep these definitions in sync.

export type LatLng = readonly [number, number];

// MUST match the server source of truth in packages/api/src/routes/clock.ts
// (the real OHCS building footprint, ~34×76m). Previously this was a stale ~7×3m
// patch, which client-side-rejected staff genuinely inside the building.
export const OHCS_POLYGONS: readonly (readonly LatLng[])[] = [
  [
    [5.5525043, -0.1977808],
    [5.5527239, -0.1971268],
    [5.5526358, -0.1970969],
    [5.5524162, -0.1977509],
  ],
];

function pointInPolygon(lat: number, lng: number, poly: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i] as LatLng;
    const [yj, xj] = poly[j] as LatLng;
    const intersect = ((yi > lat) !== (yj > lat))
      && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function distanceToSegmentMeters(
  lat: number, lng: number,
  latA: number, lngA: number,
  latB: number, lngB: number,
): number {
  const R = 6371000;
  const cosLat = Math.cos(((latA + latB) / 2) * Math.PI / 180);
  const x = (lng - lngA) * cosLat;
  const y = lat - latA;
  const dx = (lngB - lngA) * cosLat;
  const dy = latB - latA;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : (x * dx + y * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = dx * t - x;
  const py = dy * t - y;
  return Math.sqrt(px * px + py * py) * (Math.PI / 180) * R;
}

function distanceToPolygonMetersOne(lat: number, lng: number, poly: readonly LatLng[]): number {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as LatLng;
    const b = poly[j] as LatLng;
    const d = distanceToSegmentMeters(lat, lng, a[0], a[1], b[0], b[1]);
    if (d < min) min = d;
  }
  return min;
}

export const MAX_GPS_ACCURACY_METERS = 30;
// Mirror of server WALL_BUFFER_METERS — keep in sync.
export const WALL_BUFFER_METERS = 8;

// Same accuracy-aware buffer as the server: a fix's tolerance grows with the
// device's reported uncertainty so indoor GPS jitter (5-15m on mobile inside
// concrete buildings) doesn't reject staff who are genuinely inside.
export function effectiveBufferMeters(accuracy: number | undefined): number {
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  return WALL_BUFFER_METERS + acc * 0.5;
}

export function withinGeofence(lat: number, lng: number, accuracy?: number): boolean {
  for (const poly of OHCS_POLYGONS) {
    if (pointInPolygon(lat, lng, poly)) return true;
  }
  return distanceToPolygonMeters(lat, lng) <= effectiveBufferMeters(accuracy);
}

export function distanceToPolygonMeters(lat: number, lng: number): number {
  let min = Infinity;
  for (const poly of OHCS_POLYGONS) {
    const d = distanceToPolygonMetersOne(lat, lng, poly);
    if (d < min) min = d;
  }
  return min;
}
