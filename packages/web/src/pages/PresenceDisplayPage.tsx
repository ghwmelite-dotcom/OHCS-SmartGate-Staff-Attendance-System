import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

const POLL_INTERVAL_MS = 20_000;
const ROTATE_SECONDS = 45;
const CLOCK_URL_BASE = 'https://staff-attendance.ohcsghana.org/clock';

interface PresenceState {
  token: string;
  expiresIn: number;
  officeOpen: boolean;
  /** Date.now() when this payload landed — the ring counts down from here between polls. */
  fetchedAt: number;
}

/**
 * Fullscreen public presence display for the reception tablet (spec:
 * docs/superpowers/specs/2026-07-19-presence-qr-design.md). Shows the current
 * rotating presence QR; staff scan it from the attendance app's clock flow.
 * No auth — the token is evidence, not a credential.
 */
export function PresenceDisplayPage() {
  const [presence, setPresence] = useState<PresenceState | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // ±2% burn-in jitter, re-rolled each time the token rotates
  const [jitter, setJitter] = useState({ x: 0, y: 0 });
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => { document.title = 'OHCS Presence Display'; }, []);

  // 1s ticker drives the clock line and the countdown ring between polls
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
          data?: { token?: string; expires_in?: number; office_open?: boolean } | null;
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
    <div className="min-h-screen flex flex-col items-center justify-center overflow-hidden relative px-6 py-10" style={{
      background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
    }}>
      {/* Kente pattern */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
          repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
      }} />

      {/* Header */}
      <div className="relative flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl overflow-hidden shadow-lg" style={{
          boxShadow: '0 0 30px rgba(212, 160, 23, 0.12), 0 10px 30px rgba(0,0,0,0.4)',
        }}>
          <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
            OHCS <span style={{ color: '#D4A017' }}>Presence Display</span>
          </h1>
          <p className="text-[11px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#D4A017' }}>
            Scan with the Staff Attendance app to clock in
          </p>
        </div>
      </div>

      {/* Clock */}
      <div className="relative mt-8 text-center">
        <p className="text-6xl md:text-7xl font-bold text-white tracking-tight tabular-nums" style={{ fontFamily: "'Playfair Display', serif" }}>
          {timeStr}
        </p>
        <p className="text-white/50 text-lg mt-2">{dateStr}</p>
        {presence && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-white/80">
            <span className="relative flex h-2.5 w-2.5">
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{
                background: presence.officeOpen ? '#1A7A3A' : '#D4A017',
                boxShadow: presence.officeOpen ? '0 0 8px rgba(26,122,58,0.9)' : '0 0 8px rgba(212,160,23,0.9)',
              }} />
            </span>
            {presence.officeOpen ? 'Office open' : 'Office closed'}
          </p>
        )}
      </div>

      {/* QR / failure state */}
      <div className="relative mt-8 flex items-center justify-center">
        {unavailable ? (
          <div className="flex flex-col items-center justify-center text-center rounded-3xl px-12 py-14" style={{
            background: 'rgba(154, 27, 27, 0.22)',
            border: '1px solid rgba(252, 165, 165, 0.35)',
          }}>
            <p className="text-2xl md:text-3xl font-bold tracking-wide" style={{ color: '#FCA5A5', fontFamily: "'Playfair Display', serif" }}>
              QR UNAVAILABLE — see reception
            </p>
            <p className="text-white/40 mt-4 text-[11px] uppercase tracking-[0.25em]">Retrying automatically…</p>
          </div>
        ) : presence ? (
          <PresenceQr token={presence.token} remaining={remaining} jitter={jitter} />
        ) : (
          <div className="flex items-center justify-center rounded-full bg-white/5" style={{ width: 'min(560px, 80vmin)', aspectRatio: '1' }}>
            <p className="text-white/40 text-sm uppercase tracking-[0.25em]">Connecting…</p>
          </div>
        )}
      </div>

      {/* Ghana flag bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-1" style={{
        background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
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

  // Repaint only when the token changes — the 1s ring/clock ticks never
  // touch the canvas.
  useEffect(() => {
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, `${CLOCK_URL_BASE}?presence=${token}`, {
      width: 480, margin: 2, color: { dark: '#0F2E1B', light: '#FFFFFF' },
    });
  }, [token]);

  // Countdown ring hugging the QR disc, draining to the next rotation
  const R = 270;
  const C = 2 * Math.PI * R;
  const frac = Math.min(1, Math.max(0, remaining / ROTATE_SECONDS));

  return (
    <div className="relative" style={{
      width: 'min(560px, 80vmin)',
      aspectRatio: '1',
      transform: `translate(${jitter.x}%, ${jitter.y}%)`,
      transition: 'transform 0.6s ease-out',
    }}>
      <svg viewBox="0 0 560 560" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <circle cx="280" cy="280" r={R} fill="none" stroke="rgba(212, 160, 23, 0.15)" strokeWidth="10" />
        <circle
          cx="280" cy="280" r={R} fill="none"
          stroke="#D4A017" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={C}
          transform="rotate(-90 280 280)"
          style={{ strokeDashoffset: C * (1 - frac), transition: 'stroke-dashoffset 1s linear' }}
        />
      </svg>
      <div className="absolute rounded-full bg-white flex items-center justify-center shadow-2xl" style={{
        inset: '4%',
        boxShadow: '0 0 60px rgba(212, 160, 23, 0.12), 0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <canvas ref={canvasRef} className="w-[88%] h-auto" />
      </div>
    </div>
  );
}
