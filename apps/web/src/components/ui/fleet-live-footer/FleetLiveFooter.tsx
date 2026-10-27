'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import styles from './FleetLiveFooter.module.css';
import { DotWordmark } from './dot-wordmark';

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

export interface FleetLiveFooterProps {
  /** Wordmark text. Words alternate white and lime ("NO NOISE", "FLEET-LIVE"). */
  text?: string;
  /** Fraction of the wordmark's height that is shown (cropped by the page edge). Default 0.9. */
  visibleFraction?: number;
  /** Where "Launch demo" goes. */
  demoHref?: string;
  /** Short line under the brand. */
  description?: string;
  /** Link columns. Defaults to Explore and Demo. */
  columns?: FooterColumn[];
  className?: string;
}

const DEFAULT_DESCRIPTION =
  'A fleet-operations concept and engineering portfolio project. Explore with simulated data.';

const cx = (...a: (string | false | undefined)[]): string => a.filter(Boolean).join(' ');

export default function FleetLiveFooter({
  text = 'NO NOISE',
  visibleFraction = 0.9,
  demoHref = '/app',
  description = DEFAULT_DESCRIPTION,
  columns,
  className,
}: FleetLiveFooterProps) {
  const rootRef = useRef<HTMLElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<DotWordmark | null>(null);
  const refit = useRef<() => void>(() => undefined);
  const cols: FooterColumn[] = columns ?? [
    {
      title: 'Explore',
      links: [
        { label: 'Platform', href: '/platform' },
        { label: 'Use cases', href: '/use-cases' },
        { label: 'Engineering', href: '/engineering' },
        { label: 'Product direction', href: '/product-direction' },
      ],
    },
    {
      title: 'Demo',
      links: [
        { label: 'Launch demo', href: demoHref },
      ],
    },
  ];

  useEffect(() => {
    const root = rootRef.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!root || !wrap || !canvas) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let wm: DotWordmark;
    try {
      wm = new DotWordmark(canvas, {
        text,
        visibleFraction,
        reducedMotion: mq.matches,
        fontFamily: getComputedStyle(root).fontFamily,
      });
    } catch (error) {
      console.error('FleetLiveFooter: unable to initialize the dot wordmark canvas.', error);
      return; // No 2D canvas: the rest of the footer still renders.
    }
    engineRef.current = wm;

    let raf = 0;
    let visible = false;
    let cancelled = false;

    const fit = () => {
      wm.setFontFamily(getComputedStyle(root).fontFamily);
      const h = wm.resize(wrap.clientWidth, window.devicePixelRatio || 1);
      wrap.style.height = `${h}px`;
      // Pull the wordmark up so the scatter field sits behind the bottom of the info row.
      root.style.setProperty('--lift', `${Math.round(wm.headroom * 0.85)}px`);
      // The dot field covers the whole footer; the wordmark keeps its place inside it.
      const fr = root.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      wm.setField(root.clientWidth, root.clientHeight, wr.left - fr.left, wr.top - fr.top);
      if (mq.matches) wm.render(0);
    };
    refit.current = fit;

    // 0 = scattered, 1 = formed. Driven by how much of the wordmark band is on screen,
    // so it forms while scrolling in and scatters gradually while scrolling away.
    const IN_AT = 0.12; // below this much of the band visible: fully scattered
    const OUT_AT = 0.88; // above this much visible: fully formed
    const progress = (): number => {
      if (mq.matches) return 1;
      const r = wrap.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const shown = (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / Math.max(1, r.height);
      return Math.min(1, Math.max(0, (shown - IN_AT) / (OUT_AT - IN_AT)));
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || mq.matches || document.visibilityState !== 'visible') return;
      wm.setProgress(progress());
      wm.render(now);
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (!raf && visible && !mq.matches && document.visibilityState === 'visible') {
        raf = requestAnimationFrame(frame);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancelAnimationFrame(raf);
        raf = 0;
      } else {
        start();
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e) return;
        if (e.intersectionRatio > 0) {
          visible = true;
          start();
        } else {
          visible = false;
          wm.setProgress(0, true); // off-screen: start scattered for the next entrance
        }
      },
      { threshold: [0] },
    );
    io.observe(root);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    ro.observe(root);

    const onMotionChange = () => {
      wm.setReducedMotion(mq.matches);
      if (mq.matches) {
        cancelAnimationFrame(raf);
        raf = 0;
        fit();
      } else {
        start();
      }
    };
    mq.addEventListener('change', onMotionChange);

    fit();
    // Re-measure once the heavy weight of the web font is actually available,
    // and again whenever a font finishes loading (e.g. a font swap).
    const onFontsDone = () => {
      if (!cancelled) fit();
    };
    if (document.fonts) {
      const family = getComputedStyle(root).fontFamily;
      void Promise.all([document.fonts.load(`800 100px ${family}`), document.fonts.ready])
        .then(onFontsDone)
        .catch((error: unknown) => {
          if (!cancelled) {
            console.error('FleetLiveFooter: unable to load the wordmark font.', error);
          }
        });
      document.fonts.addEventListener('loadingdone', onFontsDone);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      mq.removeEventListener('change', onMotionChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.fonts?.removeEventListener('loadingdone', onFontsDone);
      wm.destroy();
      engineRef.current = null;
    };
    // The engine is created once; text changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const wm = engineRef.current;
    if (!wm) return;
    wm.setText(text);
    refit.current();
  }, [text]);

  return (
    <footer ref={rootRef} className={cx(styles.footer, className)}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label={text}
        data-testid="fleet-live-footer-wordmark"
      />
      <div className={cx(styles.shell, styles.top)}>
        <div className={styles.brandBlock}>
          <Link className={styles.brand} href="/">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
              <circle cx="11" cy="11" r="9" fill="none" stroke="#B8F23C" strokeOpacity=".35" />
              <circle cx="11" cy="11" r="3.5" fill="#B8F23C" />
            </svg>
            Fleet Live
          </Link>
          <p className={styles.desc}>{description}</p>
          <Link className={styles.btn} href={demoHref}>
            Launch demo
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M3 8h10M9 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>

        <nav className={styles.cols} aria-label="Footer">
          {cols.map((c) => (
            <div key={c.title}>
              <h2 className={styles.colTitle}>{c.title}</h2>
              <ul className={styles.list}>
                {c.links.map((l) => (
                  <li key={l.label}>
                    <Link className={styles.link} href={l.href}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className={cx(styles.shell, styles.mark)}>
        <div className={styles.wrap} ref={wrapRef} />
      </div>
    </footer>
  );
}
