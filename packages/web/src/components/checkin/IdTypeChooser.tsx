import { CreditCard } from 'lucide-react';
import { ID_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { FieldWrapper } from './FieldWrapper';

export type IdTypeValue = typeof ID_TYPES[number]['value'];

export function IdTypeChooser({
  idType,
  onIdTypeChange,
  idTypeError,
}: {
  idType: IdTypeValue | '' | undefined;
  onIdTypeChange: (v: IdTypeValue | undefined) => void;
  idTypeError?: string;
}) {
  return (
    <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Type" error={idTypeError}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {ID_TYPES.map((t) => {
          const isSelected = idType === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => onIdTypeChange(isSelected ? undefined : t.value)}
              className={cn(
                'h-11 px-3 rounded-xl text-[13px] font-medium border transition-all text-left',
                isSelected
                  ? 'bg-primary/10 border-primary/30 text-primary'
                  : 'bg-background border-border text-foreground hover:border-primary/20'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </FieldWrapper>
  );
}
