import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: radius ?? 'var(--radius-sm)', ...style }}
      aria-hidden="true"
    />
  );
}

/** A few stacked skeleton lines, last one shorter — for text placeholders. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

/** Skeleton rows for list/table loading states. */
export function SkeletonRows({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={height} radius="var(--radius-md)" />
      ))}
    </div>
  );
}
