import Markdown from "react-markdown";

interface Props {
  content: string;
  className?: string;
  maxHeight?: string;
}

export default function SpecMarkdown({ content, className = "", maxHeight }: Props) {
  return (
    <div
      className={`overflow-auto ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Markdown
        components={{
          h1: ({ children }) => (
            <h1 className="text-[13px] font-bold text-text-primary mt-3 mb-1.5 pb-1 border-b border-border-subtle">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[12px] font-semibold text-text-primary mt-2.5 mb-1">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-[11px] font-semibold text-text-secondary mt-2 mb-1">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-[11px] text-text-secondary leading-relaxed mb-1.5">
              {children}
            </p>
          ),
          code: (props) => {
            const { children, className: cls } = props;
            if (cls?.startsWith("language-")) {
              return (
                <pre className="bg-elevated rounded-lg p-3 overflow-auto text-[11px] font-mono text-text-secondary my-2 leading-relaxed">
                  <code>{children}</code>
                </pre>
              );
            }
            return (
              <code className="font-mono text-[11px] px-1 py-0.5 rounded bg-elevated text-accent">
                {children}
              </code>
            );
          },
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="w-full text-[11px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b border-border-subtle bg-surface">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="text-left text-[10px] text-text-muted font-semibold uppercase tracking-wider px-2 py-1.5 whitespace-nowrap">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-2 py-1.5 border-b border-border-subtle text-text-secondary align-top">
              {children}
            </td>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-elevated/40 transition-colors">{children}</tr>
          ),
          ul: ({ children }) => (
            <ul className="list-disc ml-4 my-1 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-4 my-1 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-[11px] text-text-secondary leading-relaxed">{children}</li>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-text-primary">{children}</strong>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/40 pl-3 my-1.5 text-text-muted italic text-[11px]">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border-subtle my-2" />,
          a: ({ children, href }) => (
            <span className="text-accent underline cursor-pointer" title={href ?? ""}>
              {children}
            </span>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
