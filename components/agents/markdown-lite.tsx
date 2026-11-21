import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, idx) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={idx} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
      : <span key={idx}>{part}</span>,
  );
}

/** Markdown tối giản (tiêu đề, danh sách, in đậm) đủ cho câu trả lời của AI — dùng chung cho các khung chat agent. */
export function MarkdownLite({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, idx) => <li key={idx}>{renderInline(item)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="list-decimal pl-5 space-y-1">{items}</ol>
      : <ul key={blocks.length} className="list-disc pl-5 space-y-1">{items}</ul>);
    list = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      blocks.push(
        <h4 key={blocks.length} className="text-[11px] font-black uppercase tracking-wider text-indigo-700 pt-1">
          {renderInline(heading[1])}
        </h4>,
      );
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ||= { ordered, items: [] };
      list.items.push((bullet || numbered)![1]);
    } else if (!line.trim()) {
      flush();
    } else {
      flush();
      blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}
