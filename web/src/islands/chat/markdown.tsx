// Markdown → React for agent replies: react-markdown + remark-gfm (tables, task lists, strikethrough, autolinks) with
// chat typography on every element. Safe by construction: raw HTML is dropped, images render as their alt text and
// only http(s) and verynize:// links are clickable. Bare verynize:// URLs become links and single newlines inside a
// paragraph stay line breaks, like the agents write them.
import { memo, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { SquareCheckIcon, SquareIcon } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Element, ElementContent } from "hast";
import type { Parent, PhrasingContent, Root } from "mdast";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { workspace } from "./store";

/** Classifies a link target: only http(s) and verynize:// are ever clickable (no javascript:, data:, file: …). */
export function linkKind(href: string): "web" | "app" | null {
  const value = href.trim();
  if (/^https?:\/\//i.test(value)) return "web";
  if (/^verynize:\/\//i.test(value)) return "app";
  return null;
}

/** Opens a verynize:// link on the canvas; false when the workspace cannot handle it. */
export function openAppLink(href: string): boolean {
  const open = workspace()?.openLink;
  if (!open || linkKind(href) !== "app") return false;
  try {
    return open(href) !== false;
  } catch {
    return false;
  }
}

const LINK = "text-primary-text underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-hidden";

function Link({ href, children }: { href: string; children: ReactNode }) {
  const kind = linkKind(href);
  if (kind === "web")
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={LINK}>
        {children}
      </a>
    );
  if (kind === "app" && workspace()?.openLink)
    return (
      <a
        href={href}
        className={LINK}
        onClick={(event) => {
          event.preventDefault();
          openAppLink(href);
        }}
      >
        {children}
      </a>
    );
  return <span>{children}</span>;
}

/** Chat conventions on the parsed tree: bare verynize:// URLs become links, newlines inside a paragraph become breaks. */
const APP_URL = /verynize:\/\/[^\s<>()`]+/g;
const SKIP = new Set(["link", "linkReference", "inlineCode", "code", "html"]);
function splitText(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  const pushText = (text: string) =>
    text.split("\n").forEach((part, index) => {
      if (index > 0) out.push({ type: "break" });
      if (part) out.push({ type: "text", value: part });
    });
  let last = 0;
  for (const match of value.matchAll(APP_URL)) {
    // Trailing sentence punctuation is not part of the URL.
    const url = match[0].replace(/[.,;:!?'"]+$/, "");
    pushText(value.slice(last, match.index));
    out.push({ type: "link", url, children: [{ type: "text", value: url }] });
    last = match.index + url.length;
  }
  pushText(value.slice(last));
  return out;
}
function walk(node: Parent) {
  const next: Parent["children"] = [];
  for (const child of node.children) {
    if (child.type === "text" && /\n|verynize:\/\//.test(child.value)) next.push(...splitText(child.value));
    else {
      if ("children" in child && !SKIP.has(child.type)) walk(child);
      next.push(child);
    }
  }
  node.children = next;
}
const remarkChat = () => (tree: Root) => walk(tree);
const REMARK_PLUGINS = [remarkGfm, remarkChat];

const urlTransform = (url: string) => (linkKind(url) ? url : "");

function textOf(node: Element | ElementContent | undefined): string {
  if (!node) return "";
  if (node.type === "text") return node.value;
  return "children" in node ? node.children.map(textOf).join("") : "";
}

const CELL = "border-b border-border px-3 py-1.5 align-top first:pl-0 last:pr-0";
// Column alignment from the GFM delimiter row (utilities are !important here, so an inline text-align would lose).
const alignClass = (style: CSSProperties | undefined) =>
  style?.textAlign === "center" ? "text-center" : style?.textAlign === "right" ? "text-right" : "text-left";

const COMPONENTS: Components = {
  p: ({ children }) => <p>{children}</p>,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
  a: ({ href, children }) => <Link href={href ?? ""}>{children}</Link>,
  img: ({ alt }) => <span>{alt}</span>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del className="text-muted-foreground">{children}</del>,
  code: ({ children }) => <code className="rounded-sm border border-card-border bg-card px-1 font-mono text-sm">{children}</code>,
  // Fenced code: the text is taken from the tree so the inline `code` style above never applies inside it.
  pre: ({ node }) => (
    <pre className="overflow-x-auto rounded-lg border border-card-border bg-card px-3 py-2 font-mono text-xs whitespace-pre text-foreground-2">
      {textOf(node).replace(/\n$/, "")}
    </pre>
  ),
  blockquote: ({ children }) => <blockquote className="space-y-2.5 border-l-2 border-border pl-3.5 text-foreground-3">{children}</blockquote>,
  hr: () => <Separator decorative={false} />,
  ul: ({ children, className }) => (
    <ul className={className ? "space-y-0.5 pl-1" : "list-disc space-y-0.5 pl-5 marker:text-subtle-foreground"}>{children}</ul>
  ),
  ol: ({ children, start }) => (
    <ol start={start} className="list-decimal space-y-0.5 pl-5 marker:text-subtle-foreground">
      {children}
    </ol>
  ),
  li: ({ children, className }) => <li className={className ? "flex list-none items-start gap-1.5" : "space-y-1"}>{children}</li>,
  // Task list boxes: read-only, drawn as icons (legacy CSS restyles every <input>).
  input: ({ checked }) => {
    const Icon = checked ? SquareCheckIcon : SquareIcon;
    return (
      <span role="checkbox" aria-checked={!!checked} aria-disabled="true" aria-label={checked ? "Done" : "To do"} className="flex h-5.25 shrink-0 items-center">
        <Icon className={checked ? "size-3.5 text-primary-text" : "size-3.5 text-muted-foreground"} aria-hidden="true" />
      </span>
    );
  },
  // GFM tables (T3-style): rules between rows only, no outer box; first and last columns flush with the prose.
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => <th className={cn(CELL, alignClass(style), "font-semibold text-foreground")}>{children}</th>,
  td: ({ children, style }) => <td className={cn(CELL, alignClass(style), "max-w-96")}>{children}</td>,
};

function Heading({ children }: ComponentProps<"h1">) {
  return <p className="font-semibold text-foreground">{children}</p>;
}

/** Rendered Markdown with chat typography (14/21, 10px block rhythm). */
export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  return (
    <div data-chat-markdown="" className="space-y-2.5 break-words">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={urlTransform} skipHtml>
        {text}
      </ReactMarkdown>
    </div>
  );
});
