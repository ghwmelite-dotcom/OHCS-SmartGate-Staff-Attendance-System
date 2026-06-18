import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function StepIndicator({ steps, currentIdx }: {
  steps: { key: string; label: string }[];
  currentIdx: number;
}) {
  return (
    <div className="flex items-center gap-1 ml-auto">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold',
              i < currentIdx
                ? 'bg-success text-white'
                : i === currentIdx
                  ? 'bg-primary text-white'
                  : 'bg-border text-muted'
            )}
          >
            {i < currentIdx ? <Check className="h-3 w-3" /> : i + 1}
          </span>
          <span className={cn('text-xs', i === currentIdx ? 'text-foreground font-medium' : 'text-muted')}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-border-strong mx-1">—</span>}
        </div>
      ))}
    </div>
  );
}
