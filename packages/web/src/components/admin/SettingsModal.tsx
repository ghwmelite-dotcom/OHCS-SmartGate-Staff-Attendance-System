import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { XCircle, Clock, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

export interface AppSettings {
  work_start_time: string;
  late_threshold_time: string;
  work_end_time: string;
  reception_override_pin: string | null;
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
  const [overridePin, setOverridePin] = useState(current.reception_override_pin ?? '');
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    setStart(current.work_start_time);
    setLate(current.late_threshold_time);
    setEnd(current.work_end_time);
    setOverridePin(current.reception_override_pin ?? '');
  }, [current]);

  const mutation = useMutation({
    mutationFn: (body: { work_start_time: string; late_threshold_time: string; work_end_time: string; reception_override_pin: string }) =>
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
      setLocalErr('Override PIN must be 4–8 digits (or blank to disable)');
      return;
    }
    mutation.mutate({ work_start_time: start, late_threshold_time: late, work_end_time: end, reception_override_pin: pin });
  }

  const apiErr = mutation.error instanceof Error ? mutation.error.message : null;
  const error = localErr ?? apiErr;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-md overflow-hidden"
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

        <div className="p-6 space-y-4">
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
            <label className="block text-[13px] font-semibold text-foreground mb-1">Reception override PIN</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={overridePin}
              onChange={e => setOverridePin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              disabled={!canEdit}
              placeholder="4–8 digits"
              className="w-full h-10 px-3 rounded-xl border border-border bg-background text-[14px] font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <p className="text-[11px] text-muted mt-1">
              Receptionists enter this at the kiosk to approve a check-in the ID-photo check flagged. Leave blank to disable overrides.
            </p>
          </div>

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
