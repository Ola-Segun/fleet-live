import type { CSSProperties } from 'react';

export const cx = (...classes: (string | false | null | undefined)[]): string => classes.filter(Boolean).join(' ');
export const cssVars = (values: Record<string, string | number>): CSSProperties => values as CSSProperties;
