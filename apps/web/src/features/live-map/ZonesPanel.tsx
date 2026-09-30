"use client";

import { useState } from "react";
import { defaultAlerts, parseZones, type MultiPolygonCoords, type ZoneKind, type ZoneSpec } from "@fleet/alerts";
import { addZones, encodeZones, removeZone, restorePresets, updateZone } from "@/lib/zones";

const KIND_LABEL: Record<ZoneKind, string> = { restricted: "Restricted area", depot: "Depot" };
const number = new Intl.NumberFormat("en-NG");

export type DrawState =
  | { step: "idle" }
  /** Adding corners on the map. */
  | { step: "drawing"; corners: number }
  /** The shape is closed: name it and save it. */
  | { step: "naming"; shape: MultiPolygonCoords };

interface Props {
  zones: readonly ZoneSpec[];
  counts: ReadonlyMap<string, number>;
  draw: DrawState;
  onStartDraw: () => void;
  onAddCentre: () => void;
  onUndoCorner: () => void;
  onFinishDraw: () => void;
  onCancelDraw: () => void;
  onShowZone: (id: string) => void;
}

const button = "min-h-8 rounded-md border border-control px-2 text-xs focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60";

/**
 * The zones alerts are evaluated against: draw one, import GeoJSON, switch
 * each zone's entry and exit alerts, see how many trucks are inside.
 *
 * Drawing works without a pointer: the map pans with the arrow keys once
 * focused, and "Add corner at map centre" drops a corner under the crosshair.
 * Importing GeoJSON is the other route that needs no pointing at all.
 */
export function ZonesPanel({ zones, counts, draw, onStartDraw, onAddCentre, onUndoCorner, onFinishDraw, onCancelDraw, onShowZone }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ZoneKind>("restricted");
  const [pasted, setPasted] = useState("");
  const [report, setReport] = useState<{ ok: boolean; lines: string[] } | null>(null);

  const importText = (text: string) => {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      setReport({ ok: false, lines: ["That isn't valid JSON."] });
      return;
    }
    const result = parseZones(json);
    if (!result.ok) {
      setReport({ ok: false, lines: result.errors.slice(0, 5).concat(result.errors.length > 5 ? [`and ${result.errors.length - 5} more`] : []) });
      return;
    }
    addZones(result.zones);
    setPasted("");
    setReport({ ok: true, lines: [`Imported ${result.zones.length} zone${result.zones.length === 1 ? "" : "s"}.`, ...result.warnings] });
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([encodeZones(zones)], { type: "application/geo+json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "fleet-live-zones.geojson";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Zone names are level-3 headings; this keeps the outline in order (axe: heading-order). */}
      <h2 className="sr-only">Zones</h2>
      <div className="space-y-2 border-b border-line p-3">
        {draw.step === "idle" && (
          <button type="button" onClick={onStartDraw} className={`${button} w-full py-2 text-sm font-medium`}>
            Draw a zone
          </button>
        )}
        {draw.step === "drawing" && (
          <div className="space-y-2" role="group" aria-labelledby="draw-help">
            <p id="draw-help" className="text-sm">
              Click the map to add corners, or move the map and add one at the centre. {draw.corners} corner{draw.corners === 1 ? "" : "s"} so far;
              a zone needs at least 3.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={onAddCentre} className={button}>
                Add corner at map centre
              </button>
              <button type="button" onClick={onUndoCorner} disabled={draw.corners === 0} className={button}>
                Undo last corner
              </button>
              <button type="button" onClick={onFinishDraw} disabled={draw.corners < 3} className={button}>
                Finish shape
              </button>
              <button type="button" onClick={onCancelDraw} className={button}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {draw.step === "naming" && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              addZones([{ name: name.trim().slice(0, 60), kind, ...defaultAlerts(kind), coordinates: draw.shape }]);
              setName("");
              onCancelDraw();
            }}
          >
            <label className="block text-sm">
              Zone name
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="mt-1 w-full rounded-md border border-control px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:ring-accent"
              />
            </label>
            <label className="block text-sm">
              Kind
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ZoneKind)}
                className="mt-1 w-full rounded-md border border-control bg-surface px-2 py-1.5 text-sm"
              >
                <option value="restricted">Restricted area (alert when a truck enters)</option>
                <option value="depot">Depot (alert when a truck leaves)</option>
              </select>
            </label>
            <div className="flex gap-1.5">
              <button type="submit" className={button}>
                Save zone
              </button>
              <button type="button" onClick={onCancelDraw} className={button}>
                Discard
              </button>
            </div>
          </form>
        )}
      </div>

      <ul aria-label="Zones" className="border-b border-line">
        {zones.length === 0 && <li className="p-3 text-sm text-muted">No zones. Draw one, import GeoJSON, or restore the demo zones.</li>}
        {zones.map((z) => {
          const inside = counts.get(z.id) ?? 0;
          return (
            <li key={z.id} className="space-y-1.5 border-b border-line p-3 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">{z.name}</h3>
                <span className="shrink-0 text-xs text-muted">
                  {number.format(inside)} truck{inside === 1 ? "" : "s"} inside
                </span>
              </div>
              <p className="text-xs text-muted">{KIND_LABEL[z.kind]}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={z.alertOnEnter} onChange={(e) => updateZone(z.id, { alertOnEnter: e.target.checked })} />
                  Alert on entry
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={z.alertOnExit} onChange={(e) => updateZone(z.id, { alertOnExit: e.target.checked })} />
                  Alert on exit
                </label>
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => onShowZone(z.id)} className={button} aria-label={`Show ${z.name} on the map`}>
                  Show on map
                </button>
                <button type="button" onClick={() => removeZone(z.id)} className={button} aria-label={`Delete ${z.name}`}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 p-3">
        <label htmlFor="zone-import" className="block text-sm font-medium">
          Import GeoJSON
        </label>
        <textarea
          id="zone-import"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={3}
          placeholder='{"type": "FeatureCollection", "features": [...]}'
          className="w-full rounded-md border border-control px-2 py-1.5 font-mono text-xs placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => importText(pasted)} disabled={!pasted.trim()} className={button}>
            Import pasted
          </button>
          <label className={`${button} inline-flex cursor-pointer items-center focus-within:ring-2 focus-within:ring-accent`}>
            Import a file
            <input
              type="file"
              accept=".geojson,.json,application/geo+json,application/json"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) importText(await file.text());
              }}
            />
          </label>
          <button type="button" onClick={download} disabled={zones.length === 0} className={button}>
            Download GeoJSON
          </button>
          <button type="button" onClick={restorePresets} className={button}>
            Restore demo zones
          </button>
        </div>
        <div role="status" className="text-xs">
          {report && (
            <ul className={report.ok ? "text-fg" : "text-danger"}>
              {report.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
