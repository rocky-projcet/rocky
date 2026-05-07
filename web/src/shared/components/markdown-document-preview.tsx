import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/shared/lib/utils";

const defaultMarkdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 border-b border-border pb-3 text-2xl font-semibold leading-tight tracking-normal text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-6 border-b border-border/70 pb-2 text-xl font-semibold leading-tight tracking-normal text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-5 text-base font-semibold leading-7 text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-4 text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mt-3 leading-7 text-foreground first:mt-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-2 pl-5 marker:text-muted-foreground first:mt-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-2 pl-5 marker:text-muted-foreground first:mt-0">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 border-l-2 border-border bg-muted/30 px-4 py-2 text-muted-foreground first:mt-0">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) =>
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-foreground underline decoration-border underline-offset-4 transition hover:decoration-foreground"
      >
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  hr: () => <hr className="my-5 border-border" />,
  table: ({ children }) => (
    <div className="custom-scrollbar mt-4 overflow-x-auto rounded-lg border border-border bg-card first:mt-0">
      <table className="min-w-full border-collapse text-left text-sm leading-6">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-secondary/80 text-foreground">{children}</thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border bg-background">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="divide-x divide-border align-top">{children}</tr>
  ),
  th: ({ children, style }) => (
    <th
      className="whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground"
      style={style}
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-3 py-2 text-foreground" style={style}>
      {children}
    </td>
  ),
  pre: ({ children }) => (
    <div className="custom-scrollbar mt-4 overflow-x-auto rounded-lg border border-border bg-slate-950 px-4 py-4 text-slate-100 first:mt-0">
      <pre className="w-fit min-w-full whitespace-pre font-mono text-xs leading-6">
        {children}
      </pre>
    </div>
  ),
  code: ({ className, children }) => {
    const content =
      typeof children === "string"
        ? children
        : Array.isArray(children)
          ? children
              .map((child) => (typeof child === "string" ? child : ""))
              .join("")
          : "";
    const isBlockCode =
      Boolean(className?.includes("language-")) || content.includes("\n");

    if (isBlockCode) {
      return <code className={cn("font-mono text-slate-100", className)}>{children}</code>;
    }

    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground">
        {children}
      </code>
    );
  },
};

export function MarkdownDocumentPreview({
  className,
  components,
  markdown,
}: {
  className?: string;
  components?: Components;
  markdown: string;
}) {
  return (
    <div
      className={cn(
        "custom-scrollbar h-full overflow-y-auto px-6 py-5 text-sm leading-7 text-foreground",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...defaultMarkdownComponents,
          ...components,
        }}
      >
        {markdown || "빈 파일입니다."}
      </ReactMarkdown>
    </div>
  );
}
