import Link from 'next/link';
import type { ReactNode } from 'react';
import s from './fleet-ui.module.css';
import { cx } from './utils';

/* ---------- icons ---------- */

export function Arrow({ dir = 'right' }: { dir?: 'right' | 'up-right' }) {
  return (
    <svg className={s.arrow} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d={dir === 'right' ? 'M3 8h10M9 4l4 4-4 4' : 'M5 11l6-6M6 5h5v5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Led() {
  return <i className={s.led} aria-hidden="true" />;
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link className={s.textLink} href={href}>{children}</Link>;
}

/* ---------- section ---------- */

export type Tone = 'paper' | 'mist' | 'ink' | 'teal';

const TONE: Record<Tone, string | undefined> = {
  paper: s.tonePaper,
  mist: s.toneMist,
  ink: s.toneInk,
  teal: s.toneTeal,
};

export interface SectionProps {
  id?: string;
  /** paper / mist = light bands, ink / teal = dark bands (teal matches the hero). */
  tone?: Tone;
  /** stack: header above content. split: header pinned left, content right (best for long lists). */
  layout?: 'stack' | 'split';
  /** Halftone dissolve at the top seam. Use when the section above is the opposite tone. */
  edge?: boolean;
  /** Optional. Use only when it adds information (a status, a channel), not on every section. */
  eyebrow?: string;
  title?: ReactNode;
  lede?: ReactNode;
  action?: { label: string; href: string };
  className?: string;
  children?: ReactNode;
}

export function Section({ id, tone = 'paper', layout = 'stack', edge = false, eyebrow, title, lede, action, className, children }: SectionProps) {
  const hasHead = Boolean(eyebrow || title || lede || action);
  return (
    <section id={id} className={cx(s.section, TONE[tone], edge && s.edge, className)}>
      <div className={s.bg} aria-hidden="true" />
      <div className={cx(s.shell, layout === 'split' ? s.split : s.stack)}>
        {hasHead && (
          <header className={s.head}>
            {eyebrow && (
              <span className={s.eyebrow}>
                <Led />
                {eyebrow}
              </span>
            )}
            {title && <h2 className={s.title}>{title}</h2>}
            {lede && <p className={s.lede}>{lede}</p>}
            {action && <TextLink href={action.href}>{action.label}</TextLink>}
          </header>
        )}
        <div className={s.body}>{children}</div>
      </div>
    </section>
  );
}

/* ---------- surface panel ---------- */

export interface PanelProps {
  /** Short label. For sequences pass index too ("01"). */
  index?: string;
  kicker?: string;
  title?: ReactNode;
  tags?: string[];
  /** Lit material: lime wash and edge light. Use for the one thing that is live or current. */
  lit?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Panel({ index, kicker, title, tags, lit, className, children }: PanelProps) {
  return (
    <article className={cx(s.surface, s.pad, lit && s.lit, className)}>
      {(index || kicker) && (
        <div className={s.idx}>
          {lit && <Led />}
          {index && <b>{index}</b>}
          {index && kicker && <span className={s.slash}>/</span>}
          {kicker && <span>{kicker}</span>}
        </div>
      )}
      {title && <h3 className={s.mTitle}>{title}</h3>}
      {children && <div className={s.mBody}>{children}</div>}
      {tags && tags.length > 0 && (
        <ul className={s.tags}>
          {tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
