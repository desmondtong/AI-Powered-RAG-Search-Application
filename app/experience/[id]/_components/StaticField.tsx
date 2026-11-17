/**
 * The read-only counterpart of `InlineField`: the same label and caption markup with the value as plain text and no
 * control at all. Used by the approved-revision view (design Decision 4).
 */
export default function StaticField({
  label,
  value,
  placeholder = "Not stated",
  caption,
  multiline = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  caption?: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-label-caps uppercase text-ink-muted">{label}</div>
      <p className={`break-words py-0.5 text-body-md ${value ? "text-ink" : "italic text-ink-muted"} ${multiline ? "whitespace-pre-wrap" : ""}`}>
        {value || placeholder}
      </p>
      {caption && <div className="text-body-sm text-ink-muted">{caption}</div>}
    </div>
  );
}
