import { CheckCircle2 } from 'lucide-react';
import { toast } from '@/stores/toast';

/**
 * One-time display of an admin-issued initial/reset PIN. Shown immediately
 * after a provision / reset / registration call returns the PIN; the server
 * only stores a hash, so this is the admin's single chance to record it.
 */
export function PinResultModal({ name, identifier, pin, onClose }: {
  name: string; identifier: string | null; pin: string; onClose: () => void;
}) {
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.success('Copied to clipboard'),
      () => toast.error('Copy failed — select and copy manually'),
    );
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-success/30 w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #2E7D5B, #5BA77B 50%, #2E7D5B)' }} />
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-success" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                {name}
              </p>
              <p className="text-[12px] font-mono text-muted">{identifier ?? '—'}</p>
            </div>
          </div>
          <div className="rounded-xl bg-background border border-border p-4">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
              New initial PIN — shown once
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[28px] font-mono font-bold tracking-[0.4em] text-primary">{pin}</span>
              <button
                onClick={() => copy(pin)}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[12px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/15 transition-all"
              >
                Copy
              </button>
            </div>
          </div>
          <p className="text-[12px] text-muted">
            Hand this PIN to them privately. They will be required to set a new one on next sign-in.
          </p>
          <div className="flex justify-end pt-2">
            <button
              onClick={onClose}
              className="h-10 px-5 text-[13px] font-semibold bg-primary text-white rounded-xl hover:bg-primary-light transition-all shadow-sm"
            >
              I&apos;ve recorded this
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
