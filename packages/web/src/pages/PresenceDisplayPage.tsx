import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

const POLL_INTERVAL_MS = 20_000;
const ROTATE_SECONDS = 45;
const CLOCK_URL_BASE = 'https://staff-attendance.ohcsghana.org/clock';

interface PresenceState {
  token: string;
  /** 6-digit human-typeable rendering of the token — the shared-device path. */
  code: string;
  expiresIn: number;
  officeOpen: boolean;
  /** Date.now() when this payload landed — the countdown drains from here between polls. */
  fetchedAt: number;
}

/**
 * Fullscreen public presence display for the reception tablet (spec:
 * docs/superpowers/specs/2026-07-19-presence-qr-design.md). Shows the current
 * rotating presence QR; staff scan it from the attendance app's clock flow.
 * No auth — the token is evidence, not a credential.
 *
 * Layout: two panels on landscape tablets (brand + clock left, QR badge
 * right), stacked on portrait. The QR card is sized in vh units only, never
 * as a percentage of flex height, so it can never overflow and crowd the
 * clock or the flag bar.
 */
export function PresenceDisplayPage() {
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // ±2% burn-in jitter, re-rolled each time the token rotates
  const [jitter, setJitter] = useState({ x: 0, y: 0 });
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => { document.title = 'OHCS Presence Display'; }, []);

  // 1s ticker drives the clock line and the countdown between polls
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/presence/current');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as {
          data?: { token?: string; expires_in?: number; code?: string; office_open?: boolean } | null;
        };
        const d = json.data;
        if (!d?.token || typeof d.expires_in !== 'number') throw new Error('Malformed presence payload');
        if (cancelled) return;
        if (d.token !== lastTokenRef.current) {
          // Rotation boundary — re-roll the burn-in jitter
          lastTokenRef.current = d.token;
          setJitter({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2 });
        }
        setPresence({
          token: d.token,
          code: d.code ?? '',
          expiresIn: d.expires_in,
          officeOpen: !!d.office_open,
          fetchedAt: Date.now(),
        });
        setUnavailable(false);
      } catch {
        // Never show a stale QR — replace it with the explicit failure state
        // and keep retrying on the normal poll interval.
        if (!cancelled) setUnavailable(true);
      }
    }

    void poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const now = new Date(nowMs);
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const remaining = presence ? Math.max(0, presence.expiresIn - (nowMs - presence.fetchedAt) / 1000) : 0;

  return (
    <div className="h-screen w-screen overflow-hidden relative flex flex-col landscape:flex-row" style={{
      background: 'radial-gradient(120% 90% at 20% 0%, #235C3A 0%, #1A4D2E 35%, #0F2E1B 70%, #071A0F 100%)',
    }}>
      {/* Kente pattern */}
      <div className="absolute inset-0 opacity-[0.045]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
      }} />
      {/* Deco gold hairline frame */}
      <div className="absolute inset-3 rounded-2xl border pointer-events-none" style={{ borderColor: 'rgba(212, 160, 23, 0.18)' }} />

      {/* Brand + clock panel */}
      <div className="relative flex-none landscape:flex-1 landscape:h-full flex flex-col items-center justify-center text-center px-8 pt-8 landscape:pt-0 min-w-0">
        {/* Brand */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden" style={{
            boxShadow: '0 0 0 1px rgba(212,160,23,0.45), 0 0 30px rgba(212, 160, 23, 0.15), 0 10px 30px rgba(0,0,0,0.4)',
          }}>
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
          <div className="text-left">
            <h1 className="text-xl md:text-2xl font-bold text-white tracking-tight leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              OHCS <span style={{ color: '#D4A017' }}>Presence Display</span>
            </h1>
            <p className="text-[10px] tracking-[0.28em] uppercase font-semibold" style={{ color: 'rgba(212, 160, 23, 0.85)' }}>
              Scan with the Staff Attendance app to clock in
            </p>
          </div>
        </div>

        {/* Hairline divider with deco diamond */}
        <div className="flex items-center gap-2 mt-6 mb-6" aria-hidden="true">
          <div className="h-px w-16 md:w-24" style={{ background: 'linear-gradient(90deg, transparent, rgba(212,160,23,0.6))' }} />
          <div className="w-1.5 h-1.5 rotate-45" style={{ background: '#D4A017' }} />
          <div className="h-px w-16 md:w-24" style={{ background: 'linear-gradient(270deg, transparent, rgba(212,160,23,0.6))' }} />
        </div>

        {/* Clock */}
        <p className="font-bold text-white tracking-tight tabular-nums leading-none text-[clamp(2.75rem,7.5vw,6.5rem)]" style={{ fontFamily: "'Playfair Display', serif" }}>
          {timeStr.slice(0, 5)}<span style={{ color: 'rgba(212, 160, 23, 0.75)' }}>{timeStr.slice(5)}</span>
        </p>
        <p className="text-white/50 text-base md:text-lg mt-3 tracking-wide">{dateStr}</p>

        {/* Office status pill */}
        {presence && (
          <p className="mt-5 inline-flex items-center gap-2.5 rounded-full px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em]" style={{
            border: '1px solid rgba(255,255,255,0.14)',
            background: 'rgba(255,255,255,0.05)',
            color: 'rgba(255,255,255,0.85)',
          }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{
                background: presence.officeOpen ? '#2ECC71' : '#D4A017',
              }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{
                background: presence.officeOpen ? '#2ECC71' : '#D4A017',
                boxShadow: presence.officeOpen ? '0 0 8px rgba(46,204,113,0.9)' : '0 0 8px rgba(212,160,23,0.9)',
              }} />
            </span>
            {presence.officeOpen ? 'Office Open' : 'Office Closed'}
          </p>
        )}
      </div>

      {/* QR panel */}
      <div className="relative flex-1 min-h-0 landscape:flex-none landscape:h-full landscape:w-auto flex items-center justify-center px-6 pb-10 landscape:pb-0 landscape:px-14">
        {unavailable ? (
          <div className="flex flex-col items-center justify-center text-center rounded-[26px] px-10 py-12" style={{
            background: 'rgba(154, 27, 27, 0.22)',
            border: '1px solid rgba(252, 165, 165, 0.35)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
          }}>
            <p className="text-2xl md:text-3xl font-bold tracking-wide" style={{ color: '#FCA5A5', fontFamily: "'Playfair Display', serif" }}>
              QR UNAVAILABLE
            </p>
            <p className="text-white/60 mt-2 text-sm">Please see reception</p>
            <p className="text-white/40 mt-4 text-[10px] uppercase tracking-[0.25em]">Retrying automatically…</p>
          </div>
        ) : presence ? (
          <div className="flex flex-col items-center gap-5">
            <PresenceQr token={presence.token} remaining={remaining} jitter={jitter} />
            <PresenceCodeStrip token={presence.token} code={presence.code} />
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-[26px] bg-white/5 h-[min(56vh,460px)] portrait:h-[min(38vh,340px)] aspect-square" style={{
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <p className="text-white/40 text-[11px] uppercase tracking-[0.3em]">Connecting…</p>
          </div>
        )}
      </div>

      {/* Ghana flag bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-1.5" style={{
        background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        boxShadow: '0 -2px 14px rgba(252, 209, 22, 0.35)',
      }} />
    </div>
  );
}

function PresenceQr({ token, remaining, jitter }: {
  token: string;
  remaining: number;
  jitter: { x: number; y: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Repaint only when the token changes — the 1s countdown ticks never
  // touch the canvas.
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, `${CLOCK_URL_BASE}?presence=${token}`, {
      width: 480, margin: 2, color: { dark: '#0F2E1B', light: '#FFFFFF' },
    });
  }, [token]);

  const frac = Math.min(1, Math.max(0, remaining / ROTATE_SECONDS));
  const secs = Math.max(0, Math.ceil(remaining));

  return (
    <div className="relative" style={{
      transform: `translate(${jitter.x}%, ${jitter.y}%)`,
      transition: 'transform 0.6s ease-out',
    }}>
      {/* Ambient gold halo */}
      <div className="absolute -inset-10 rounded-full pointer-events-none" aria-hidden="true" style={{
        background: 'radial-gradient(closest-side, rgba(212, 160, 23, 0.16), transparent 72%)',
      }} />

      {/* Badge card */}
      <div className="relative bg-white rounded-[26px] p-4 md:p-5 flex flex-col h-[min(56vh,460px)] portrait:h-[min(38vh,340px)] aspect-square" style={{
        boxShadow: '0 30px 80px rgba(0,0,0,0.45), 0 0 0 1px rgba(212, 160, 23, 0.35), 0 0 60px rgba(212, 160, 23, 0.10)',
      }}>
        {/* Framed QR inset — the hairline frame separates the square code
            from the rounded card so the two never visually collide.
            Canvas is absolutely positioned so its intrinsic 480px bitmap
            can't inflate the frame past the square aspect. */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <div className="relative h-full aspect-square rounded-xl overflow-hidden" style={{
            border: '1px solid rgba(15, 46, 27, 0.10)',
          }}>
            <canvas ref={canvasRef} className="absolute inset-1.5 block" />
          </div>
        </div>
        {/* Countdown hairline + caption, inside the badge */}
        <div className="flex-none pt-3.5">
          <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(15, 46, 27, 0.10)' }}>
            <div className="h-full rounded-full" style={{
              width: `${frac * 100}%`,
              background: 'linear-gradient(90deg, #D4A017, #B8860B)',
              transition: 'width 1s linear',
            }} />
          </div>
          <p className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.25em] whitespace-nowrap" style={{ color: 'rgba(15, 46, 27, 0.55)' }}>
            Code refreshes in {secs}s
          </p>
        </div>
      </div>
    </div>
  );
}


// 6-digit presence code + shared-device clock-in handoff (spec:
// 2026-07-21-presence-code-shared-device-design). The code IS the QR token
// rendered for humans — same rotation, same validity. The button opens the
// staff app's clock page with the token deep-linked (the clock flow's
// deep-link prefill consumes it — no typing at all).
function PresenceCodeStrip({ token, code }: { token: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — the digits are right there */ }
  }

  if (!code) return null;

  return (
    <div className="flex flex-col items-center gap-3 animate-fade-in">
      <div className="rounded-2xl px-6 py-3 text-center" style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(212,160,23,0.25)',
      }}>
        <p className="text-[10px] uppercase tracking-[0.25em] font-semibold" style={{ color: 'rgba(212,160,23,0.85)' }}>
          No phone? Use this code
        </p>
        <button
          onClick={copy}
          className="mt-1 font-mono font-bold text-white tracking-[0.3em] tabular-nums leading-none text-[clamp(1.6rem,3vw,2.2rem)]"
          title="Tap to copy the code"
          aria-label={`Presence code ${code} — tap to copy`}
        >
          {code.slice(0, 3)}{' '}{code.slice(3)}
        </button>
        <p className="text-white/40 text-[10px] mt-1 h-3">{copied ? 'Copied ✓' : 'Tap the code to copy'}</p>
      </div>

      <a
        href={`${CLOCK_URL_BASE}?presence=${token}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-[15px] font-bold transition-transform active:scale-[0.98]"
        style={{
          background: 'linear-gradient(135deg, #D4A017, #B8860B)',
          color: '#0F2E1B',
          boxShadow: '0 10px 30px rgba(212,160,23,0.25)',
        }}
      >
        Clock in on this device →
      </a>
      <p className="text-white/35 text-[10px]">Shared device — please sign out after clocking.</p>
    </div>
  );
}
