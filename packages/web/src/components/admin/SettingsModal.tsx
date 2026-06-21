import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { XCircle, Clock, AlertTriangle, CheckCircle2, Loader2, CalendarDays, Plus, Trash2, Database, ShieldCheck, ShieldAlert } from 'lucide-react';

export interface AppSettings {
  work_start_time: string;
  late_threshold_time: string;
  work_end_time: string;
  // The cleartext PIN is never sent to the client — only whether one is set.
  reception_override_pin_set?: boolean;
  clockin_reauth_enforce?: number;
  clockin_passive_liveness_enforce?: number;
  updated_by: string | null;
  updated_at: string;
}

interface Props {
  current: AppSettings;
  canEdit: boolean;
  onClose: () => void;
}

export function SettingsModal({ current, canEdit, onClose }: Props) {
  const qc = useQueryClient();
  const [start, setStart] = useState(current.work_start_time);
  const [late, setLate] = useState(current.late_threshold_time);
  const [end, setEnd] = useState(current.work_end_time);
  const pinIsSet = current.reception_override_pin_set ?? false;
  const [overridePin, setOverridePin] = useState('');
  const [removeOverridePin, setRemoveOverridePin] = useState(false);
  const [enforceReauth, setEnforceReauth] = useState((current.clockin_reauth_enforce ?? 0) === 1);
  const [enforceLiveness, setEnforceLiveness] = useState((current.clockin_passive_liveness_enforce ?? 0) === 1);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    setStart(current.work_start_time);
    setLate(current.late_threshold_time);
    setEnd(current.work_end_time);
    setOverridePin('');
    setRemoveOverridePin(false);
    setEnforceReauth((current.clockin_reauth_enforce ?? 0) === 1);
    setEnforceLiveness((current.clockin_passive_liveness_enforce ?? 0) === 1);
  }, [current]);

  const mutation = useMutation({
    mutationFn: (body: { work_start_time: string; late_threshold_time: string; work_end_time: string; reception_override_pin?: string; clockin_reauth_enforce: number; clockin_passive_liveness_enforce: number }) =>
      api.put<AppSettings>('/admin/settings', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-settings'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    },
  });

  function handleSave() {
    setLocalErr(null);
    if (!(start < late && late < end)) {
      setLocalErr('Times must satisfy: start < late < end');
      return;
    }
    const pin = overridePin.trim();
    if (pin && !/^\d{4,8}$/.test(pin)) {
      setLocalErr('Override PIN must be 4–8 digits');
      return;
    }
    // Write-only: '' to clear (remove toggle), digits to set, otherwise omit (keep).
    let overrideField: { reception_override_pin?: string } = {};
    if (removeOverridePin) overrideField = { reception_override_pin: '' };
    else if (pin) overrideField = { reception_override_pin: pin };
    mutation.mutate({
      work_start_time: start, late_threshold_time: late, work_end_time: end,
      ...overrideField,
      clockin_reauth_enforce: enforceReauth ? 1 : 0,
      clockin_passive_liveness_enforce: enforceLiveness ? 1 : 0,
    });
  }

  const apiErr = mutation.error instanceof Error ? mutation.error.message : null;
  const error = localErr ?? apiErr;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Clock className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-[17px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                Working Hours
              </h3>
              <p className="text-[12px] text-muted">Attendance day boundaries</p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground" aria-label="Close">
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <TimeField
            label="Start of day"
            caption="When the workday officially begins"
            value={start}
            onChange={setStart}
            disabled={!canEdit}
          />
          <TimeField
            label="Late threshold"
            caption="Clock-ins past this time are flagged as late"
            value={late}
            onChange={setLate}
            disabled={!canEdit}
          />
          <TimeField
            label="Closing time"
            caption="Official end of the working day"
            value={end}
            onChange={setEnd}
            disabled={!canEdit}
          />

          <div>
            <label className="block text-[13px] font-semibold text-foreground mb-1">
              Reception override PIN {pinIsSet && <span className="text-success">✓ set</span>}
            </label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={overridePin}
              onChange={e => setOverridePin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={!canEdit || removeOverridePin}
              placeholder={pinIsSet ? 'Enter a new PIN to change it' : 'Set a PIN (4–8 digits)'}
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
            />
            {canEdit && pinIsSet && (
              <label className="flex items-center gap-2 mt-2 text-[12px] text-foreground cursor-pointer select-none">
                <input type="checkbox" checked={removeOverridePin} onChange={e => { setRemoveOverridePin(e.target.checked); if (e.target.checked) setOverridePin(''); }} className="h-4 w-4 rounded border-border accent-danger" />
                Remove the override PIN (disable overrides)
              </label>
            )}
            <p className="text-[11px] text-muted mt-1">
              Receptionists enter this at the kiosk to approve a flagged ID-photo or an after-hours check-in. Write-only — the value is never shown; leave blank to keep the current PIN.
            </p>
          </div>

          <div className="border-t border-border pt-4">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <label className="text-[13px] font-semibold text-foreground">Clock-in security</label>
            </div>
            <p className="text-[11px] text-muted mb-2">
              When enforced, clock-ins that fail the check are <strong>rejected</strong> (instead of recorded-only). Flip back here instantly if staff get blocked.
            </p>
            <label className="flex items-start gap-2 mb-2 cursor-pointer select-none">
              <input type="checkbox" checked={enforceReauth} onChange={e => setEnforceReauth(e.target.checked)} disabled={!canEdit} className="h-4 w-4 mt-0.5 rounded border-border accent-primary disabled:opacity-50" />
              <span className="text-[13px] text-foreground">Enforce re-auth <span className="text-muted">— require a PIN or biometric at clock-in (PIN works as a fallback).</span></span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={enforceLiveness} onChange={e => setEnforceLiveness(e.target.checked)} disabled={!canEdit} className="h-4 w-4 mt-0.5 rounded border-border accent-primary disabled:opacity-50" />
              <span className="text-[13px] text-foreground">Enforce liveness <span className="text-muted">— reject clock-in photos that fail the anti-spoof check.</span></span>
            </label>
            {(enforceReauth || enforceLiveness) && (
              <div className="flex items-start gap-2 mt-2 p-2 bg-accent/10 border border-accent/20 rounded-lg">
                <AlertTriangle className="h-3.5 w-3.5 text-accent-warm shrink-0 mt-0.5" />
                <p className="text-[11px] text-foreground">Enforcing can block legitimate clock-ins (liveness false-rejects, or offline clock-ins with no prompt). Roll out one at a time and watch the HR-review queue.</p>
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4">
            <HolidaysSection canEdit={canEdit} />
          </div>

          {canEdit && (
            <div className="border-t border-border pt-4">
              <MigrationRunner />
            </div>
          )}

          {canEdit && (
            <div className="border-t border-border pt-4">
              <GoLiveResetSection />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-danger/5 border border-danger/20 rounded-xl">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <p className="text-[13px] text-danger">{error}</p>
            </div>
          )}

          {current.updated_at && current.updated_at !== '1970-01-01T00:00:00Z' && (
            <p className="text-[11px] text-muted">
              Last updated: {new Date(current.updated_at).toLocaleString('en-GB')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-background/40">
          <button
            onClick={onClose}
            className="h-10 px-4 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          {canEdit ? (
            <button
              onClick={handleSave}
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl shadow-sm hover:bg-primary/90 transition-all disabled:opacity-50"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save
            </button>
          ) : (
            <span className="text-[12px] text-muted italic">Superadmin required to edit</span>
          )}
        </div>
      </div>
    </div>
  );
}

interface MigrationRunResult {
  applied: string[];
  skipped: string[];
  failures: { filename: string; errorMessage: string }[];
}

// Superadmin control to apply any pending DB schema migrations (idempotent —
// already-applied migrations are skipped). Saves needing the browser console.
function MigrationRunner() {
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const m = useMutation({
    mutationFn: () => api.post<MigrationRunResult>('/admin/migrations/run', {}),
    onSuccess: (r) => {
      const d = r.data;
      if (!d) { setResult({ ok: false, text: 'No response from server.' }); return; }
      if (d.failures.length > 0) {
        setResult({ ok: false, text: `Failed: ${d.failures.map((f) => `${f.filename} — ${f.errorMessage}`).join('; ')}` });
        return;
      }
      setResult({
        ok: true,
        text: d.applied.length > 0
          ? `Applied ${d.applied.length}: ${d.applied.join(', ')}.`
          : 'Nothing to apply — all migrations already up to date.',
      });
    },
    onError: (e) => setResult({ ok: false, text: e instanceof Error ? e.message : 'Failed to run migrations.' }),
  });

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Database className="h-4 w-4 text-primary" />
        <label className="text-[13px] font-semibold text-foreground">Database migrations</label>
      </div>
      <p className="text-[11px] text-muted mb-2">
        Apply pending schema updates (e.g. the public-holidays table). Safe to run repeatedly — already-applied migrations are skipped.
      </p>
      <button
        onClick={() => { setResult(null); m.mutate(); }}
        disabled={m.isPending}
        className="inline-flex items-center gap-1.5 h-9 px-3 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
      >
        {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
        {m.isPending ? 'Running…' : 'Run pending migrations'}
      </button>
      {result && (
        <p className={`text-[12px] mt-2 ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>
      )}
    </div>
  );
}

interface GoLiveResetResult { ok: boolean; backup: { date: string } }

interface GoLivePreview {
  officers: number; reception_links: number; visits: number; visitors: number;
  clock_records: number; notifications: number; push_subscriptions: number;
  leave_requests: number; absence_notices: number; audit_entries: number;
  users_deleted: number; webauthn_deleted: number;
  users_kept: number; directorates_kept: number; categories_kept: number; holidays_kept: number;
}

// Superadmin-only "clean slate" before go-live. Deletes the demo directory
// (officers + reception teams) and ALL test activity, keeping only the real org
// config (directorates, categories, holidays, settings), this superadmin's own
// login, and the kiosk user. Irreversible — the server backs up to R2 first.
// Guarded by a typed confirmation phrase + a PIN re-entry.
function GoLiveResetSection() {
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [pin, setPin] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<GoLivePreview | null>(null);

  const reset = () => { setPhrase(''); setPin(''); };

  // Read-only impact preview — safe to run anytime; never deletes anything.
  const previewM = useMutation({
    mutationFn: () => api.get<GoLivePreview>('/admin/maintenance/go-live-reset/preview'),
    onSuccess: (r) => setPreview(r.data ?? null),
  });

  const m = useMutation({
    mutationFn: () => api.post<GoLiveResetResult>('/admin/maintenance/go-live-reset', { confirm: phrase, pin }),
    onSuccess: (r) => {
      const d = r.data;
      setResult({
        ok: true,
        text: d
          ? `System cleared. A backup was saved (${d.backup.date}) before deletion. You can now add the real directory.`
          : 'System cleared.',
      });
      setArmed(false);
      reset();
      // Everything the dashboard shows is now empty/changed — refetch it all.
      ['users', 'officers', 'directorates', 'notifications', 'attendance', 'visits', 'audit', 'app-settings']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e) => setResult({ ok: false, text: e instanceof Error ? e.message : 'Reset failed.' }),
  });

  const canSubmit = phrase === 'RESET' && pin.length >= 4 && !m.isPending;

  return (
    <div className="rounded-xl border border-danger/30 bg-danger/[0.03] p-4">
      <div className="flex items-center gap-2 mb-1">
        <ShieldAlert className="h-4 w-4 text-danger" />
        <label className="text-[13px] font-semibold text-danger">Danger zone — Go-live reset</label>
      </div>
      <p className="text-[11px] text-muted mb-3">
        Permanently deletes all demo officers, reception teams, every user except <strong>you</strong> and the kiosk,
        and all test activity (visitors, visits, clock records, notifications, leave/absence, audit log).
        Keeps directorates, visit categories, holidays and settings. A backup is saved first, but this <strong>cannot be undone</strong>.
        Use this once, when the office is ready to go live.
      </p>

      <div className="mb-3">
        <button
          onClick={() => previewM.mutate()}
          disabled={previewM.isPending}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 border border-border text-foreground text-[12px] font-medium rounded-lg hover:bg-background transition-colors disabled:opacity-50"
        >
          {previewM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
          Preview impact (safe — counts only)
        </button>
        {preview && (
          <div className="mt-2 rounded-lg border border-border bg-background/60 p-3 text-[12px]">
            <p className="font-semibold text-danger mb-1">Would delete:</p>
            <ul className="text-foreground space-y-0.5 mb-2">
              <li>{preview.officers} officers · {preview.reception_links} reception links</li>
              <li>{preview.users_deleted} users (keeping {preview.users_kept}: you + kiosk)</li>
              <li>{preview.visits} visits · {preview.visitors} visitors</li>
              <li>{preview.clock_records} clock records · {preview.notifications} notifications</li>
              <li>{preview.leave_requests} leave · {preview.absence_notices} absence · {preview.push_subscriptions} push subs</li>
              <li>{preview.webauthn_deleted} biometric credentials · {preview.audit_entries} audit entries</li>
            </ul>
            <p className="font-semibold text-success mb-1">Would keep:</p>
            <ul className="text-foreground space-y-0.5">
              <li>{preview.directorates_kept} directorates · {preview.categories_kept} visit categories · {preview.holidays_kept} holidays</li>
              <li>App settings, your login, and the kiosk user</li>
            </ul>
          </div>
        )}
      </div>

      {!armed ? (
        <button
          onClick={() => { setResult(null); setArmed(true); }}
          className="inline-flex items-center gap-1.5 h-9 px-3 border border-danger/40 text-danger text-[13px] font-semibold rounded-lg hover:bg-danger/10 transition-colors"
        >
          <ShieldAlert className="h-3.5 w-3.5" /> Clear demo content…
        </button>
      ) : (
        <div className="space-y-2.5">
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1">
              Type <span className="font-mono font-bold text-danger">RESET</span> to confirm
            </label>
            <input
              type="text"
              autoComplete="off"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value.toUpperCase())}
              placeholder="RESET"
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-foreground mb-1">Re-enter your PIN</label>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="Your login PIN"
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-danger/20 focus:border-danger"
            />
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={() => { setResult(null); m.mutate(); }}
              disabled={!canSubmit}
              className="inline-flex items-center gap-1.5 h-9 px-3 bg-danger text-white text-[13px] font-semibold rounded-lg hover:bg-danger/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {m.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              {m.isPending ? 'Clearing…' : 'Permanently clear'}
            </button>
            <button
              onClick={() => { setArmed(false); reset(); }}
              disabled={m.isPending}
              className="h-9 px-3 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p className={`text-[12px] mt-2 ${result.ok ? 'text-success' : 'text-danger'}`}>{result.text}</p>
      )}
    </div>
  );
}

interface Holiday { id: string; date: string; name: string }

function HolidaysSection({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => api.get<Holiday[]>('/admin/holidays'),
  });
  const holidays = data?.data ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['holidays'] });
  const addM = useMutation({
    mutationFn: (body: { date: string; name: string }) => api.post('/admin/holidays', body),
    onSuccess: () => { setDate(''); setName(''); setErr(null); refresh(); },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Could not add holiday'),
  });
  const delM = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/holidays/${id}`),
    onSuccess: refresh,
  });

  // Today (Ghana = UTC) as YYYY-MM-DD, to dim past holidays.
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <CalendarDays className="h-4 w-4 text-primary" />
        <label className="text-[13px] font-semibold text-foreground">Public holidays</label>
      </div>
      <p className="text-[11px] text-muted mb-3">
        On these dates (and weekends, and outside working hours) the kiosk treats the office as closed and requires the reception override to check a visitor in. Verify against the official Ministry of the Interior list.
      </p>

      {holidays.length > 0 && (
        <div className="max-h-44 overflow-y-auto rounded-xl border border-border divide-y divide-border mb-3">
          {holidays.map((h) => (
            <div key={h.id} className={`flex items-center gap-3 px-3 py-2 ${h.date < today ? 'opacity-50' : ''}`}>
              <span className="text-[12px] font-mono text-muted w-[92px] shrink-0">{h.date}</span>
              <span className="text-[13px] text-foreground flex-1 truncate">{h.name}</span>
              {canEdit && (
                <button
                  onClick={() => delM.mutate(h.id)}
                  disabled={delM.isPending}
                  className="text-muted hover:text-danger transition-colors shrink-0"
                  aria-label={`Remove ${h.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9 px-2 rounded-lg border border-border bg-background text-[13px] font-mono"
          />
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Holiday name"
            className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] flex-1 min-w-[140px]"
          />
          <button
            onClick={() => { if (date && name.trim()) addM.mutate({ date, name: name.trim() }); }}
            disabled={addM.isPending || !date || !name.trim()}
            className="inline-flex items-center gap-1.5 h-9 px-3 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          {err && <p className="text-danger text-[12px] w-full">{err}</p>}
        </div>
      )}
    </div>
  );
}

function TimeField({
  label, caption, value, onChange, disabled,
}: { label: string; caption: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-foreground mb-1">{label}</label>
      <input
        type="time"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
      />
      <p className="text-[11px] text-muted mt-1">{caption}</p>
    </div>
  );
}
