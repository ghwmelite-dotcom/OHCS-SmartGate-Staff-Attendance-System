import { describe, it, expect } from 'vitest';
import {
  withinGeofence,
  effectiveBufferMeters,
  MAX_GPS_ACCURACY_METERS,
  WALL_BUFFER_METERS,
  OHCS_POLYGONS,
} from './geofence';

// Geofence tolerance, loosened for the RSIMD pilot (2026-07-27): wall buffer
// 8 → 10m, accuracy cap 30 → 35m. Worst-case buffer 10 + 35 = 45m stays short
// of the neighbouring ministries (~46-49m) — keep it that way.

// Midpoint of the polygon's northern edge; test points sit due north of it.
const NORTH_EDGE = (() => {
  const poly = OHCS_POLYGONS[0]!;
  // corners [1] and [2] form the northern edge (see geofence.ts polygon order)
  const lat = (poly[1]![0] + poly[2]![0]) / 2;
  const lng = (poly[1]![1] + poly[2]![1]) / 2;
  return { lat, lng };
})();
const METERS_PER_DEG_LAT = 111_195;
const northOf = (meters: number): { lat: number; lng: number } => ({
  lat: NORTH_EDGE.lat + meters / METERS_PER_DEG_LAT,
  lng: NORTH_EDGE.lng,
});

describe('geofence constants', () => {
  it('accuracy cap is 35m and wall buffer is 10m', () => {
    expect(MAX_GPS_ACCURACY_METERS).toBe(35);
    expect(WALL_BUFFER_METERS).toBe(10);
  });

  it('effective buffer is wall buffer + full reported accuracy', () => {
    expect(effectiveBufferMeters(undefined)).toBe(10);
    expect(effectiveBufferMeters(0)).toBe(10);
    expect(effectiveBufferMeters(35)).toBe(45);
  });
});

describe('withinGeofence', () => {
  it('accepts a point inside the polygon', () => {
    expect(withinGeofence(5.5525650, -0.1974500)).toBe(true);
  });

  it('accepts a point ~4m outside with a dead-accurate fix (within the 10m wall buffer)', () => {
    // measured: 8m due north of the edge midpoint ≈ 3.5m from the polygon
    const p = northOf(8);
    expect(withinGeofence(p.lat, p.lng, 0)).toBe(true);
  });

  it('rejects a point ~10m outside with a dead-accurate fix', () => {
    // measured: 15m due north of the edge midpoint ≈ 10.2m from the polygon
    const p = northOf(15);
    expect(withinGeofence(p.lat, p.lng, 0)).toBe(false);
  });

  it('accepts a point ~10m outside when the fix reports ±5m accuracy', () => {
    const p = northOf(15);
    expect(withinGeofence(p.lat, p.lng, 5)).toBe(true);
  });
});
