"use client";

import { useEffect, useRef, useState } from "react";
import { EditIcon } from "@/app/components/icons";

/**
 * A value shown as text that turns into an input when activated. Enter or blur commits, Escape cancels. Multiline
 * values use a textarea, where Enter inserts a line break and Cmd/Ctrl+Enter commits.
 */
export default function InlineField({
  label,
  value,
  placeholder = "Not stated",
  caption,
  multiline = false,
  invalid = false,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  caption?: string | null;
  multiline?: boolean;
  invalid?: boolean;
  onCommit: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (text !== value) onCommit(text);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const cancel = () => {
    setText(value);
    setEditing(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const fieldClass = `w-full rounded-control border bg-card px-2 py-1 text-body-md text-ink focus:border-cobalt focus:outline-none ${
    invalid ? "border-red" : "border-hairline-strong"
  }`;

  return (
    <div className="min-w-0">
      <div className="text-label-caps uppercase text-ink-muted">{label}</div>
      {editing ? (
        multiline ? (
          <textarea
            ref={inputRef}
            aria-label={label}
            value={text}
            rows={3}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                commit();
              }
            }}
            className={`${fieldClass} resize-y`}
          />
        ) : (
          <input
            ref={inputRef}
            aria-label={label}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              } else if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
            }}
            className={fieldClass}
          />
        )
      ) : (
        <button
          ref={buttonRef}
          type="button"
          aria-label={`${label}: ${value || placeholder}. Edit`}
          onClick={() => {
            setText(value);
            setEditing(true);
          }}
          className={`group -mx-1 flex w-[calc(100%+0.5rem)] items-start justify-between gap-2 rounded-control px-1 py-0.5 text-left text-body-md hover:bg-subtle ${
            value ? "text-ink" : "italic text-ink-muted"
          } ${invalid ? "ring-1 ring-red" : ""}`}
        >
          <span className="min-w-0 whitespace-pre-wrap break-words">{value || placeholder}</span>
          {/* Visible before hover, so an editable field never looks like read-only text. */}
          <EditIcon size={14} className="mt-1 shrink-0 text-ink-muted group-hover:text-cobalt group-focus-visible:text-cobalt" />
        </button>
      )}
      {caption && <div className="text-body-sm text-ink-muted">{caption}</div>}
    </div>
  );
}

/** A small select styled as a pill, for kind, attribution and activity status. */
export function PillSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-hairline bg-subtle py-0.5 pl-2 pr-1 text-label-md text-ink-secondary focus-within:border-cobalt">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="cursor-pointer bg-transparent pr-1 text-label-md text-ink focus:outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
