import { CreditCard } from 'lucide-react';
import { ID_TYPES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { FieldWrapper } from './FieldWrapper';

export type IdTypeValue = typeof ID_TYPES[number]['value'];

export const ID_TYPE_CONFIG: Record<string, { label: string; placeholder: string; hint: string; format?: (v: string) => string }> = {
  ghana_card: {
    label: 'Ghana Card Number',
    placeholder: 'GHA-XXXXXXXXX-X',
    hint: 'Format: GHA-000000000-0',
    format: (v: string) => {
      const digits = v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (digits.length <= 3) return digits;
      if (digits.length <= 12) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
      return `${digits.slice(0, 3)}-${digits.slice(3, 12)}-${digits.slice(12, 13)}`;
    },
  },
  passport: {
    label: 'Passport Number',
    placeholder: 'G0123456',
    hint: 'Ghana passport number',
    format: (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 9),
  },
  drivers_license: {
    label: 'License Number',
    placeholder: 'DL-00000000-00',
    hint: "DVLA driver's license number",
    format: (v: string) => {
      const clean = v.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (clean.length <= 2) return clean;
      if (clean.length <= 10) return `${clean.slice(0, 2)}-${clean.slice(2)}`;
      return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10, 12)}`;
    },
  },
  staff_id: { label: 'Staff ID Number', placeholder: '12345', hint: 'Government staff identification' },
  other: { label: 'ID Number', placeholder: 'Enter ID number', hint: 'Enter the identification number' },
};

const DEFAULT_INPUT_CLS =
  'w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary';

export function SmartIdFields({
  idType,
  idNumber,
  onIdTypeChange,
  onIdNumberChange,
  idTypeError,
  idNumberError,
  inputClassName = DEFAULT_INPUT_CLS,
}: {
  idType: IdTypeValue | '' | undefined;
  idNumber: string;
  onIdTypeChange: (v: IdTypeValue | undefined) => void;
  onIdNumberChange: (v: string) => void;
  idTypeError?: string;
  idNumberError?: string;
  inputClassName?: string;
}) {
  const config = idType ? ID_TYPE_CONFIG[idType] : null;

  return (
    <div className="space-y-4">
      <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label="ID Type" error={idTypeError}>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {ID_TYPES.map((t) => {
            const isSelected = idType === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  if (isSelected) { onIdTypeChange(undefined); onIdNumberChange(''); }
                  else onIdTypeChange(t.value);
                }}
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

      {config && (
        <div className="animate-fade-in-up">
          <FieldWrapper icon={<CreditCard className="h-4 w-4" />} label={config.label} error={idNumberError}>
            <input
              value={idNumber}
              className={inputClassName}
              placeholder={config.placeholder}
              onChange={(e) => onIdNumberChange(config.format ? config.format(e.target.value) : e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">{config.hint}</p>
          </FieldWrapper>
        </div>
      )}
    </div>
  );
}
