// Renders the host's Telegram arrival response as a small chip (spec §5).
// Read-only reception signal; absent/unknown → nothing.
const CONFIG = {
  coming_down:  { emoji: '⬇️', label: 'Coming down', className: 'bg-success/10 text-success' },
  waiting_area: { emoji: '🪑', label: 'Waiting area', className: 'bg-accent/10 text-accent-warm' },
  reschedule:   { emoji: '📅', label: 'Reschedule', className: 'bg-danger/10 text-danger' },
} as const;

export function HostResponseChip({ value }: { value?: string | null }) {
  if (!value) return null;
  const cfg = CONFIG[value as keyof typeof CONFIG];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center h-6 px-2 text-[10px] font-bold rounded-lg ${cfg.className}`}>
      {cfg.emoji} {cfg.label}
    </span>
  );
}
