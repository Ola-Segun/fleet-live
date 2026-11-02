'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import s from './fleet-ui.module.css';

function markerCenterOffset(): number {
  return window.matchMedia('(max-width: 640px)').matches ? 19 : 24;
}

function markerViewportY(): number {
  return window.innerHeight * 0.42 + markerCenterOffset();
}

export function TimelineProgress({
  initialIndex,
  children,
}: {
  initialIndex: number;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rows = root.querySelectorAll<HTMLElement>('[data-timeline-row]');
      if (rows.length === 0) return;

      const markerDocumentY = window.scrollY + markerViewportY();
      const rootRect = root.getBoundingClientRect();
      const rootDocumentY = rootRect.top + window.scrollY;
      const nodeSize = Number.parseFloat(getComputedStyle(root).getPropertyValue('--node-size')) || 48;
      const markerHalf = nodeSize / 2;
      const rowCenters = [...rows].map((row) => row.getBoundingClientRect().top + window.scrollY + 18 + markerHalf);
      const firstCenter = rowCenters[0];
      const lastCard = rows[rows.length - 1].querySelector<HTMLElement>('article');
      const lastCardBottom = lastCard
        ? lastCard.getBoundingClientRect().bottom + window.scrollY
        : rowCenters[rowCenters.length - 1];
      const markerCenterDocumentY = Math.max(
        firstCenter,
        Math.min(markerDocumentY, lastCardBottom - markerHalf),
      );
      root.style.setProperty('--marker-top', `${markerCenterDocumentY - rootDocumentY - markerHalf}px`);

      const railStart = rootDocumentY + 28;
      const railLength = Math.max(1, rootRect.height - 56);
      const progress = Math.max(0, Math.min(1, (markerCenterDocumentY - railStart) / railLength));
      root.style.setProperty('--progress', String(progress));

      let nextIndex = 0;
      rowCenters.forEach((nodeCenterDocumentY, index) => {
        if (nodeCenterDocumentY <= markerDocumentY) nextIndex = index;
      });

      rows.forEach((row, index) => {
        const active = index === nextIndex;
        row.dataset.active = String(active);
        row.querySelector('article')?.classList.toggle(s.lit, active);
      });
      setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
    };
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    scheduleUpdate();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(root);

    return () => {
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={rootRef} className={s.tl} data-active-index={activeIndex}>
      <i className={s.rail} aria-hidden="true" />
      <span className={s.tlActiveNode} aria-hidden="true" data-timeline-marker>
        {String(activeIndex + 1).padStart(2, '0')}
      </span>
      {children}
    </div>
  );
}
