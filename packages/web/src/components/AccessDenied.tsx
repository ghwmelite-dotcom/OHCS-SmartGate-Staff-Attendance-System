import { ShieldAlert } from 'lucide-react';

// Full-page 403 state for role-gated modules (Analytics, Reports). Rendered
// when the API rejects the page's queries with FORBIDDEN — e.g. a direct URL
// visit by a role the nav already hides the item from.
export function AccessDenied({ module }: { module: string }) {
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-10 text-center animate-fade-in-up max-w-xl mx-auto">
      <div className="w-14 h-14 bg-danger/10 rounded-full flex items-center justify-center mx-auto mb-4">
        <ShieldAlert className="h-7 w-7 text-danger" />
      </div>
      <h2 className="text-[18px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
        No access to this module
      </h2>
      <p className="text-[14px] text-muted mt-1.5">
        You don't have access to {module}. If you think this is a mistake, contact an administrator.
      </p>
    </div>
  );
}
