import { Children, cloneElement, isValidElement, useId } from 'react';
import type { ReactElement, ReactNode } from 'react';

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
  // Associate the visible label with the field's control so screen-reader users
  // hear the field name. We generate an id and point the <label> at it via
  // htmlFor; the id is cloned onto the single child control when it doesn't
  // already carry one. (Cloning — rather than nesting children inside <label> —
  // keeps button-group fields like the ID-type picker from being swallowed by
  // the label.)
  const fieldId = useId();
  const childArray = Children.toArray(children);
  const onlyChild = childArray.length === 1 ? childArray[0] : null;
  const labelledChild =
    onlyChild && isValidElement(onlyChild) && (onlyChild.props as { id?: string }).id === undefined
      ? (onlyChild as ReactElement<{ id?: string }>)
      : null;

  return (
    <div>
      <label
        htmlFor={labelledChild ? fieldId : undefined}
        className="flex items-center gap-1.5 text-xs font-medium text-foreground mb-1.5"
      >
        {icon && <span className="text-muted">{icon}</span>}
        {label}
      </label>
      {labelledChild ? cloneElement(labelledChild, { id: fieldId }) : children}
      {error && <p className="text-danger text-xs mt-1">{error}</p>}
    </div>
  );
}
