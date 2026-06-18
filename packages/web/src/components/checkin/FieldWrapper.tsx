import type { ReactNode } from 'react';

export function FieldWrapper({
  icon,
  label,
  error,
  children,
}: {
  icon?: ReactNode;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5">
        {icon && <span className="text-muted">{icon}</span>}
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}
