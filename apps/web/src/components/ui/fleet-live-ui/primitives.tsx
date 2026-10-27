'use client';

import Link from 'next/link';
import {
  createElement,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import s from './fleet-ui.module.css';

/* ---------- helpers ---------- */

export const cx = (...a: (string | false | null | undefined)[]): string => a.filter(Boolean).join(' ');
export const cssVars = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;
export const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ---------- link context: provide next/link once ---------- */

const LinkContext = createContext<ElementType>(Link);

/** Provides Next.js client-side navigation to the public-page UI components. */
export function FleetUIProvider({ children }: { children: ReactNode }) {
  return <LinkContext.Provider value={Link}>{children}</LinkContext.Provider>;
}
export const useLink = (): ElementType => useContext(LinkContext);

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

/* ---------- button ---------- */

export interface ButtonProps {
  href?: string;
  /** lime = primary key, dark = inverse key for light sections, ghost = outline. */
  variant?: 'lime' | 'dark' | 'ghost';
  /** Arrow glyph. Pass false for none. */
  arrow?: 'right' | 'up-right' | false;
  size?: 'md' | 'sm';
  external?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  className?: string;
  children: ReactNode;
}

export function Button({ href, variant = 'lime', arrow = 'right', size = 'md', external, onClick, className, children }: ButtonProps) {
  const Link = useLink();
  const cls = cx(
    s.btn,
    variant === 'lime' ? s.btnLime : variant === 'dark' ? s.btnDark : s.btnGhost,
    size === 'sm' && s.btnSm,
    className,
  );
  const inner = (
    <>
      {children}
      {arrow ? <Arrow dir={arrow} /> : null}
    </>
  );
  if (!href) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return createElement(
    Link,
    {
      className: cls,
      href,
      onClick,
      ...(external ? { target: '_blank', rel: 'noreferrer' } : {}),
    },
    inner,
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  const Link = useLink();
  return createElement(Link, { className: s.textLink, href }, children);
}

/* ---------- digits that settle (the one orchestrated moment on stat tiles) ---------- */

/** Digits scramble and lock in left to right once, when scrolled into view. Static under reduced motion. */
export function SettleText({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [animation, setAnimation] = useState({ value, output: value });
  const out = animation.value === value ? animation.output : value;

  useEffect(() => {
    const el = ref.current;
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!el || motionPreference.matches || !/\d/.test(value)) return;
    let timer = 0;
    const finish = () => {
      window.clearInterval(timer);
      setAnimation({ value, output: value });
    };
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const N = 16;
        let step = 0;
        timer = window.setInterval(() => {
          step += 1;
          const keep = Math.floor((step / N) * value.length);
          setAnimation({
            value,
            output: value
              .split('')
              .map((c, i) => (i < keep || !/\d/.test(c) ? c : String(Math.floor(Math.random() * 10))))
              .join(''),
          });
          if (step >= N) {
            window.clearInterval(timer);
            setAnimation({ value, output: value });
          }
        }, 38);
      },
      { threshold: 0.6 },
    );
    const onMotionChange = () => {
      if (motionPreference.matches) {
        finish();
        setAnimation({ value, output: value });
      }
    };
    motionPreference.addEventListener('change', onMotionChange);
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
      motionPreference.removeEventListener('change', onMotionChange);
    };
  }, [value]);

  return (
    <span ref={ref}>
      <span aria-hidden="true">{out}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
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
