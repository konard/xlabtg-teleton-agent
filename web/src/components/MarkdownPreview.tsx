import { useMemo } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownPreviewProps {
  content: string;
}

// Highlight {{variable}} template expressions in text nodes
function highlightTemplateVars(text: string): ReactNode[] {
  const parts = text.split(/({{[\w.]+}})/g);
  return parts.map((part, i) =>
    /^{{[\w.]+}}$/.test(part)
      ? <span key={i} className="md-template-var">{part}</span>
      : part
  );
}

// Custom renderer for paragraph text to highlight template vars
function renderText(text: string): ReactNode {
  return <>{highlightTemplateVars(text)}</>;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  // Debounce is handled upstream; memo avoids unnecessary re-renders on same content
  const renderedContent = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Highlight template vars in paragraph text
        p: ({ children }) => <p>{processChildren(children)}</p>,
        li: ({ children, ...props }) => <li {...(props as object)}>{processChildren(children)}</li>,
        td: ({ children, ...props }) => <td {...(props as object)}>{processChildren(children)}</td>,
        th: ({ children, ...props }) => <th {...(props as object)}>{processChildren(children)}</th>,
      }}
    >
      {content}
    </ReactMarkdown>
  ), [content]);

  return (
    <div className="md-preview">
      {content.trim() ? renderedContent : (
        <p className="md-preview-empty">Nothing to preview yet.</p>
      )}
    </div>
  );
}

// Walk React children and highlight template vars in plain strings
function processChildren(children: ReactNode): ReactNode {
  if (typeof children === 'string') return renderText(children);
  if (Array.isArray(children)) return children.map((child, i) =>
    typeof child === 'string'
      ? <span key={i}>{renderText(child)}</span>
      : child
  );
  return children;
}
