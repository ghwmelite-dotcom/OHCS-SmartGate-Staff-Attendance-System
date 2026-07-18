import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Calendar,
  CalendarClock,
  CheckCircle2,
  XCircle,
  Clock,
  Ban,
  Settings2,
  ChevronDown,
  X,
  Plus,
  Pencil,
  Trash2,
  Search,
  UserPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';
import {
  api,
  appointmentsApi,
  type AppointmentRecord,
  type BookableOfficerRecord,
  type ApproverRecord,
  type UpsertBookableOfficer,
} from '@/lib/api';

/* ---- Helpers ---- */

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';
const textareaCls =
  'w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none';

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-[12px] mt-1">{error}</p>}
    </div>
  );
}

/* ---- Status badge ---- */

const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: {
    label: 'Pending',
    cls: 'bg-amber-50 text-amber-700 border border-amber-200',
    icon: <Clock className="h-3 w-3" />,
  },
  confirmed: {
    label: 'Confirmed',
    cls: 'bg-success/10 text-success border border-success/20',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  declined: {
    label: 'Declined',
    cls: 'bg-danger/10 text-danger border border-danger/20',
    icon: <XCircle className="h-3 w-3" />,
  },
  cancelled: {
    label: 'Cancelled',
    cls: 'bg-border text-muted-foreground',
    icon: <Ban className="h-3 w-3" />,
  },
  completed: {
    label: 'Completed',
    cls: 'bg-info/10 text-info border border-info/20',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, cls: 'bg-border text-muted-foreground', icon: null };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        cfg.cls
      )}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

/* ---- Modal wrapper ---- */

function Modal({
  title,
  onClose,
  children,
  icon,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-[2px]"
          style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }}
        />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                {icon}
              </div>
            )}
            <h3
              className="text-lg font-bold text-foreground"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

/* ---- Confirm modal ---- */

const confirmSchema = z.object({
  approver_notes: z.string().max(500).optional(),
});
type ConfirmForm = z.infer<typeof confirmSchema>;

function ConfirmModal({
  appointment,
  onClose,
  onSuccess,
}: {
  appointment: AppointmentRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<ConfirmForm>({ resolver: zodResolver(confirmSchema) });
  const mutation = useMutation({
    mutationFn: (data: ConfirmForm) =>
      appointmentsApi.confirm(appointment.id, data.approver_notes),
    onSuccess: () => {
      toast.success('Appointment confirmed');
      onSuccess();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm');
    },
  });

  return (
    <Modal
      title="Confirm Appointment"
      onClose={onClose}
      icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
    >
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          Confirming appointment for{' '}
          <span className="font-semibold text-foreground">{appointment.visitor_name}</span> with{' '}
          <span className="font-semibold text-foreground">{appointment.officer_name}</span> on{' '}
          {appointment.appointment_date} at {appointment.time_slot}.
        </p>
        <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
          <FormField label="Notes (optional)" error={form.formState.errors.approver_notes?.message}>
            <textarea
              {...form.register('approver_notes')}
              className={textareaCls}
              rows={3}
              placeholder="Any notes for the visitor…"
            />
          </FormField>
          {mutation.isError && (
            <p className="text-danger text-[13px] mt-2">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to confirm'}
            </p>
          )}
          <div className="flex justify-end gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-success text-white text-[14px] font-semibold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-success/15"
            >
              {mutation.isPending ? 'Confirming…' : 'Confirm Appointment'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/* ---- Decline modal ---- */

const declineSchema = z.object({
  decline_reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});
type DeclineForm = z.infer<typeof declineSchema>;

function DeclineModal({
  appointment,
  onClose,
  onSuccess,
}: {
  appointment: AppointmentRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<DeclineForm>({ resolver: zodResolver(declineSchema) });
  const mutation = useMutation({
    mutationFn: (data: DeclineForm) =>
      appointmentsApi.decline(appointment.id, data.decline_reason),
    onSuccess: () => {
      toast.success('Appointment declined');
      onSuccess();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to decline');
    },
  });

  return (
    <Modal
      title="Decline Appointment"
      onClose={onClose}
      icon={<XCircle className="h-4 w-4 text-danger" />}
    >
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          Declining appointment for{' '}
          <span className="font-semibold text-foreground">{appointment.visitor_name}</span>.
        </p>
        <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
          <FormField
            label="Reason for declining"
            error={form.formState.errors.decline_reason?.message}
          >
            <textarea
              {...form.register('decline_reason')}
              className={textareaCls}
              rows={3}
              placeholder="Please provide a reason…"
              autoFocus
            />
          </FormField>
          {mutation.isError && (
            <p className="text-danger text-[13px] mt-2">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to decline'}
            </p>
          )}
          <div className="flex justify-end gap-3 mt-5">
            <button
              type="button"
              onClick={onClose}
              className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-danger text-white text-[14px] font-semibold rounded-xl hover:opacity-90 transition-all disabled:opacity-50 shadow-lg shadow-danger/15"
            >
              {mutation.isPending ? 'Declining…' : 'Decline Appointment'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}

/* ---- Cancel confirm modal ---- */

function CancelModal({
  appointment,
  onClose,
  onSuccess,
}: {
  appointment: AppointmentRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () => appointmentsApi.cancel(appointment.id),
    onSuccess: () => {
      toast.success('Appointment cancelled');
      onSuccess();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    },
  });

  return (
    <Modal
      title="Cancel Appointment"
      onClose={onClose}
      icon={<Ban className="h-4 w-4 text-muted-foreground" />}
    >
      <div className="space-y-4">
        <p className="text-[14px] text-muted">
          Are you sure you want to cancel the appointment for{' '}
          <span className="font-semibold text-foreground">{appointment.visitor_name}</span>? This
          cannot be undone.
        </p>
        {mutation.isError && (
          <p className="text-danger text-[13px]">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to cancel'}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
          >
            Keep
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="h-11 px-6 bg-border text-foreground text-[14px] font-semibold rounded-xl hover:bg-border/70 transition-all disabled:opacity-50"
          >
            {mutation.isPending ? 'Cancelling…' : 'Cancel Appointment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---- Appointment card ---- */

type QueueAction =
  | { type: 'confirm'; appt: AppointmentRecord }
  | { type: 'decline'; appt: AppointmentRecord }
  | { type: 'cancel'; appt: AppointmentRecord };

function AppointmentCard({
  appt,
  onAction,
  onComplete,
}: {
  appt: AppointmentRecord;
  onAction: (action: QueueAction) => void;
  onComplete: (id: string) => void;
}) {
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 space-y-3 hover:border-border/70 transition-all">
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[15px] font-bold text-foreground">{appt.visitor_name}</span>
            {appt.organisation && (
              <span className="text-[12px] text-muted">· {appt.organisation}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[13px] text-muted flex-wrap">
            <span>{appt.visitor_phone}</span>
            {appt.visitor_email && <span>{appt.visitor_email}</span>}
          </div>
        </div>
        <StatusBadge status={appt.status} />
      </div>

      {/* Purpose */}
      <p className="text-[13px] text-foreground/80 leading-relaxed line-clamp-2">
        {appt.purpose.length > 80 ? appt.purpose.slice(0, 80) + '…' : appt.purpose}
      </p>

      {/* Officer + date/time */}
      <div className="flex items-center gap-4 text-[13px] text-muted flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-primary">OF</span>
          </div>
          <span>
            <span className="font-medium text-foreground">{appt.officer_name}</span>
            {appt.officer_title && <span className="text-muted"> · {appt.officer_title}</span>}
          </span>
        </div>
        <span className="text-border">|</span>
        <span>{appt.directorate_name}</span>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>
            {appt.appointment_date} at {appt.time_slot}
          </span>
        </div>
      </div>

      {/* Reference + approver notes */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="text-[11px] font-mono text-muted bg-background px-2 py-0.5 rounded-lg border border-border">
          {appt.reference_code}
        </span>
        {appt.decline_reason && (
          <span className="text-[12px] text-danger">Reason: {appt.decline_reason}</span>
        )}
        {appt.approver_notes && (
          <span className="text-[12px] text-muted italic">Note: {appt.approver_notes}</span>
        )}
      </div>

      {/* Actions */}
      {appt.status === 'pending' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onAction({ type: 'confirm', appt })}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-success/10 text-success text-[13px] font-semibold rounded-xl hover:bg-success/20 transition-all border border-success/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Confirm
          </button>
          <button
            onClick={() => onAction({ type: 'decline', appt })}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-danger/10 text-danger text-[13px] font-semibold rounded-xl hover:bg-danger/20 transition-all border border-danger/20"
          >
            <XCircle className="h-3.5 w-3.5" />
            Decline
          </button>
        </div>
      )}
      {appt.status === 'confirmed' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onComplete(appt.id)}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-info/10 text-info text-[13px] font-semibold rounded-xl hover:bg-info/20 transition-all border border-info/20"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Complete
          </button>
          <button
            onClick={() => onAction({ type: 'cancel', appt })}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-border text-muted-foreground text-[13px] font-semibold rounded-xl hover:bg-border/70 transition-all"
          >
            <Ban className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Queue sub-view ---- */

interface QueueFilters {
  status: string;
  officer_id: string;
}

function QueueView({ bookableOfficers }: { bookableOfficers: BookableOfficerRecord[] }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<QueueFilters>({ status: '', officer_id: '' });
  const [action, setAction] = useState<QueueAction | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['appointments-admin', filters],
    queryFn: () =>
      appointmentsApi.list({
        status: filters.status || undefined,
        officer_id: filters.officer_id || undefined,
      }),
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => appointmentsApi.complete(id),
    onSuccess: () => {
      toast.success('Appointment marked complete');
      queryClient.invalidateQueries({ queryKey: ['appointments-admin'] });
      refetch();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to complete');
    },
  });

  const appointments = data?.data?.appointments ?? [];

  return (
    <div className="space-y-5">
      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="h-10 pl-3.5 pr-8 rounded-xl border border-border bg-surface text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="declined">Declined</option>
            <option value="cancelled">Cancelled</option>
            <option value="completed">Completed</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
        </div>

        {bookableOfficers.length > 0 && (
          <div className="relative">
            <select
              value={filters.officer_id}
              onChange={(e) => setFilters((f) => ({ ...f, officer_id: e.target.value }))}
              className="h-10 pl-3.5 pr-8 rounded-xl border border-border bg-surface text-[13px] font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer"
            >
              <option value="">All Officers</option>
              {bookableOfficers.map((o) => (
                <option key={o.officer_id} value={o.officer_id}>
                  {o.officer_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
          </div>
        )}

        <span className="text-[13px] text-muted ml-auto">
          {appointments.length > 0 && `${data?.data?.total ?? appointments.length} total`}
        </span>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-surface rounded-2xl border border-border p-5 space-y-3 animate-pulse">
              <div className="h-4 bg-border rounded w-1/3" />
              <div className="h-3 bg-border rounded w-1/2" />
              <div className="h-3 bg-border rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : appointments.length === 0 ? (
        <div className="bg-surface rounded-2xl border border-border p-12 text-center">
          <Calendar className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-[15px] font-medium text-muted">No appointments found</p>
          <p className="text-[13px] text-muted mt-1 opacity-70">
            {filters.status || filters.officer_id
              ? 'Try adjusting your filters'
              : 'Appointments will appear here once visitors book them'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {appointments.map((appt) => (
            <AppointmentCard
              key={appt.id}
              appt={appt}
              onAction={setAction}
              onComplete={(id) => completeMutation.mutate(id)}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {action?.type === 'confirm' && (
        <ConfirmModal
          appointment={action.appt}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setAction(null);
            queryClient.invalidateQueries({ queryKey: ['appointments-admin'] });
            refetch();
          }}
        />
      )}
      {action?.type === 'decline' && (
        <DeclineModal
          appointment={action.appt}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setAction(null);
            queryClient.invalidateQueries({ queryKey: ['appointments-admin'] });
            refetch();
          }}
        />
      )}
      {action?.type === 'cancel' && (
        <CancelModal
          appointment={action.appt}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setAction(null);
            queryClient.invalidateQueries({ queryKey: ['appointments-admin'] });
            refetch();
          }}
        />
      )}
    </div>
  );
}

/* ---- Bookable officer upsert modal ---- */

const bookableSchema = z.object({
  officer_id: z.string().min(1, 'Select an officer'),
  is_active: z.boolean(),
  slot_duration_mins: z.coerce.number().int().min(15).max(120),
  slot_start_time: z.string().min(1, 'Required'),
  slot_end_time: z.string().min(1, 'Required'),
  advance_days_min: z.coerce.number().int().min(0),
  advance_days_max: z.coerce.number().int().min(1),
});
type BookableForm = z.infer<typeof bookableSchema>;

interface OfficerOption {
  id: string;
  name: string;
  title?: string | null;
  directorate_name?: string;
}

function BookableOfficerModal({
  editing,
  officers,
  onClose,
  onSuccess,
}: {
  editing: BookableOfficerRecord | null;
  officers: OfficerOption[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const form = useForm<BookableForm>({
    resolver: zodResolver(bookableSchema),
    defaultValues: editing
      ? {
          officer_id: editing.officer_id,
          is_active: editing.is_active === 1,
          slot_duration_mins: editing.slot_duration_mins,
          slot_start_time: editing.slot_start_time,
          slot_end_time: editing.slot_end_time,
          advance_days_min: editing.advance_days_min,
          advance_days_max: editing.advance_days_max,
        }
      : {
          officer_id: '',
          is_active: true,
          slot_duration_mins: 30,
          slot_start_time: '08:00',
          slot_end_time: '17:00',
          advance_days_min: 1,
          advance_days_max: 30,
        },
  });

  const mutation = useMutation({
    mutationFn: (data: BookableForm) =>
      appointmentsApi.upsertBookableOfficer(data as UpsertBookableOfficer),
    onSuccess: () => {
      toast.success(editing ? 'Officer updated' : 'Officer added');
      onSuccess();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    },
  });

  return (
    <Modal
      title={editing ? 'Edit Bookable Officer' : 'Add Bookable Officer'}
      onClose={onClose}
      icon={<Settings2 className="h-4 w-4 text-primary" />}
    >
      <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4">
        <FormField label="Officer" error={form.formState.errors.officer_id?.message}>
          <select
            {...form.register('officer_id')}
            className={inputCls}
            disabled={!!editing}
          >
            <option value="">Select officer…</option>
            {officers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}{o.directorate_name ? ` — ${o.directorate_name}` : ''}
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Start Time"
            error={form.formState.errors.slot_start_time?.message}
          >
            <input {...form.register('slot_start_time')} type="time" className={inputCls} />
          </FormField>
          <FormField
            label="End Time"
            error={form.formState.errors.slot_end_time?.message}
          >
            <input {...form.register('slot_end_time')} type="time" className={inputCls} />
          </FormField>
        </div>

        <FormField
          label="Slot Duration (mins)"
          error={form.formState.errors.slot_duration_mins?.message}
        >
          <select {...form.register('slot_duration_mins')} className={inputCls}>
            {[15, 30, 45, 60, 90, 120].map((d) => (
              <option key={d} value={d}>
                {d} minutes
              </option>
            ))}
          </select>
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Min Advance Days"
            error={form.formState.errors.advance_days_min?.message}
          >
            <input
              {...form.register('advance_days_min')}
              type="number"
              min={0}
              className={inputCls}
            />
          </FormField>
          <FormField
            label="Max Advance Days"
            error={form.formState.errors.advance_days_max?.message}
          >
            <input
              {...form.register('advance_days_max')}
              type="number"
              min={1}
              className={inputCls}
            />
          </FormField>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            {...form.register('is_active')}
            type="checkbox"
            className="w-4 h-4 rounded border-border accent-primary"
          />
          <span className="text-[14px] font-medium text-foreground">Active (visible for booking)</span>
        </label>

        {mutation.isError && (
          <p className="text-danger text-[13px]">
            {mutation.error instanceof Error ? mutation.error.message : 'Failed to save'}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
          >
            {mutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Add Officer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---- Add approver modal ---- */

function AddApproverModal({
  officerId,
  officerName,
  existingApprovers,
  onClose,
  onSuccess,
}: {
  officerId: string;
  officerName: string;
  existingApprovers: ApproverRecord[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [search, setSearch] = useState('');

  const { data: candidatesData, isLoading } = useQuery({
    queryKey: ['approver-candidates'],
    queryFn: () => appointmentsApi.getApproverCandidates(),
  });

  const addMutation = useMutation({
    mutationFn: (userId: string) => appointmentsApi.addApprover(officerId, userId),
    onSuccess: () => {
      toast.success('Approver added');
      onSuccess();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to add approver');
    },
  });

  const allCandidates = candidatesData?.data?.candidates ?? [];
  const existingIds = new Set(existingApprovers.map((a) => a.user_id));
  const q = search.trim().toLowerCase();
  const filtered = allCandidates.filter(
    (u) =>
      !existingIds.has(u.id) &&
      (q
        ? u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.directorate_name.toLowerCase().includes(q)
        : true)
  );

  return (
    <Modal
      title={`Add Approver — ${officerName}`}
      onClose={onClose}
      icon={<UserPlus className="h-4 w-4 text-primary" />}
    >
      <div className="space-y-4">
        <p className="text-[13px] text-muted">
          Staff officers (excluding directors) who have a system account.
        </p>
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email or directorate…"
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-border bg-surface text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted"
            autoFocus
          />
        </div>

        {isLoading ? (
          <div className="py-6 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-[14px] text-muted py-4">
            {q ? 'No matching officers' : 'No available officers to add'}
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto space-y-1 -mx-2 px-2">
            {filtered.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl hover:bg-background transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-foreground truncate">{u.name}</p>
                  <p className="text-[12px] text-muted truncate">
                    {u.officer_title} · {u.directorate_name}
                  </p>
                </div>
                <button
                  onClick={() => addMutation.mutate(u.id)}
                  disabled={addMutation.isPending}
                  className="shrink-0 inline-flex items-center gap-1 h-8 px-3 bg-primary/10 text-primary text-[12px] font-semibold rounded-lg hover:bg-primary/20 transition-all disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" />
                  Add
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            onClick={onClose}
            className="h-10 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---- Setup sub-view ---- */

function SetupView() {
  const queryClient = useQueryClient();

  // Bookable officers
  const { data: bookableData, isLoading: loadingBookable } = useQuery({
    queryKey: ['bookable-officers'],
    queryFn: () => appointmentsApi.getBookableOfficers(),
  });
  const bookableOfficers = bookableData?.data?.bookable_officers ?? [];

  // All officers (for the add modal selector)
  const { data: allOfficersData } = useQuery({
    queryKey: ['officers-list'],
    queryFn: () => api.get<{ id: string; name: string; title: string | null; directorate_name?: string }[]>('/officers'),
  });
  const allOfficers = (allOfficersData?.data ?? []).filter((o) => {
    const t = (o.title ?? '').trim();
    return (
      /^(chief\s+)?director\b/i.test(t) ||
      /^head\s+of\b/i.test(t)
    );
  });

  // Approvers — fetch per bookable officer
  const [selectedOfficerForApprover, setSelectedOfficerForApprover] = useState<BookableOfficerRecord | null>(null);
  const [approversMap, setApproversMap] = useState<Record<string, ApproverRecord[]>>({});

  // Fetch approvers for all bookable officers
  useQuery({
    queryKey: ['approvers-all', bookableOfficers.map((o) => o.officer_id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        bookableOfficers.map((o) => appointmentsApi.getApprovers(o.officer_id))
      );
      const map: Record<string, ApproverRecord[]> = {};
      bookableOfficers.forEach((o, i) => {
        map[o.officer_id] = results[i]?.data?.approvers ?? [];
      });
      setApproversMap(map);
      return map;
    },
    enabled: bookableOfficers.length > 0,
  });

  const [editingOfficer, setEditingOfficer] = useState<BookableOfficerRecord | null>(null);
  const [showAddOfficer, setShowAddOfficer] = useState(false);

  const deleteBookableMutation = useMutation({
    mutationFn: (officerId: string) => appointmentsApi.deleteBookableOfficer(officerId),
    onSuccess: () => {
      toast.success('Officer removed from bookable list');
      queryClient.invalidateQueries({ queryKey: ['bookable-officers'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    },
  });

  const removeApproverMutation = useMutation({
    mutationFn: (id: string) => appointmentsApi.removeApprover(id),
    onSuccess: () => {
      toast.success('Approver removed');
      queryClient.invalidateQueries({ queryKey: ['approvers-all'] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to remove approver');
    },
  });

  return (
    <div className="space-y-8">
      {/* Section 1 — Bookable Officers */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
        <div
          className="h-[2px]"
          style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }}
        />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Calendar className="h-4.5 w-4.5 text-primary" />
            </div>
            <div>
              <h2
                className="text-base font-bold text-foreground"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Bookable Officers
              </h2>
              <p className="text-[13px] text-muted">
                Officers whose appointment slots are publicly available
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddOfficer(true)}
            className="inline-flex items-center gap-2 h-10 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15"
          >
            <Plus className="h-4 w-4" />
            Add Officer
          </button>
        </div>

        {loadingBookable ? (
          <div className="p-8 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading…</p>
          </div>
        ) : bookableOfficers.length === 0 ? (
          <div className="p-10 text-center">
            <Calendar className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-[15px] text-muted font-medium">No bookable officers yet</p>
            <p className="text-[13px] text-muted mt-1 opacity-70">
              Add officers to enable appointment booking
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {bookableOfficers.map((o) => (
              <div key={o.id} className="px-6 py-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[15px] font-semibold text-foreground">{o.officer_name}</span>
                    {o.officer_title && (
                      <span className="text-[12px] text-muted">· {o.officer_title}</span>
                    )}
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                        o.is_active
                          ? 'bg-success/10 text-success border border-success/20'
                          : 'bg-border text-muted-foreground'
                      )}
                    >
                      {o.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-[13px] text-muted mt-0.5">
                    {o.directorate_name} ·{' '}
                    {o.slot_duration_mins}min slots · {o.slot_start_time}–{o.slot_end_time} ·{' '}
                    {o.advance_days_min}–{o.advance_days_max} days advance
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setEditingOfficer(o)}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-primary/5 transition-all"
                    title="Edit"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteBookableMutation.mutate(o.officer_id)}
                    disabled={deleteBookableMutation.isPending}
                    className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger/5 transition-all disabled:opacity-50"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2 — Approvers */}
      {bookableOfficers.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
          <div
            className="h-[2px]"
            style={{ background: 'linear-gradient(90deg, #1A4D2E, #2d7a4f 50%, #1A4D2E)' }}
          />
          <div className="px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <UserPlus className="h-4.5 w-4.5 text-primary" />
              </div>
              <div>
                <h2
                  className="text-base font-bold text-foreground"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Appointment Approvers
                </h2>
                <p className="text-[13px] text-muted">
                  Users who can confirm or decline appointments for each officer
                </p>
              </div>
            </div>
          </div>

          <div className="divide-y divide-border">
            {bookableOfficers.map((bo) => {
              const approvers = approversMap[bo.officer_id] ?? [];
              return (
                <div key={bo.officer_id} className="px-6 py-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[14px] font-semibold text-foreground">
                        {bo.officer_name}
                      </span>
                      <span className="text-[12px] text-muted ml-2">{bo.directorate_name}</span>
                    </div>
                    <button
                      onClick={() => setSelectedOfficerForApprover(bo)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 bg-primary/10 text-primary text-[12px] font-semibold rounded-lg hover:bg-primary/20 transition-all"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add Approver
                    </button>
                  </div>

                  {approvers.length === 0 ? (
                    <p className="text-[13px] text-muted opacity-70">No approvers assigned</p>
                  ) : (
                    <div className="space-y-1">
                      {approvers.map((a) => (
                        <div
                          key={a.id}
                          className="flex items-center justify-between gap-3 bg-background rounded-xl px-4 py-2.5"
                        >
                          <div className="min-w-0">
                            <span className="text-[14px] font-medium text-foreground">
                              {a.user_name}
                            </span>
                            <span className="text-[12px] text-muted ml-2">{a.user_email}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="inline-flex items-center h-5 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-md uppercase">
                              {a.user_role}
                            </span>
                            <button
                              onClick={() => removeApproverMutation.mutate(a.id)}
                              disabled={removeApproverMutation.isPending}
                              className="h-7 w-7 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger/5 transition-all disabled:opacity-50"
                              title="Remove approver"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modals */}
      {showAddOfficer && (
        <BookableOfficerModal
          editing={null}
          officers={allOfficers.map((o) => ({
            id: o.id,
            name: o.name,
            title: o.title,
            directorate_name: o.directorate_name,
          }))}
          onClose={() => setShowAddOfficer(false)}
          onSuccess={() => {
            setShowAddOfficer(false);
            queryClient.invalidateQueries({ queryKey: ['bookable-officers'] });
          }}
        />
      )}
      {editingOfficer && (
        <BookableOfficerModal
          editing={editingOfficer}
          officers={allOfficers.map((o) => ({
            id: o.id,
            name: o.name,
            title: o.title,
            directorate_name: o.directorate_name,
          }))}
          onClose={() => setEditingOfficer(null)}
          onSuccess={() => {
            setEditingOfficer(null);
            queryClient.invalidateQueries({ queryKey: ['bookable-officers'] });
          }}
        />
      )}
      {selectedOfficerForApprover && (
        <AddApproverModal
          officerId={selectedOfficerForApprover.officer_id}
          officerName={selectedOfficerForApprover.officer_name}
          existingApprovers={approversMap[selectedOfficerForApprover.officer_id] ?? []}
          onClose={() => setSelectedOfficerForApprover(null)}
          onSuccess={() => {
            setSelectedOfficerForApprover(null);
            queryClient.invalidateQueries({ queryKey: ['approvers-all'] });
          }}
        />
      )}
    </div>
  );
}

/* ---- Main AppointmentsTab ---- */

type ApptView = 'queue' | 'setup';

export function AppointmentsTab() {
  const user = useAuthStore((s) => s.user);
  const canSetup = user?.role === 'superadmin' || user?.role === 'admin';
  const [view, setView] = useState<ApptView>('queue');

  // Fetch bookable officers for the queue officer filter (always needed)
  const { data: bookableData } = useQuery({
    queryKey: ['bookable-officers'],
    queryFn: () => appointmentsApi.getBookableOfficers(),
  });
  const bookableOfficers = useMemo(
    () => bookableData?.data?.bookable_officers ?? [],
    [bookableData]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 animate-fade-in-up">
        <div>
          <h2
            className="text-[22px] font-bold text-foreground tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Appointments
          </h2>
          <p className="text-[14px] text-muted mt-0.5">
            Manage visitor appointment requests and bookable officer settings
          </p>
        </div>

        {/* Queue / Setup toggle */}
        {canSetup && (
          <div className="flex gap-1 bg-surface rounded-xl border border-border p-1">
            <button
              onClick={() => setView('queue')}
              className={cn(
                'h-9 px-5 rounded-lg text-[13px] font-medium transition-all',
                view === 'queue'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
            >
              Queue
            </button>
            <button
              onClick={() => setView('setup')}
              className={cn(
                'h-9 px-5 rounded-lg text-[13px] font-medium transition-all flex items-center gap-1.5',
                view === 'setup'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
            >
              <Settings2 className="h-3.5 w-3.5" />
              Setup
            </button>
          </div>
        )}
      </div>

      {view === 'queue' && <QueueView bookableOfficers={bookableOfficers} />}
      {view === 'setup' && canSetup && <SetupView />}
    </div>
  );
}
