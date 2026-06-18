import { CheckCircle2, Building2 } from 'lucide-react';
import type { Directorate } from '@/lib/api';
import { ROUTING_KEYWORDS, suggestDirectorate } from '@/lib/directorate-routing';

export function PurposeRoutingHint({ purpose, directorates, currentDirectorateId, onAccept }: {
  purpose: string;
  directorates: Directorate[];
  currentDirectorateId: string;
  onAccept: (id: string) => void;
}) {
  const suggestion = suggestDirectorate(purpose, directorates);
  if (!suggestion) return null;

  const route = ROUTING_KEYWORDS.find(r => r.abbreviation === suggestion.abbreviation);
  const alreadySelected = currentDirectorateId === suggestion.id;

  if (alreadySelected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-success/8 border border-success/15 rounded-xl text-[13px] animate-fade-in">
        <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
        <span className="text-success font-medium">
          Routing to {suggestion.abbreviation}{route?.room ? ` — ${route.room}` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-accent/8 border border-accent/15 rounded-xl animate-fade-in">
      <div className="flex items-center gap-2 text-[13px]">
        <Building2 className="h-4 w-4 text-accent-warm shrink-0" />
        <span className="text-foreground">
          Suggested: <strong>{suggestion.abbreviation}</strong> — {suggestion.name}
          {route?.room ? <span className="text-muted"> ({route.room})</span> : ''}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onAccept(suggestion.id)}
        className="h-7 px-3 text-[12px] font-semibold bg-accent text-white rounded-lg hover:brightness-110 transition-all shrink-0"
      >
        Accept
      </button>
    </div>
  );
}
