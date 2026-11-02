import type { ReactNode } from 'react';
import s from './fleet-ui.module.css';
import { Button } from './button';
import { Led, Panel } from './primitives';
import { SettleText } from './settle-text';
import { TimelineProgress } from './timeline-progress';
import { cssVars, cx } from './utils';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/* ---------- capability slab: one panel, cells divided by hairlines ---------- */

export interface CapabilityItem {
  /** Small label above the title ("Capability", "Now"). */
  kicker?: string;
  title: string;
  body: ReactNode;
  tags?: string[];
  /** Lit cell: use for the single live/current item. */
  lit?: boolean;
}

export function CapabilityGrid({ items }: { items: CapabilityItem[] }) {
  return (
    <div className={cx(s.slab, items.length === 3 && s.slabThree)}>
      {items.map((it) => (
        <article key={it.title} className={cx(s.cell, it.lit && s.lit)}>
          {it.kicker && (
            <div className={s.idx}>
              {it.lit && <Led />}
              <span>{it.kicker}</span>
            </div>
          )}
          <h3 className={s.mTitle}>{it.title}</h3>
          <div className={s.mBody}>
            <p>{it.body}</p>
          </div>
          {it.tags && it.tags.length > 0 && (
            <ul className={s.tags}>
              {it.tags.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}

/* ---------- stat strip: instrument readout ---------- */

export interface StatItem {
  value: string;
  unit?: string;
  label: string;
  note?: string;
}

export function StatStrip({ items }: { items: StatItem[] }) {
  return (
    <div className={s.stats}>
      {items.map((it) => (
        <div key={it.label} className={s.stat}>
          <div className={s.statValue}>
            <SettleText value={it.value} />
            {it.unit && <span className={s.unit}>{it.unit}</span>}
          </div>
          <div className={s.statLabel}>{it.label}</div>
          {it.note && <p className={s.statNote}>{it.note}</p>}
          <div className={cx(s.ruler, s.statGap)} aria-hidden="true" />
        </div>
      ))}
    </div>
  );
}

/* ---------- flow rail: a real sequence, so stages are numbered ---------- */

export interface FlowStage {
  title: string;
  body: ReactNode;
}

export function FlowRail({ label, title, stages }: { label?: string; title?: string; stages: FlowStage[] }) {
  return (
    <div className={s.surface}>
      {(label || title) && (
        <div className={s.flowHead}>
          {label && (
            <span className={s.idx}>
              <Led />
              {label}
            </span>
          )}
          {title && <h3 className={s.mTitle}>{title}</h3>}
        </div>
      )}
      <div className={s.flow} style={cssVars({ '--flow-columns': Math.min(stages.length, 4) })}>
        <i className={s.bus} aria-hidden="true" />
        {stages.map((st, i) => (
          <div key={st.title} className={s.stageWrap}>
            <i className={s.node} aria-hidden="true" />
            <Panel className={s.stage} index={pad2(i + 1)} kicker="Stage" title={st.title}>
              {st.body}
            </Panel>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- spec sheet (use cases): ruled rows, three states per row ---------- */

export interface SpecItem {
  kicker: string;
  title: string;
  need: ReactNode;
  shows: ReactNode;
  missing: ReactNode;
}

export function SpecSheet({
  items,
  labels = ['The need', 'What the demo shows', 'What would still be needed'],
}: {
  items: SpecItem[];
  labels?: [string, string, string];
}) {
  return (
    <div className={s.spec}>
      {items.map((it) => (
        <article key={it.title} className={s.specRow}>
          <div className={s.specHead}>
            <span className={s.idx}>{it.kicker}</span>
            <h3 className={s.specTitle}>{it.title}</h3>
          </div>
          <div className={s.specCols}>
            <div className={s.sc}>
              <span className={s.scLabel}>{labels[0]}</span>
              <p>{it.need}</p>
            </div>
            <div className={cx(s.sc, s.scShows)}>
              <span className={s.scLabel}>
                <Led />
                {labels[1]}
              </span>
              <p>{it.shows}</p>
            </div>
            <div className={cx(s.sc, s.scMissing)}>
              <span className={s.scLabel}>
                <i className={s.hollow} aria-hidden="true" />
                {labels[2]}
              </span>
              <p>{it.missing}</p>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

/* ---------- boundary pair: what exists vs what does not ---------- */

export interface BoundaryPanel {
  kicker: string;
  title: string;
  items: string[];
}

const Check = () => (
  <svg className={s.ico} viewBox="0 0 20 20" aria-hidden="true">
    <circle className={s.icoRing} cx="10" cy="10" r="9" />
    <path className={s.icoMark} d="M6 10.4l2.6 2.6L14 7.6" />
  </svg>
);

const Dash = () => (
  <svg className={s.ico} viewBox="0 0 20 20" aria-hidden="true">
    <circle className={s.icoDash} cx="10" cy="10" r="9" />
    <path className={s.icoDash} d="M6.5 10h7" />
  </svg>
);

export function BoundaryPair({ available, limits }: { available: BoundaryPanel; limits: BoundaryPanel }) {
  return (
    <div className={s.pair}>
      <Panel lit kicker={available.kicker} title={available.title}>
        <ul className={s.checks}>
          {available.items.map((t) => (
            <li key={t}>
              <Check />
              {t}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel className={s.limits} kicker={limits.kicker} title={limits.title}>
        <ul className={s.checks}>
          {limits.items.map((t) => (
            <li key={t}>
              <Dash />
              {t}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ---------- timeline: a real sequence, so nodes are numbered ---------- */

export type Phase = 'current' | 'next' | 'later' | 'future';

export interface TimelineItem {
  status: Phase;
  /** e.g. "Current: demonstration" */
  kicker: string;
  title: string;
  body: ReactNode;
  chips?: string[];
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  const cur = items.findIndex((i) => i.status === 'current');
  const initialIndex = cur < 0 ? 0 : cur;
  return (
    <TimelineProgress initialIndex={initialIndex}>
      {items.map((it, i) => (
        <div key={it.title} className={s.tlRow} data-timeline-row data-active={initialIndex === i} data-timeline-index={i}>
          <Panel className={initialIndex === i ? s.lit : undefined} kicker={it.kicker} title={it.title}>
            <p>{it.body}</p>
            {it.chips && (
              <div className={s.chips}>
                {it.chips.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      ))}
    </TimelineProgress>
  );
}

/* ---------- principles + two-up ---------- */

export function Principles({ items }: { items: { lead: string; text: string }[] }) {
  return (
    <ol className={s.principles}>
      {items.map((it, i) => (
        <li key={it.lead}>
          <span className={s.pNum}>{pad2(i + 1)}</span>
          <p>
            <strong>{it.lead}</strong> {it.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function TwoUp({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className={s.twoUp}>
      <div>{left}</div>
      <div>{right}</div>
    </div>
  );
}

/* ---------- CTA console strip ---------- */

export interface CtaPanelProps {
  title: string;
  body?: ReactNode;
  action: { label: string; href: string; external?: boolean };
  /** Small live label, e.g. "Simulated data". */
  status?: string;
}

export function CtaPanel({ title, body, action, status }: CtaPanelProps) {
  return (
    <aside className={s.cta}>
      <div className={s.ctaText}>
        {status && (
          <span className={s.ctaStatus}>
            <Led />
            {status}
          </span>
        )}
        <h3 className={s.ctaTitle}>{title}</h3>
        {body && <p className={s.ctaBody}>{body}</p>}
      </div>
      <Button href={action.href} external={action.external} variant="lime">
        {action.label}
      </Button>
    </aside>
  );
}
