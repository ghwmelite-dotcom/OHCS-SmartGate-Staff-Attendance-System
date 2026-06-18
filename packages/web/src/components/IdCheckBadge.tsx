// Renders a small badge from a visit's `id_photo_check` JSON. Read-only audit
// signal; absent/unparseable → nothing. Never throws.
export function IdCheckBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  let verdict: string | undefined;
  try { verdict = (JSON.parse(value) as { verdict?: string }).verdict; } catch { return null; }

  if (verdict === 'document') {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-success/10 text-success">ID ✓</span>;
  }
  if (verdict === 'not_document') {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-danger/10 text-danger">ID ⚠</span>;
  }
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-border text-muted">ID ?</span>;
}
