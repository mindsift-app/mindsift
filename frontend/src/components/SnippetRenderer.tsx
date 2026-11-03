import React, { useMemo } from 'react';

// Safely render snippet containing <mark>...</mark> without dangerouslySetInnerHTML
export const SnippetRenderer: React.FC<{ snippet: string }> = ({ snippet }) => {
  const parts = useMemo(() => {
    if (!snippet) return [];
    return snippet.split(/(<mark>[\s\S]*?<\/mark>)/g);
  }, [snippet]);

  return (
    <span className="text-muted text-xs line-clamp-2 leading-relaxed">
      {parts.map((part, i) => {
        if (part.startsWith('<mark>') && part.endsWith('</mark>')) {
          const text = part.slice(6, -7);
          return (
            <mark
              key={i}
              className="bg-accent-dim text-accent font-semibold px-0.5 rounded"
            >
              {text}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
};
