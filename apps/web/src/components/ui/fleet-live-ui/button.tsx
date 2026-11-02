'use client';

import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';
import s from './fleet-ui.module.css';
import { cx } from './utils';

function ArrowIcon({ dir }: { dir: 'right' | 'up-right' }) {
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

export function Button({
  href,
  variant = 'lime',
  arrow = 'right',
  size = 'md',
  external,
  onClick,
  className,
  children,
}: ButtonProps) {
  const cls = cx(
    s.btn,
    variant === 'lime' ? s.btnLime : variant === 'dark' ? s.btnDark : s.btnGhost,
    size === 'sm' && s.btnSm,
    className,
  );
  const inner = (
    <>
      {children}
      {arrow ? <ArrowIcon dir={arrow} /> : null}
    </>
  );
  if (!href) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {inner}
      </button>
    );
  }
  return (
    <Link
      className={cls}
      href={href}
      onClick={onClick}
      {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
    >
      {inner}
    </Link>
  );
}
