import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { stepsForRole } from '@/lib/welcome-wizard';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * VMS welcome wizard (spec: docs/superpowers/specs/2026-07-19-vms-welcome-wizard-design.md).
 * Openable and closable at any time — ×, ESC, backdrop click and "Skip tour" are
 * all equivalent and route through onClose (the caller marks the tour seen).
 * Steps are filtered by the signed-in user's role. Hand-rolled dialog chrome,
 * matching the repo's other modals; no headless UI dependency.
 */
export function WelcomeWizard({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const steps = useMemo(() => stepsForRole(user?.role), [user?.role]);
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useRef(
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  ).current;

  // Restart from the first step on every open and move focus into the dialog
  useEffect(() => {
    if (open) {
      setIndex(0);
      dialogRef.current?.focus();
    }
  }, [open]);

  // Keyboard: ESC close, ←/→ navigate, Tab trapped inside the dialog
  useEffect(() => {
    if (!open) return;

    function trapTab(e: KeyboardEvent) {
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, steps.length - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Tab') {
        trapTab(e);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, steps.length]);

  if (!open || steps.length === 0) return null;

  const clamped = Math.min(index, steps.length - 1);
  const step = steps[clamped];
  if (!step) return null;
  const isFirst = clamped === 0;
  const isLast = clamped === steps.length - 1;
  const StepIcon = step.icon;
  const stepMotion = reducedMotion
    ? undefined
    : { animation: 'wizard-step-in 200ms ease-out both' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7, 26, 15, 0.7)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Welcome tour — step ${clamped + 1} of ${steps.length}: ${step.title}`}
        tabIndex={-1}
        className="relative w-full max-w-lg rounded-3xl overflow-hidden outline-none"
        style={{
          background: 'linear-gradient(160deg, #1A4D2E 0%, #0F2E1B 100%)',
          border: '1px solid rgba(212, 160, 23, 0.35)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.5), 0 0 60px rgba(212, 160, 23, 0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Kente diagonal texture */}
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none" aria-hidden="true" style={{
          backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
            repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
        }} />

        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close tour"
          className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: 'rgba(255, 255, 255, 0.55)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255, 255, 255, 0.55)'; }}
        >
          <X className="h-[18px] w-[18px]" />
        </button>

        {/* Step content — keyed so each step re-runs the entrance transition */}
        <div className="relative px-8 pt-10 pb-6 md:px-10 min-h-[240px]">
          <div key={step.id} style={stepMotion}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{
              background: 'rgba(212, 160, 23, 0.12)',
              boxShadow: '0 0 0 1px rgba(212, 160, 23, 0.45), 0 0 24px rgba(212, 160, 23, 0.12)',
            }}>
              <StepIcon className="h-6 w-6" style={{ color: '#E8C44A' }} />
            </div>
            <h2 className="mt-5 text-2xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
              {step.title}
            </h2>
            <p className="mt-2.5 text-[15px] leading-relaxed" style={{ color: 'rgba(255, 255, 255, 0.72)' }}>
              {step.body}
            </p>
            {step.bullets && (
              <ul className="mt-4 space-y-2">
                {step.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-[13.5px] leading-snug" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>
                    <span className="mt-[6px] w-1.5 h-1.5 rotate-45 flex-none" style={{ background: '#D4A017' }} aria-hidden="true" />
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Footer: skip · dots · back/next */}
        <div className="relative flex items-center gap-3 px-8 md:px-10 pb-7 pt-2">
          <button
            onClick={onClose}
            className="text-[13px] font-medium transition-colors hover:text-white"
            style={{ color: 'rgba(255, 255, 255, 0.45)' }}
          >
            Skip tour
          </button>

          <div className="flex-1 flex items-center justify-center gap-1.5">
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setIndex(i)}
                aria-label={`Go to step ${i + 1}: ${s.title}`}
                aria-current={i === clamped ? 'step' : undefined}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === clamped ? 20 : 6,
                  background: i === clamped ? '#D4A017' : 'rgba(212, 160, 23, 0.3)',
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                className="h-10 px-4 rounded-xl text-[14px] font-medium transition-colors hover:text-white"
                style={{ border: '1px solid rgba(255, 255, 255, 0.18)', color: 'rgba(255, 255, 255, 0.75)' }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => (isLast ? onClose() : setIndex((i) => Math.min(i + 1, steps.length - 1)))}
              className="h-10 px-5 rounded-xl text-[14px] font-semibold transition-transform hover:scale-[1.02]"
              style={{
                background: 'linear-gradient(135deg, #D4A017, #F5D76E)',
                color: '#0F2E1B',
                boxShadow: '0 4px 16px rgba(212, 160, 23, 0.3)',
              }}
            >
              {isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>

        {/* Ghana-flag hairline at the bottom edge — inset 1px and rounded to
            sit just inside the card's gold border, following its corners */}
        <div className="relative h-[3px] mx-px mb-px rounded-b-[calc(1.5rem-1px)]" aria-hidden="true" style={{
          background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        }} />

        {!reducedMotion && (
          <style>{`
            @keyframes wizard-step-in {
              from { opacity: 0; transform: translateY(8px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        )}
      </div>
    </div>
  );
}
