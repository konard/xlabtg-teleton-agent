import { CSSProperties } from 'react';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
  style?: CSSProperties;
  className?: string;
}

export function Skeleton({ width, height, borderRadius = '6px', style, className }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ width, height, borderRadius, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, lastLineWidth = '60%' }: { lines?: number; lastLineWidth?: string }) {
  return (
    <div className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="14px"
          width={i === lines - 1 ? lastLineWidth : '100%'}
          style={{ marginBottom: i < lines - 1 ? '8px' : 0 }}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = '80px' }: { height?: string }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <Skeleton height={height} borderRadius="var(--radius-md)" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row" style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height="36px" style={{ flex: 1 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="page-loader" role="status" aria-label="Loading">
      <div className="spinner" aria-hidden="true" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}
