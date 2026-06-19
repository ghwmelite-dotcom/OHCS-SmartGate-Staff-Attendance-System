import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startAuthentication } from '@simplewebauthn/browser';
import { FirstLoginPinPrompt } from '@/components/FirstLoginPinPrompt';
import { BottomNav } from '@/components/BottomNav';
import { AbsenceNoticeButton } from '@/components/AbsenceNoticeButton';
import { LetterReveal } from '@/components/LetterReveal';
import { MagneticButton } from '@/components/MagneticButton';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { ReauthModal } from '@/components/ReauthModal';
import { WebAuthnNudgeBanner } from '@/components/WebAuthnNudgeBanner';
import { LivenessCapture } from '@/lib/liveness/LivenessCapture';
import type { FrameBurst } from '@/lib/liveness/types';
import { api, fetchClockPrompt, submitClock as apiSubmitClock, type ClockPrompt } from '@/lib/api';
import { getToken } from '@/lib/tokenStore';
import { apiOrQueue, type ApiOrQueueResult } from '@/lib/offlineQueue';
import { cn, formatTime } from '@/lib/utils';
import { withinGeofence, distanceToPolygonMeters, MAX_GPS_ACCURACY_METERS } from '@/lib/geofence';
import { useAuthStore } from '@/stores/auth';
import {
  LogIn, LogOut, MapPin, Flame, Trophy,
  Clock, CheckCircle2, Loader2,
} from 'lucide-react';

// Encode a UTF-8 string to base64url for WebAuthn challenge.
// We use the prompt_id UUID directly as the challenge so the assertion is
// cryptographically bound to the same prompt being shown in the photo.
function utf8ToBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

interface ClockStatus {
  clocked_in: boolean;
  clocked_out: boolean;
  clock_in_time: string | null;
  clock_out_time: string | null;
  streak: number;
  longest_streak: number;
}

interface ClockResult {
  id: string;
  type: string;
  timestamp: string;
  user_name: string;
  staff_id: string;
  within_geofence: boolean;
  distance_meters: number;
  streak: number;
  longest_streak: number;
}

type Phase = 'idle' | 'locating' | 'photo' | 'reauth' | 'submitting' | 'success' | 'error';

export function ClockPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const showFirstLoginPrompt = user ? !user.pin_acknowledged : false;

  const [phase, setPhase] = useState<Phase>('idle');
  const [submittingForLong, setSubmittingForLong] = useState(false);
  const [clockType, setClockType] = useState<'clock_in' | 'clock_out'>('clock_in');
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [prompt, setPrompt] = useState<ClockPrompt | null>(null);
  const [reauthModalOpen, setReauthModalOpen] = useState(false);
  const [showNudge, setShowNudge] = useState(false);
  const [result, setResult] = useState<ClockResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [frameBurst, setFrameBurst] = useState<FrameBurst | null>(null);
  const [claimedCompleted, setClaimedCompleted] = useState(false);
  const [requestedManualReview, setRequestedManualReview] = useState(false);
  // Refs mirror liveness state so tryReauthAndSubmit can read them synchronously
  const frameBurstRef = useRef<FrameBurst | null>(null);
  const claimedCompletedRef = useRef(false);
  const requestedManualReviewRef = useRef(false);

  const { data: statusData } = useQuery({
    queryKey: ['clock-status'],
    queryFn: () => api.get<ClockStatus>('/clock/my-status'),
    refetchInterval: 30_000,
  });

  const status = statusData?.data;
  const canClockIn = !status?.clocked_in;
  const canClockOut = status?.clocked_in && !status?.clocked_out;

  const clockMutation = useMutation({
    mutationFn: async (data: {
      type: 'clock_in' | 'clock_out'; latitude: number; longitude: number; accuracy: number; photo: Blob | null;
      promptId?: string; webauthnAssertion?: unknown; pin?: string;
      livenessBurst?: { frame0: Blob; frame1: Blob; frame2: Blob; claimedCompleted: boolean };
    }) => {
      const { photo, promptId, webauthnAssertion, pin, livenessBurst, ...rest } = data;

      // When frames are present we go straight to the multipart endpoint —
      // FormData can't be serialised into the offline queue.
      if (livenessBurst) {
        const clockResult = await apiSubmitClock({
          type: rest.type,
          latitude: rest.latitude,
          longitude: rest.longitude,
          accuracy: rest.accuracy,
          promptId,
          webauthnAssertion,
          pin,
          livenessBurst,
        });
        return { ok: true as const, data: clockResult as ClockResult };
      }

      // No burst — use the offline-capable JSON path.
      const clockData = {
        ...rest,
        prompt_id: promptId,
        webauthn_assertion: webauthnAssertion,
        pin,
      };
      const res = await apiOrQueue<ClockResult>('clock-queue', '/clock', clockData);
      if (!('queued' in res) && res.data && photo) {
        const token = getToken();
        try {
          // Relative same-origin URL; the Worker routes /api/* first-party.
          const uploadRes = await fetch(`/api/clock/${res.data.id}/photo`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'image/jpeg',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: await photo.arrayBuffer(),
          });
          if (!uploadRes.ok) console.error('[clock] photo upload failed:', uploadRes.status, await uploadRes.text().catch(() => ''));
        } catch (e) {
          console.error('[clock] photo upload error:', e);
        }
      }
      return res;
    },
    onSuccess: async (res: ApiOrQueueResult<ClockResult>) => {
      const ts = 'queued' in res ? new Date().toISOString() : res.data.timestamp;
      // Optimistically update the Today card immediately so it reflects the
      // new clock-in/out state without waiting for the refetch to land. The
      // shape mirrors what /clock/my-status returns through `api.get`.
      queryClient.setQueryData<{ data: ClockStatus | null; error: unknown } | undefined>(
        ['clock-status'],
        (old) => {
          const prev: ClockStatus = old?.data ?? {
            clocked_in: false,
            clocked_out: false,
            clock_in_time: null,
            clock_out_time: null,
            streak: status?.streak ?? 0,
            longest_streak: status?.longest_streak ?? 0,
          };
          const next: ClockStatus = clockType === 'clock_in'
            ? {
                ...prev,
                clocked_in: true,
                clock_in_time: ts,
                streak: 'queued' in res ? prev.streak : res.data.streak,
                longest_streak: 'queued' in res ? prev.longest_streak : res.data.longest_streak,
              }
            : { ...prev, clocked_out: true, clock_out_time: ts };
          return { data: next, error: null };
        },
      );
      if ('queued' in res) {
        setResult({
          id: res.id,
          type: clockType,
          timestamp: ts,
          user_name: user?.name ?? '',
          staff_id: '',
          within_geofence: true,
          distance_meters: 0,
          streak: status?.streak ?? 0,
          longest_streak: status?.longest_streak ?? 0,
        } as ClockResult);
        setPhase('success');
        return;
      }
      setResult(res.data);
      setPhase('success');
      // Confirm against the server in the background — the optimistic write
      // above already makes the UI feel instant.
      queryClient.invalidateQueries({ queryKey: ['clock-status'] });
    },
    onError: (err, variables) => {
      const code = (err as { code?: string }).code;
      const msg = err instanceof Error ? err.message : String(err);
      // Always log the full error so it's visible in Safari Web Inspector
      // when reproducing on a connected device.
      console.error('[clock] mutation error', { msg, code, stack: err instanceof Error ? err.stack : null, variables });

      if (code === 'REAUTH_REQUIRED' || code === 'REAUTH_FAILED') {
        setPhase('reauth');
        setReauthModalOpen(true);
        return;
      }
      // iOS Safari occasionally throws "The string did not match the
      // expected pattern" from inside its multipart upload pipeline when
      // FormData carries Blobs. The server in shadow mode accepts a
      // burst-less submission, so retry once without the burst before
      // giving up. Guard with a flag so we don't loop.
      if (
        /did not match the expected pattern/i.test(msg)
        && (variables.livenessBurst || variables.webauthnAssertion)
      ) {
        console.warn('[clock] iOS Safari pattern error — retrying without burst/assertion');
        clockMutation.mutate({
          ...variables,
          livenessBurst: undefined,
          webauthnAssertion: undefined,
        });
        return;
      }
      setErrorMsg(msg || 'Failed to clock');
      setPhase('error');
    },
  });

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === 'queue-drained') {
        queryClient.invalidateQueries({ queryKey: ['clock-status'] });
      }
    }
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, [queryClient]);

  // Surface a "first-time call may take a moment" hint after 3s in the
  // submitting phase. The backing Workers AI call has cold-start latency that
  // is invisible to staff otherwise.
  useEffect(() => {
    if (phase !== 'submitting') {
      setSubmittingForLong(false);
      return;
    }
    const t = setTimeout(() => setSubmittingForLong(true), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  // If we land in the photo phase with no prompt (offline / fetch failed),
  // skip liveness and proceed directly to re-auth.
  useEffect(() => {
    if (phase === 'photo' && !prompt) {
      tryReauthAndSubmit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, prompt]);

  // Get GPS location
  function startClock(type: 'clock_in' | 'clock_out') {
    setClockType(type);
    setPhase('locating');
    setErrorMsg('');
    setPhotoBlob(null);
    setPrompt(null);
    setResult(null);
    setShowNudge(false);
    setFrameBurst(null);
    setClaimedCompleted(false);
    setRequestedManualReview(false);
    frameBurstRef.current = null;
    claimedCompletedRef.current = false;
    requestedManualReviewRef.current = false;
    // Warm MediaPipe WASM in parallel with geolocation
    void import('../lib/liveness/mediapipeRunner');

    // Watch for the first fix that is good enough to trust (≤15m), or settle
    // for the best reading we've seen after 20s. Tight target because the
    // server uses strict point-in-polygon membership — GPS error directly
    // determines whether someone outside the building can be reported as
    // inside it.
    const ACCEPT_ACCURACY_M = 15;
    const SETTLE_MS = 20_000;
    let best: { lat: number; lng: number; accuracy: number } | null = null;
    let watchId: number | null = null;
    let settled = false;

    const finish = async (pos: { lat: number; lng: number; accuracy: number }) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);

      // Pre-flight geofence check — fail before opening the camera so the user
      // gets immediate feedback instead of taking a photo and being rejected
      // by the server. Server still re-validates on submit.
      if (pos.accuracy > MAX_GPS_ACCURACY_METERS) {
        setErrorMsg(`GPS accuracy is too poor (±${Math.round(pos.accuracy)}m). Move outside or to a window and try again.`);
        setPhase('error');
        return;
      }
      if (!withinGeofence(pos.lat, pos.lng, pos.accuracy)) {
        const distance = Math.round(distanceToPolygonMeters(pos.lat, pos.lng));
        const accStr = pos.accuracy > 0 ? ` (GPS accuracy ±${Math.round(pos.accuracy)}m)` : '';
        setErrorMsg(`You are ${distance}m outside the OHCS building${accStr}. You must be at the building to clock ${type === 'clock_in' ? 'in' : 'out'}.`);
        setPhase('error');
        return;
      }

      setLocation(pos);

      // Fetch a fresh single-use prompt before the camera opens so it can be
      // shown to the staff member during capture. If fetch fails (offline or
      // server hiccup), proceed without it — soft-rollout server accepts
      // no-prompt requests; enforce mode will reject with a clear message.
      try {
        const fresh = await fetchClockPrompt();
        setPrompt(fresh);
      } catch (e) {
        console.warn('[clock] prompt fetch failed, proceeding without:', e);
      }

      setPhase('photo');
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        if (!best || fix.accuracy < best.accuracy) best = fix;
        if (fix.accuracy <= ACCEPT_ACCURACY_M) finish(fix);
      },
      (err) => {
        if (settled) return;
        settled = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        setErrorMsg(err.code === 1 ? 'Location access denied. Please enable GPS.' : 'Could not get your location. Please try again.');
        setPhase('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    setTimeout(() => {
      if (settled) return;
      if (best) finish(best);
      else {
        settled = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        setErrorMsg('Could not get a confident GPS fix. Move outside or to a window and try again.');
        setPhase('error');
      }
    }, SETTLE_MS);
  }

  // Attempt WebAuthn re-auth; on ANY failure (including iOS Safari quirks
  // around empty allowCredentials and "string did not match the expected
  // pattern" SyntaxErrors) submit directly without an assertion. The server
  // gates per its enforce mode: in shadow mode the submission succeeds, in
  // enforce mode it returns REAUTH_REQUIRED which clockMutation.onError
  // catches and opens the PIN modal. This keeps the happy path for staff
  // with no registered passkey from ever surfacing a raw biometric error.
  async function tryReauthAndSubmit() {
    if (!location) return;
    setPhase('reauth');

    if (prompt) {
      try {
        const assertion = await startAuthentication({
          optionsJSON: {
            challenge: utf8ToBase64Url(prompt.promptId),
            rpId: window.location.hostname,
            userVerification: 'required',
            allowCredentials: [],
            timeout: 60000,
          },
        });
        submitClock({ promptId: prompt.promptId, webauthnAssertion: assertion });
        return;
      } catch (e) {
        console.warn('[clock] webauthn failed/cancelled, submitting without:', e);
        // Fall through to direct submit.
      }
    }

    submitClock(prompt ? { promptId: prompt.promptId } : undefined);
  }

  function submitClock(
    opts?: { promptId?: string; webauthnAssertion?: unknown; pin?: string },
  ) {
    if (!location) return;
    setPhase('submitting');
    const burst = frameBurstRef.current;
    const manualReview = requestedManualReviewRef.current;
    clockMutation.mutate({
      type: clockType,
      latitude: location.lat,
      longitude: location.lng,
      accuracy: location.accuracy,
      photo: photoBlob,
      promptId: opts?.promptId ?? prompt?.promptId,
      webauthnAssertion: opts?.webauthnAssertion,
      pin: opts?.pin,
      ...(burst && !manualReview ? {
        livenessBurst: {
          frame0: burst.frame0,
          frame1: burst.frame1,
          frame2: burst.frame2,
          claimedCompleted: claimedCompletedRef.current,
        },
      } : {}),
    });
  }

  // Called by ReauthModal when the user submits a PIN. We bypass clockMutation
  // here so we can return a precise pass/fail to the modal (wrong-PIN should
  // shake and stay open; rate-limit should show a specific message; success
  // closes and proceeds through the same submit pipeline as the WebAuthn path).
  async function handlePinSubmit(pin: string): Promise<{ ok: boolean; rateLimited?: boolean; message?: string }> {
    if (!prompt || !location) return { ok: false, message: 'No active prompt' };
    try {
      // Use clockMutation.mutateAsync so the cache invalidation pipeline still
      // runs on success. On error we inspect the code and tell the modal
      // whether to shake or hard-fail.
      const burst = frameBurstRef.current;
      const manualReview = requestedManualReviewRef.current;
      await clockMutation.mutateAsync({
        type: clockType,
        latitude: location.lat,
        longitude: location.lng,
        accuracy: location.accuracy,
        photo: photoBlob,
        promptId: prompt.promptId,
        pin,
        ...(burst && !manualReview ? {
          livenessBurst: {
            frame0: burst.frame0,
            frame1: burst.frame1,
            frame2: burst.frame2,
            claimedCompleted: claimedCompletedRef.current,
          },
        } : {}),
      });
      setReauthModalOpen(false);
      setShowNudge(true);   // PIN fallback used → nudge biometric setup
      return { ok: true };
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === 'REAUTH_RATE_LIMITED') {
        setReauthModalOpen(false);
        setErrorMsg('Too many wrong PIN attempts. Try again tomorrow.');
        setPhase('error');
        return { ok: false, rateLimited: true, message: err.message };
      }
      if (err.code === 'REAUTH_FAILED') {
        // Wrong PIN — keep modal open, shake, let user retry.
        setPhase('reauth');
        return { ok: false, message: 'Wrong PIN' };
      }
      // Any other error — bail out to error phase.
      setReauthModalOpen(false);
      setErrorMsg(err.message ?? 'Failed to clock');
      setPhase('error');
      return { ok: false, message: err.message };
    }
  }

  function resetState() {
    setPhase('idle');
    setErrorMsg('');
    setPhotoBlob(null);
    setResult(null);
    setFrameBurst(null);
    setClaimedCompleted(false);
    setRequestedManualReview(false);
    frameBurstRef.current = null;
    claimedCompletedRef.current = false;
    requestedManualReviewRef.current = false;
  }

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const greetingEmoji = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙';

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {showFirstLoginPrompt && <FirstLoginPinPrompt />}
      {/* Header */}
      <div className="relative kente-weave shimmer-sweep" style={{ background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)', ['--kente-opacity' as unknown as string]: '0.05' }}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)' }} />
        <div
          className="flex items-center gap-4 px-5 pb-4"
          style={{ paddingTop: 'max(1rem, calc(env(safe-area-inset-top, 0px) + 0.25rem))' }}
        >
          <div className="logo-ring w-[52px] h-[52px] flex-shrink-0 relative">
            <div className="w-full h-full rounded-full overflow-hidden ring-1 ring-[#D4A017]/30">
              <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
            </div>
            <div
              className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center shadow-sm"
              style={{ background: '#1A7A3A', boxShadow: '0 0 0 2px #0F2E1B' }}
              aria-hidden="true"
            >
              <Clock className="h-[10px] w-[10px] text-white" strokeWidth={2.5} />
            </div>
          </div>
          <div>
            <h1 className="text-[16px] font-bold text-white leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>Staff Attendance</h1>
            <p className="text-[10px] text-[#D4A017]/80 tracking-[0.25em] uppercase mt-0.5">OHCS ClockIn System</p>
          </div>
        </div>
      </div>

      <div
        className="relative flex-1 flex flex-col items-center px-5 py-6 kente-weave"
        style={{
          ['--kente-opacity' as unknown as string]: '0.025',
          paddingBottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 1.5rem)',
        }}
      >
        {/* Greeting */}
        <p className="text-[11px] text-accent-warm tracking-[0.2em] uppercase font-semibold">
          <span aria-hidden="true" className="mr-1.5 not-italic tracking-normal">{greetingEmoji}</span>
          {greeting}
        </p>
        <h2 className="text-[28px] font-bold text-foreground mt-1 leading-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
          <LetterReveal text={user?.name ?? ''} />
        </h2>
        <span className="underline-flourish w-16 mt-1.5" />

        {/* Streak */}
        {status && status.streak > 0 && (
          <div className="flex items-center gap-2 mt-4 px-4 py-1.5 bg-accent/10 border border-accent/20 rounded-full">
            <span className="flex items-center gap-0.5">
              {Array.from({ length: Math.min(5, status.streak) }).map((_, i) => (
                <Flame key={i} className="h-3.5 w-3.5 text-accent-warm ember" style={{ ['--i' as unknown as string]: i }} />
              ))}
            </span>
            <span className="text-[13px] font-semibold text-accent-warm">{status.streak} day streak</span>
            {status.longest_streak > status.streak && (
              <span className="text-[11px] text-muted ml-1">
                <Trophy className="h-3 w-3 inline" /> Best: {status.longest_streak}
              </span>
            )}
          </div>
        )}

        {/* Today's status */}
        <div className="gold-frame w-full max-w-sm mt-6 bg-surface rounded-2xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <Clock className="h-4 w-4 text-muted" />
              <span className="text-[13px] font-medium text-muted">Today</span>
            </div>
            <span className="text-[12px] text-muted-foreground">
              {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
          <div className="flex gap-4 mt-3">
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">In</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_in ? 'text-success' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
                {status?.clock_in_time ? formatTime(status.clock_in_time) : '--:--'}
              </p>
            </div>
            <div className="w-[1px] bg-gradient-to-b from-transparent via-border to-transparent" />
            <div className="flex-1 text-center">
              <p className="text-[10px] text-muted uppercase tracking-[0.2em]">Out</p>
              <p className={cn(
                'text-[18px] font-bold mt-1 transition-all duration-500',
                status?.clocked_out ? 'text-foreground' : 'text-muted-foreground',
              )} style={{ fontFamily: "'Playfair Display', serif" }}>
                {status?.clock_out_time ? formatTime(status.clock_out_time) : '--:--'}
              </p>
            </div>
          </div>
        </div>

        {/* Main action area */}
        <div className="flex-1 flex flex-col items-center justify-center w-full max-w-sm mt-6">

          {/* IDLE — show big buttons */}
          {phase === 'idle' && (
            <div className="space-y-4 w-full">
              {canClockIn && (
                <MagneticButton
                  onClick={() => startClock('clock_in')}
                  className="group w-full h-20 bg-primary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(26,77,46,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogIn className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock In
                </MagneticButton>
              )}
              {canClockOut && (
                <MagneticButton
                  onClick={() => startClock('clock_out')}
                  className="group w-full h-20 bg-secondary text-white rounded-3xl flex items-center justify-center gap-3 text-[18px] font-bold shadow-[0_14px_30px_rgba(139,26,26,0.3)] ring-1 ring-[#D4A017]/30 hover:ring-[#D4A017]/60 hover:shadow-[0_18px_40px_rgba(212,160,23,0.25)] transition-[box-shadow,ring] duration-300"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  <LogOut className="h-7 w-7 transition-transform duration-300 group-hover:rotate-[15deg]" />
                  Clock Out
                </MagneticButton>
              )}
              {!canClockIn && !canClockOut && (
                <div className="text-center py-8">
                  <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
                  <p className="text-[18px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    🎉 You're done for today
                  </p>
                  <p className="text-[14px] text-muted mt-1">See you tomorrow 👋</p>
                </div>
              )}
            </div>
          )}

          {/* LOCATING */}
          {phase === 'locating' && (
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
                <MapPin className="h-7 w-7 text-primary" />
              </div>
              <p className="text-[16px] font-semibold text-foreground">📍 Locating you…</p>
              <p className="text-[13px] text-muted mt-1">🛰️ Please allow location access</p>
            </div>
          )}

          {/* PHOTO CAPTURE — liveness challenge */}
          {phase === 'photo' && prompt && (
            <div className="w-full aspect-square rounded-3xl overflow-hidden">
              <LivenessCapture
                challenge={prompt.challengeAction}
                onComplete={(burst, completed) => {
                  frameBurstRef.current = burst;
                  claimedCompletedRef.current = completed;
                  setFrameBurst(burst);
                  setClaimedCompleted(completed);
                  tryReauthAndSubmit();
                }}
                onCameraError={(err) => {
                  console.warn('[clock] Camera unavailable for liveness:', err);
                  tryReauthAndSubmit();
                }}
                onRequestManualReview={() => {
                  requestedManualReviewRef.current = true;
                  setRequestedManualReview(true);
                  tryReauthAndSubmit();
                }}
              />
            </div>
          )}

          {/* RE-AUTH (between photo and submit) */}
          {phase === 'reauth' && !reauthModalOpen && (
            <div className="text-center">
              <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
              <p className="text-[16px] font-semibold text-foreground">🔐 Verifying biometric…</p>
              <p className="text-[12px] text-muted mt-1">Authorize on your device</p>
            </div>
          )}

          {/* SUBMITTING */}
          {phase === 'submitting' && (
            <div className="text-center">
              <Loader2 className="h-10 w-10 text-primary mx-auto mb-4 animate-spin" />
              <p className="text-[16px] font-semibold text-foreground">
                ⏳ Clocking {clockType === 'clock_in' ? 'in' : 'out'}…
              </p>
              <p className="text-[12px] text-muted mt-1">Securing your record 🔐</p>
              {submittingForLong && (
                <p className="text-[11px] text-muted mt-2 max-w-[260px] mx-auto">
                  First check of the day can take a few seconds — hold tight.
                </p>
              )}
            </div>
          )}

          {/* SUCCESS */}
          {phase === 'success' && result && (
            <div className="relative text-center space-y-4 w-full animate-fade-in-up">
              <ConfettiBurst />
              <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div>
                <p className="text-[20px] font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                  {result.type === 'clock_in' ? '🎉 Clocked In!' : '🏁 Clocked Out!'}
                </p>
                <p className="text-[16px] text-foreground font-medium mt-1">
                  {result.user_name} &middot; {formatTime(result.timestamp)}
                </p>
                {result.staff_id && (
                  <p className="text-[13px] text-muted mt-0.5">🪪 Staff ID: {result.staff_id}</p>
                )}
              </div>
              {result.streak > 1 && (
                <div className="flex items-center justify-center gap-2 px-4 py-2 bg-accent/10 rounded-full">
                  <Flame className="h-4 w-4 text-accent-warm" />
                  <span className="text-[14px] font-bold text-accent-warm">🔥 {result.streak} day streak!</span>
                </div>
              )}
              <button onClick={resetState}
                className="h-10 px-6 text-[14px] font-medium text-primary border border-primary/20 rounded-xl hover:bg-primary/5 transition-all">
                ✅ Done
              </button>
            </div>
          )}

          {/* ERROR */}
          {phase === 'error' && (
            <div className="text-center space-y-4 w-full">
              <div className="w-16 h-16 bg-danger/10 rounded-full flex items-center justify-center mx-auto">
                <MapPin className="h-8 w-8 text-danger" />
              </div>
              <p className="text-[16px] font-bold text-danger" style={{ fontFamily: "'Playfair Display', serif" }}>
                ⚠️ {errorMsg}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center items-center">
                <button onClick={resetState}
                  className="h-10 px-6 text-[14px] font-medium text-foreground border border-border rounded-xl hover:bg-background transition-all">
                  🔄 Try Again
                </button>
                <button
                  onClick={async () => {
                    try {
                      const cs = await caches.keys();
                      await Promise.all(cs.map((n) => caches.delete(n)));
                      const regs = await navigator.serviceWorker?.getRegistrations?.() ?? [];
                      await Promise.all(regs.map((r) => r.unregister()));
                    } finally {
                      window.location.reload();
                    }
                  }}
                  className="h-10 px-6 text-[14px] font-medium text-muted hover:text-foreground transition-all"
                >
                  Reset app & reload
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-full flex justify-center mt-8">
          <AbsenceNoticeButton />
        </div>

        {/* Footer motto */}
        <div className="relative flex items-center gap-3 mt-6 shimmer-sweep py-2 px-3 rounded-full" style={{ color: '#D4A017' }}>
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-1">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-2" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-3">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-50 animate-fade-in stagger-4" />
          <span className="text-[9px] tracking-[0.25em] uppercase font-semibold opacity-70 animate-fade-in stagger-5">Service</span>
        </div>
      </div>
      <BottomNav />

      <ReauthModal
        isOpen={reauthModalOpen}
        onClose={() => { setReauthModalOpen(false); resetState(); }}
        onSubmit={handlePinSubmit}
        fallback
      />

      <WebAuthnNudgeBanner
        shouldShow={showNudge && phase === 'success'}
        onEnroll={() => { setShowNudge(false); /* Settings menu has BiometricToggle */ }}
      />
    </div>
  );
}
