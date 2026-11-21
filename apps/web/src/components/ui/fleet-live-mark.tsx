/** The selected Signal Merge artwork, rotated 90° clockwise in its SVG wrapper. */
export function FleetLiveMark({ size = 36 }: { size?: number }) {
  return (
    // A small, self-contained local SVG needs no image-optimization request.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/images/brand/fleet-live-mark.svg"
      width={size}
      height={size}
      style={{ width: size, height: size, flexShrink: 0 }}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-testid="fleet-live-mark"
    />
  );
}
