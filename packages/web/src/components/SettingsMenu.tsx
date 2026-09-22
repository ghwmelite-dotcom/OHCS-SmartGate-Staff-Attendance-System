import { useEffect, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import { InstallButton } from './InstallButton';
import { PushToggle } from './PushToggle';

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Settings"
        aria-expanded={open}
        className="h-11 w-11 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-colors"
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed left-3 right-3 top-[calc(4rem+env(safe-area-inset-top,0px))] sm:absolute sm:left-auto sm:right-0 sm:top-12 z-30 bg-surface text-foreground rounded-xl shadow-xl border border-border sm:w-64 p-3 space-y-2">
          <InstallButton />
          <PushToggle />
        </div>
      )}
    </div>
  );
}
