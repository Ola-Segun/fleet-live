import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { haversine } from "@fleet/routes";
import { prepareZone, signedDistance, type MultiPolygonCoords } from "../src";
import { at, square } from "./helpers";

/**
 * The first, obvious implementation, kept as the reference the indexed one must
 * agree with: every edge, every time. Same flat plane, so they're comparable.
 */
function bruteForce(coords: MultiPolygonCoords): (lat: number, lon: number) => number {
  const z = prepareZone(coords, 0);
  const rings = coords.flatMap((polygon) => polygon.map((ring) => ring.map(([lo, la]) => [(lo! - z.lon0) * z.kx, (la! - z.lat0) * z.ky] as const)));
  return (lat, lon) => {
    const x = (lon - z.lon0) * z.kx;
    const y = (lat - z.lat0) * z.ky;
    const inRing = (r: readonly (readonly [number, number])[]) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, ay] = r[j]!, [bx, by] = r[i]!;
        if (ay > y !== by > y && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
      }
      return inside;
    };
    let inside = false;
    let k = 0;
    for (const polygon of coords) {
      const own = rings.slice(k, k + polygon.length);
      k += polygon.length;
      if (inRing(own[0]!) && !own.slice(1).some(inRing)) inside = true;
    }
    let best = Infinity;
    for (const r of rings) {
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, ay] = r[j]!, [bx, by] = r[i]!;
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx - x, ay + t * dy - y));
      }
    }
    return inside ? -best : best;
  };
}

describe("signed distance to a zone's edge", () => {
  const z = prepareZone(square(1000), 40);

  it("is negative inside and positive outside, in metres, near the edge", () => {
    expect(signedDistance(z, ...at(990, 500))).toBeCloseTo(-10, 1);
    expect(signedDistance(z, ...at(1010, 500))).toBeCloseTo(10, 1);
    expect(signedDistance(z, ...at(1030, 500))).toBeCloseTo(30, 1);
  });

  it("gives only the side beyond the reach it was prepared for: that's all the rules ask", () => {
    expect(signedDistance(z, ...at(500, 500))).toBe(-Infinity);
    expect(signedDistance(z, ...at(1100, 500))).toBe(Infinity);
    expect(signedDistance(z, ...at(-5000, -5000))).toBe(Infinity);
  });

  it("treats a hole as outside, and overlapping polygons of one zone as inside", () => {
    const withHole = prepareZone([[...square(1000)[0]!, ...square(200, 400, 400)[0]!]], 150);
    expect(signedDistance(withHole, ...at(500, 500))).toBeCloseTo(100, 0); // centre of the hole
    expect(signedDistance(withHole, ...at(100, 500))).toBeCloseTo(-100, 0); // between hole and outline
    const overlapping = prepareZone([square(600)[0]!, square(600, 400, 0)[0]!], 40);
    expect(signedDistance(overlapping, ...at(500, 300))).toBe(-Infinity); // in both, far from every edge
  });

  it("agrees with great-circle distance for points straight out from an edge, to within 0.5 m over 1 km", () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 39, noNaN: true }), fc.double({ min: 50, max: 950, noNaN: true }), (out, along) => {
        const p = at(1000 + out, along);
        const edge = at(1000, along);
        expect(Math.abs(signedDistance(z, ...p) - haversine(p, edge))).toBeLessThan(0.5);
      }),
    );
  });

  it("gets the side right for any nearby point, checked against a plain box test", () => {
    // Tenths of a metre plus 5 cm: never exactly on an edge, where rounding may pick either side.
    const coord = fc.integer({ min: -300, max: 10_300 }).map((d) => d / 10 + 0.05);
    fc.assert(
      fc.property(coord, coord, (x, y) => {
        const inside = x > 0 && x < 1000 && y > 0 && y < 1000;
        expect(signedDistance(z, ...at(x, y)) < 0).toBe(inside);
      }),
    );
  });

  it("agrees with the every-edge reference on random shapes with holes: same side, same distance within reach", () => {
    // Star-shaped polygons: a random radius per angle, optionally with a smaller star cut out.
    const star = (radii: number[], scale: number) => {
      const ring = radii.map((r, i) => {
        const a = (2 * Math.PI * i) / radii.length;
        const [lat, lon] = at(Math.cos(a) * r * scale, Math.sin(a) * r * scale);
        return [lon, lat];
      });
      return [...ring, ring[0]!];
    };
    const radii = (max: number) => fc.array(fc.double({ min: 0.4, max: 1, noNaN: true }), { minLength: 3, maxLength: max });
    const shape = fc.record({ outer: radii(80), hole: fc.option(radii(20)), size: fc.integer({ min: 100, max: 3000 }), reach: fc.integer({ min: 10, max: 200 }) });
    const point = fc.tuple(fc.double({ min: -1.3, max: 1.3, noNaN: true }), fc.double({ min: -1.3, max: 1.3, noNaN: true }));
    fc.assert(
      fc.property(shape, fc.array(point, { minLength: 20, maxLength: 20 }), ({ outer, hole, size, reach }, points) => {
        const coords: MultiPolygonCoords = [hole ? [star(outer, size), star(hole, size * 0.3)] : [star(outer, size)]];
        const z = prepareZone(coords, reach);
        const reference = bruteForce(coords);
        for (const [px, py] of points) {
          const [lat, lon] = at(px * size, py * size);
          const want = reference(lat, lon);
          const got = signedDistance(z, lat, lon);
          if (Math.abs(want) < 0.01) continue; // on an edge: either side is right
          expect(Math.sign(got)).toBe(Math.sign(want));
          if (Math.abs(want) <= reach) expect(got).toBeCloseTo(want, 6);
          else expect(Math.abs(got)).toBe(Infinity);
        }
      }),
      { numRuns: 300 },
    );
  }, 30_000);
});
