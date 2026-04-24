import { ReactNode } from "react";

interface WidgetWrapperProps {
  title: string;
  editMode: boolean;
  onRemove?: () => void;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function WidgetWrapper({
  title,
  editMode,
  onRemove,
  actions,
  children,
  className,
}: WidgetWrapperProps) {
  return (
    <div
      className={`widget-wrapper card${editMode ? " widget-edit-mode" : ""}${className ? ` ${className}` : ""}`}
    >
      <div className="widget-header">
        {editMode && (
          <span className="widget-drag-handle" title="Drag to reorder">
            ⠿
          </span>
        )}
        <span className="widget-title">{title}</span>
        {editMode && actions}
        {editMode && onRemove && (
          <button
            className="widget-remove-btn btn-ghost btn-sm"
            onClick={onRemove}
            title="Remove widget"
          >
            ✕
          </button>
        )}
      </div>
      <div className="widget-content">{children}</div>
    </div>
  );
}
