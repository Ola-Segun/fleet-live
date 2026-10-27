'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import DitheredShaderBackground from '@/components/ui/dithered-shader-background-1';
import { siteNavigation } from '@/components/ui/site-navigation';
import styles from './FleetLiveHero.module.css';
import { HeroScene, type Counters, type SceneAnchors, type SceneLayout } from './scene';

export interface NavLink {
  label: string;
  href: string;
}

export interface FleetLiveHeroProps {
  /** Where "Launch demo" goes. */
  demoHref?: string;
  /** Where the secondary link goes. */
  platformHref?: string;
  /** Header links (hidden on small screens). Pass [] to hide the link group. */
  navLinks?: readonly NavLink[];
  /** Set false if your site already renders its own header. */
  showNav?: boolean;
  className?: string;
}

const DEFAULT_LINKS: readonly NavLink[] = siteNavigation;

const COUNTERS = [
  { long: 'Late reordered', short: 'Reordered' },
  { long: 'Duplicates merged', short: 'Merged' },
  { long: 'Gaps bridged', short: 'Bridged' },
] as const;

const cx = (...a: (string | false | undefined)[]): string => a.filter(Boolean).join(' ');

export default function FleetLiveHero({
  demoHref = '/app',
  platformHref = '/platform',
  navLinks = DEFAULT_LINKS,
  showNav = true,
  className,
}: FleetLiveHeroProps) {
  const rootRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const numRefs = useRef<(HTMLElement | null)[]>([]);

  const renderActions = (className: string, testId?: string) => (
    <div className={cx(styles.cta, styles.rise, className)} data-testid={testId}>
      <Link className={styles.btn} href={demoHref}>
        Explore the live demo
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
      <Link className={styles.btnGhost} href={platformHref}>
        <span className={styles.long}>Discover the platform</span>
        <span className={styles.short}>Platform</span>
      </Link>
    </div>
  );

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let scene: HeroScene;
    try {
      scene = new HeroScene(canvas, {
        reducedMotion: mq.matches,
        onAnchors: ({ horizonY, dialCenterX, dialHalfWidth }: SceneAnchors) => {
          canvas.dataset.horizonY = String(horizonY);
          canvas.dataset.dialCenterX = String(dialCenterX);
          canvas.dataset.dialHalfWidth = String(dialHalfWidth);
        },
        onCounters: (v: Counters) => {
          v.forEach((n, i) => {
            const el = numRefs.current[i];
            if (el) el.textContent = String(n).padStart(4, '0');
          });
        },
      });
    } catch (error) {
      console.error('[Fleet Live hero] Could not initialize the animation; showing the static hero instead.', error);
      return;
    }

    let raf = 0;
    let visible = true;
    let pageVisible = !document.hidden;
    let lastP = -1;
    let elapsed = 0;
    let lastFrameAt = performance.now();

    // The scene composes itself around the measured copy block and counters strip,
    // so the layout stays correct whatever the phone, font or text wrapping.
    const fit = () => {
      const r = root.getBoundingClientRect();
      const layout: SceneLayout = {};
      const copy = copyRef.current;
      const foot = footRef.current;
      if (copy) layout.topInset = copy.offsetTop + copy.offsetHeight;
      if (foot) layout.bottomInset = root.clientHeight - foot.offsetTop + (root.clientWidth < 820 ? 80 : 12);
      scene.resize(r.width, r.height, window.devicePixelRatio || 1, layout);
      if (mq.matches) {
        scene.render(9);
        canvas.dataset.sceneState = 'static';
      }
    };

    const frame = (now: number) => {
      raf = 0;
      if (!visible || !pageVisible) return;
      elapsed += Math.min((now - lastFrameAt) / 1000, 0.05);
      lastFrameAt = now;
      const r = root.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, -r.top / (r.height * 0.75)));
      if (Math.abs(p - lastP) > 0.002) {
        lastP = p;
        root.style.setProperty('--p', p.toFixed(3));
        scene.setScroll(p);
      }
      scene.render(elapsed);
      canvas.dataset.sceneState = 'animated';
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (!raf && visible && pageVisible && !mq.matches) {
        lastFrameAt = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const pause = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      if (pageVisible) start();
      else pause();
    };

    const onPoint = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      scene.setPointer(e.clientX - r.left, e.clientY - r.top, true, e.pointerType === 'touch');
    };
    const onEnd = () => scene.setPointer(0, 0, false);

    const onMotionChange = () => {
      scene.setReducedMotion(mq.matches);
      if (mq.matches) {
        cancelAnimationFrame(raf);
        raf = 0;
        lastP = -1;
        root.style.removeProperty('--p');
        fit();
      } else {
        canvas.dataset.sceneState = 'ready';
        start();
      }
    };

    const ro = new ResizeObserver(fit);
    ro.observe(root);
    if (copyRef.current) ro.observe(copyRef.current); // re-compose when fonts load or text rewraps
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      visible = e ? e.isIntersecting : true;
      if (visible) start();
      else pause();
    });
    io.observe(root);

    root.addEventListener('pointerdown', onPoint);
    root.addEventListener('pointermove', onPoint);
    root.addEventListener('pointerup', onEnd);
    root.addEventListener('pointercancel', onEnd);
    root.addEventListener('pointerleave', onEnd);
    document.addEventListener('visibilitychange', onVisibilityChange);
    mq.addEventListener('change', onMotionChange);

    fit();
    if (!mq.matches) canvas.dataset.sceneState = 'ready';
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener('pointerdown', onPoint);
      root.removeEventListener('pointermove', onPoint);
      root.removeEventListener('pointerup', onEnd);
      root.removeEventListener('pointercancel', onEnd);
      root.removeEventListener('pointerleave', onEnd);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      mq.removeEventListener('change', onMotionChange);
      scene.destroy();
    };
  }, []);

  return (
    <section ref={rootRef} className={cx(styles.hero, className)} aria-labelledby="fleet-live-hero-title" data-testid="fleet-live-hero">
      <DitheredShaderBackground scale={0.2} className={styles.shaderEdge} />
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        role="img"
        aria-label="Illustrative simulation: noisy vehicle reports pass through a signal dial, converge, and launch up a vertical channel as smoother, ordered tracks. A simulated geofence event is highlighted."
        data-testid="fleet-live-hero-scene"
      />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={styles.grain} aria-hidden="true" />

      {showNav && (
        <header className={styles.navWrap}>
          <nav className={cx(styles.shell, styles.nav, styles.panel)} aria-label="Primary">
            <Link className={styles.brand} href="/">
              <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
                <circle cx="11" cy="11" r="9" fill="none" stroke="#C8ED73" strokeOpacity=".35" />
                <circle cx="11" cy="11" r="3.5" fill="#C8ED73" />
              </svg>
              Fleet Live
            </Link>
            {navLinks.length > 0 && (
              <div className={styles.links}>
                {navLinks.map((l) => (
                  <Link key={l.label} href={l.href}>
                    {l.label}
                  </Link>
                ))}
              </div>
            )}
            <Link className={cx(styles.btn, styles.btnSm)} href={demoHref}>
              Launch demo
            </Link>
          </nav>
        </header>
      )}

      <div className={styles.copyWrap} ref={copyRef} data-testid="fleet-live-hero-copy">
        <div className={cx(styles.shell, styles.copy)}>
          <div className={cx(styles.chip, styles.panel, styles.rise)} style={{ ['--d' as string]: 300 }}>
            <i aria-hidden="true" />
            SIMULATED FLEET · INTERACTIVE DEMO
          </div>
          <h1 id="fleet-live-hero-title" className={styles.h1}>
            <span className={styles.ln}>
              <span style={{ ['--d' as string]: 450 }}>Fleet ops.</span>
            </span>
            <span className={styles.ln}>
              <span style={{ ['--d' as string]: 600 }}>Without the{' '}
                <span className={styles.noise} data-t="noise" data-testid="fleet-live-hero-noise" aria-hidden="true">noise</span>
                <span className="sr-only">noise</span>.
              </span>
            </span>
          </h1>
          <p className={cx(styles.sub, styles.rise)} style={{ ['--d' as string]: 900 }}>
            Turn noisy fleet signals into a clear, actionable picture.
          </p>
          {renderActions(styles.desktopActions, 'fleet-live-hero-desktop-actions')}
        </div>
      </div>

      <div className={styles.footRow} ref={footRef}>
        <div className={cx(styles.shell, styles.footInner)}>
          {renderActions(styles.mobileActions, 'fleet-live-hero-mobile-actions')}
          <div className={styles.hud} aria-hidden="true" data-testid="fleet-live-hero-counters">
            <p className={styles.hudTag}>
              <i /> Illustrative signal counters · simulated
            </p>
            <div className={cx(styles.cells, styles.panel)}>
              {COUNTERS.map((c, i) => (
                <div className={styles.cell} key={c.long}>
                  <span className={styles.cellLabel}>
                    <span className={styles.long}>{c.long}</span>
                    <span className={styles.short}>{c.short}</span>
                  </span>
                  <b
                    className={styles.num}
                    ref={(el) => {
                      numRefs.current[i] = el;
                    }}
                  >
                    0000
                  </b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
