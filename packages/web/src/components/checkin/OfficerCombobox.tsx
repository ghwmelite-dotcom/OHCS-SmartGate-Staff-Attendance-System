import { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OfficerOption {
  id: string;
  name: string;
  title?: string | null;
  directorate_id: string;
  directorate_abbr?: string | null;
}

interface OfficerComboboxProps {
  officers: OfficerOption[];
  /** Called when the visitor picks an officer from the list. */
  onSelect: (officer: OfficerOption) => void;
  /** Called whenever the typed value changes (manual / unlinked name). */
  onManual: (name: string) => void;
  placeholder?: string;
  inputClassName?: string;
  /** 'lg' for kiosk touch targets (52px rows); 'sm' for desktop VMS. */
  rowSize?: 'sm' | 'lg';
}

const MAX_RESULTS = 8;

export function OfficerCombobox({
  officers,
  onSelect,
  onManual,
  placeholder = 'Search or type a name…',
  inputClassName,
  rowSize = 'sm',
}: OfficerComboboxProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedName, setSelectedName] = useState('');
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered =
    query.length >= 1
      ? officers
          .filter((o) => o.name.toLowerCase().includes(query.toLowerCase()))
          .slice(0, MAX_RESULTS)
      : [];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [isOpen]);

  function handleInput(value: string) {
    setQuery(value);
    setSelectedName('');
    setHighlighted(-1);
    onManual(value);
    setIsOpen(value.length >= 1);
  }

  function handleSelect(o: OfficerOption) {
    setSelectedName(o.name);
    setQuery('');
    setIsOpen(false);
    setHighlighted(-1);
    onSelect(o);
  }

  function clear() {
    setQuery('');
    setSelectedName('');
    setIsOpen(false);
    setHighlighted(-1);
    onManual('');
    onSelect({ id: '', name: '', directorate_id: '', directorate_abbr: '' });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
      if (!isOpen && query.length >= 1) setIsOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && highlighted >= 0 && filtered[highlighted]) {
      e.preventDefault();
      handleSelect(filtered[highlighted]!);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setHighlighted(-1);
    }
  }

  const isLg = rowSize === 'lg';

  return (
    <div ref={containerRef} className="relative">
      {selectedName ? (
        <div className="flex items-center gap-2">
          <div className={cn(inputClassName, 'flex items-center text-sm text-foreground flex-1')}>
            {selectedName}
          </div>
          <button
            type="button"
            onClick={clear}
            aria-label="Clear selection"
            className={cn(
              'flex items-center justify-center rounded-xl shrink-0 text-muted hover:text-danger hover:bg-danger/5 transition-all',
              isLg ? 'h-12 w-12' : 'h-10 w-10',
            )}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
            onFocus={() => { if (query.length >= 1) setIsOpen(true); }}
            onKeyDown={handleKeyDown}
            className={inputClassName}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          {query.length >= 2 && filtered.length === 0 && (
            <p className="text-[11px] text-accent-warm mt-1">
              No officers found — name will be saved as typed
            </p>
          )}
        </>
      )}

      {isOpen && filtered.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-20 top-full mt-1 left-0 right-0 bg-surface rounded-xl border border-border shadow-lg max-h-56 overflow-y-auto"
        >
          {filtered.map((o, i) => (
            <li key={o.id} role="option" aria-selected={i === highlighted}>
              <button
                type="button"
                onClick={() => handleSelect(o)}
                className={cn(
                  'w-full text-left px-4 flex items-center justify-between transition-colors',
                  isLg ? 'py-3 min-h-[52px]' : 'py-2.5',
                  i === highlighted ? 'bg-primary/8' : 'hover:bg-background-warm',
                  i > 0 && 'border-t border-border/40',
                )}
              >
                <span>
                  <span className="font-medium text-foreground text-[14px]">{o.name}</span>
                  {o.title && (
                    <span className="text-muted text-[12px] font-normal"> — {o.title}</span>
                  )}
                </span>
                {o.directorate_abbr && (
                  <span className="text-[10px] font-bold bg-primary/8 text-primary px-2 py-0.5 rounded-md ml-2 shrink-0">
                    {o.directorate_abbr}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
