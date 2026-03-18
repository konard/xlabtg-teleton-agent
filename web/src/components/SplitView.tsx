import { useRef, useCallback, ReactNode } from 'react';

interface SplitViewProps {
  left: ReactNode;
  right: ReactNode;
}

export function SplitView({ left, right }: SplitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current || !leftRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(Math.max(pct, 20), 80);
      leftRef.current.style.width = `${clamped}%`;
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="split-view">
      <div ref={leftRef} className="split-pane split-pane-left">
        {left}
      </div>
      <div
        className="split-divider"
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />
      <div className="split-pane split-pane-right">
        {right}
      </div>
    </div>
  );
}
