import { Fragment } from "react";

/** Plain text with paragraphs and clickable links. Never renders HTML from the post. */
export function Body({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-3 text-[14.5px] leading-relaxed ${className}`}>
      {text.split(/\n{2,}/).map((para, i) => (
        <p key={i} className="!m-0 whitespace-pre-line">
          {para.split(/(https?:\/\/[^\s<>()]+)/g).map((part, j) =>
            /^https?:\/\//.test(part) ? (
              <a key={j} href={part} target="_blank" rel="noreferrer noopener">{part}</a>
            ) : (
              <Fragment key={j}>{part}</Fragment>
            ),
          )}
        </p>
      ))}
    </div>
  );
}
