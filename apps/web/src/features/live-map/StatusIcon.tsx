import { MODE_CODES } from "@fleet/gl";

/**
 * The same shapes the map's shader draws, so the list and the map speak one
 * visual language: an arrow is moving, amber is projected past its last report,
 * a grey dot is parked, a red ring is stale, a violet diamond has an active
 * alert. Status is never colour alone.
 */
export function StatusIcon({ mode, heading = 0, size = 16, alert = false }: { mode: number; heading?: number; size?: number; alert?: boolean }) {
  const arrow = "M8 1.5 L13.5 13 L8 10 L2.5 13 Z";
  let shape;
  if (alert) shape = <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" fill="#7c3aed" stroke="#fff" strokeWidth="1" />;
  else if (mode === MODE_CODES.interpolated) shape = <path d={arrow} fill="#2563eb" stroke="#fff" strokeWidth="1" />;
  else if (mode === MODE_CODES.extrapolated || mode === MODE_CODES.holding) shape = <path d={arrow} fill="#d97706" stroke="#fff" strokeWidth="1" />;
  else if (mode === MODE_CODES.parked) shape = <circle cx="8" cy="8" r="4.5" fill="#6b7280" stroke="#fff" strokeWidth="1" />;
  else if (mode === MODE_CODES.stale) shape = <circle cx="8" cy="8" r="5" fill="none" stroke="#dc2626" strokeWidth="2.5" />;
  else shape = <circle cx="8" cy="8" r="2.5" fill="#9ca3af" />;
  const rotates = !alert && (mode === MODE_CODES.interpolated || mode === MODE_CODES.extrapolated || mode === MODE_CODES.holding);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <g transform={rotates ? `rotate(${heading} 8 8)` : undefined}>{shape}</g>
    </svg>
  );
}
