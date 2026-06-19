import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from '@/stores/toast';
import {
  InternRegistrationFields,
  emptyInternForm,
  type InternFormValues,
  type InternFieldErrors,
} from './InternRegistrationFields';
import {
  X, GraduationCap, FileSpreadsheet, Download, Upload, CheckCircle2,
  AlertCircle, Copy, KeyRound, Loader2,
} from 'lucide-react';

/* ---- Types & schema ---- */

interface Directorate {
  id: string;
  name: string;
  abbreviation: string;
}

interface NssUserResponse {
  id: string;
  name: string;
  email: string;
  nss_number: string;
  nss_start_date: string;
  nss_end_date: string;
  directorate_id: string;
  directorate_abbr: string | null;
  grade: string | null;
}

interface CreateResponse {
  user: NssUserResponse;
  initial_pin: string;
}

interface InternUserResponse {
  id: string;
  name: string;
  email: string;
  intern_code: string;
  nss_start_date: string;
  nss_end_date: string;
  directorate_id: string;
  directorate_abbr: string | null;
  institution: string | null;
  programme: string | null;
  supervisor_user_id: string | null;
  grade: string | null;
}

interface InternCreateResponse {
  user: InternUserResponse;
  initial_pin: string;
}

interface BulkInsertedRow {
  row: number;
  name: string;
  email: string;
  nss_number: string;
  initial_pin: string;
}

interface BulkResponse {
  inserted: number;
  skipped: Array<{ row: number; reason: string }>;
  pins: BulkInsertedRow[];
}

const NSS_NUMBER_REGEX = /^NSS[A-Z]{3}\d{7}$/;

const nssFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email').max(255),
  nss_number: z
    .string()
    .regex(NSS_NUMBER_REGEX, 'Format: NSSXXX0000000 (e.g. NSSGUE8364724)'),
  nss_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  nss_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  directorate_id: z.string().min(1, 'Select a directorate'),
  grade: z.string().max(100).optional().or(z.literal('')),
});
type NssFormValues = z.infer<typeof nssFormSchema>;

/* ---- CSV helpers ---- */

const CSV_HEADERS = [
  'name',
  'email',
  'nss_number',
  'nss_start_date',
  'nss_end_date',
  'directorate_abbreviation',
] as const;

function downloadTemplate() {
  const example = [
    'Akua Boateng',
    'akua.boateng@ohcs.gov.gh',
    'NSSGUE8364724',
    '2025-09-01',
    '2026-08-31',
    'RSIMD',
  ];
  const csv = [CSV_HEADERS.join(','), example.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ohcs-nss-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast.success('Copied to clipboard'),
    () => toast.error('Copy failed — select and copy manually'),
  );
}

/* ---- Modal ---- */

interface Props {
  onClose: () => void;
}

export function NssRegistrationModal({ onClose }: Props) {
  const [tab, setTab] = useState<'single' | 'bulk'>('single');
  const [regType, setRegType] = useState<'nss' | 'intern'>('nss');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-[2px]"
          style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }}
        />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <GraduationCap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
                {regType === 'intern' ? 'Register Intern' : 'Register NSS Personnel'}
              </h3>
              <p className="text-[12px] text-muted">
                {regType === 'intern' ? 'Internship placement onboarding' : 'National Service onboarding'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type toggle */}
        <div className="flex items-center gap-1 px-6 pt-4">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wide mr-1">Type</span>
          <div className="flex items-center gap-1 bg-background rounded-lg border border-border p-1">
            {(['nss', 'intern'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setRegType(t);
                  if (t === 'intern') setTab('single');
                }}
                className={cn(
                  'h-8 px-3.5 rounded-md text-[12px] font-medium transition-all',
                  regType === t
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-muted hover:text-foreground',
                )}
              >
                {t === 'nss' ? 'NSS' : 'Intern'}
              </button>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3">
          <TabButton active={tab === 'single'} onClick={() => setTab('single')}>
            Register One
          </TabButton>
          {regType === 'nss' && (
            <TabButton active={tab === 'bulk'} onClick={() => setTab('bulk')}>
              Bulk Import (CSV)
            </TabButton>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'single' ? (
            regType === 'intern'
              ? <InternSingleTab onDone={onClose} />
              : <SingleTab onDone={onClose} />
          ) : (
            <BulkTab />
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- Tab button ---- */

function TabButton({
  active,
  onClick,
  children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'h-9 px-4 rounded-lg text-[13px] font-medium transition-all',
        active
          ? 'bg-primary text-white shadow-sm'
          : 'text-muted hover:text-foreground hover:bg-background',
      )}
    >
      {children}
    </button>
  );
}

/* ---- Single registration ---- */

function SingleTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [pinResult, setPinResult] = useState<CreateResponse | null>(null);

  const { data: dirData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
  });
  const directorates = dirData?.data ?? [];

  const form = useForm<NssFormValues>({
    resolver: zodResolver(nssFormSchema),
    defaultValues: {
      name: '',
      email: '',
      nss_number: '',
      nss_start_date: '',
      nss_end_date: '',
      directorate_id: '',
      grade: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: NssFormValues) => {
      const payload = { ...data, grade: data.grade || undefined };
      return api.post<CreateResponse>('/admin/nss', payload);
    },
    onSuccess: (res) => {
      if (res.data) {
        setPinResult(res.data);
        toast.success('NSS personnel registered');
        qc.invalidateQueries({ queryKey: ['users'] });
        qc.invalidateQueries({ queryKey: ['nss-users'] });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    },
  });

  const nssNumberValue = form.watch('nss_number');
  const nssNumberValid = NSS_NUMBER_REGEX.test(nssNumberValue ?? '');

  if (pinResult) {
    return (
      <div className="p-6 space-y-5">
        <PinSuccessCard
          title={pinResult.user.name}
          subtitle={pinResult.user.nss_number}
          pin={pinResult.initial_pin}
        />
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => {
              setPinResult(null);
              form.reset();
            }}
            className="h-10 px-5 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
          >
            Register Another
          </button>
          <button
            onClick={onDone}
            className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            I've recorded this — close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((d) => mutation.mutate(d))}
      className="p-6 space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Full Name" error={form.formState.errors.name?.message}>
          <input {...form.register('name')} className={inputCls} placeholder="Akua Boateng" autoFocus />
        </FormField>
        <FormField label="Email" error={form.formState.errors.email?.message}>
          <input {...form.register('email')} type="email" className={inputCls} placeholder="akua.boateng@ohcs.gov.gh" />
        </FormField>
      </div>

      <FormField
        label="NSS Number"
        error={form.formState.errors.nss_number?.message}
        hint={
          <span className={cn('font-mono', nssNumberValid ? 'text-success' : 'text-muted')}>
            Format: NSSXXX0000000 — e.g. NSSGUE8364724
          </span>
        }
      >
        <input
          {...form.register('nss_number', {
            onChange: (e) => {
              e.target.value = e.target.value.toUpperCase();
            },
          })}
          className={cn(inputCls, 'uppercase font-mono tracking-wide')}
          placeholder="NSSGUE8364724"
          maxLength={13}
        />
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Service Start" error={form.formState.errors.nss_start_date?.message}>
          <input {...form.register('nss_start_date')} type="date" className={inputCls} />
        </FormField>
        <FormField label="Service End" error={form.formState.errors.nss_end_date?.message}>
          <input {...form.register('nss_end_date')} type="date" className={inputCls} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Directorate" error={form.formState.errors.directorate_id?.message}>
          <select {...form.register('directorate_id')} className={inputCls}>
            <option value="">Select directorate…</option>
            {directorates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.abbreviation} — {d.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Grade (optional)">
          <input {...form.register('grade')} className={inputCls} placeholder="e.g. National Service Personnel" />
        </FormField>
      </div>

      {mutation.isError && (
        <div className="flex items-start gap-2 p-3 bg-danger/5 border border-danger/20 rounded-xl">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <p className="text-[13px] text-danger">
            {mutation.error instanceof Error ? mutation.error.message : 'Registration failed'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onDone}
          className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GraduationCap className="h-4 w-4" />
          )}
          {mutation.isPending ? 'Registering…' : 'Register NSS'}
        </button>
      </div>
    </form>
  );
}

/* ---- Single intern registration ---- */

function validateInternForm(v: InternFormValues): InternFieldErrors {
  const errors: InternFieldErrors = {};
  if (!v.name.trim()) errors.name = 'Name is required';
  if (!v.email.trim()) errors.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.email = 'Invalid email';
  if (!v.directorate_id) errors.directorate_id = 'Select a directorate';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.nss_start_date)) errors.nss_start_date = 'Start date is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.nss_end_date)) errors.nss_end_date = 'End date is required';
  else if (
    /^\d{4}-\d{2}-\d{2}$/.test(v.nss_start_date) &&
    v.nss_end_date <= v.nss_start_date
  ) {
    errors.nss_end_date = 'End date must be after start date';
  }
  return errors;
}

function InternSingleTab({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<InternFormValues>(emptyInternForm);
  const [errors, setErrors] = useState<InternFieldErrors>({});
  const [pinResult, setPinResult] = useState<InternCreateResponse | null>(null);

  function setField<K extends keyof InternFormValues>(field: K, value: InternFormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  }

  const mutation = useMutation({
    mutationFn: (v: InternFormValues) => {
      const payload = {
        name: v.name.trim(),
        email: v.email.trim(),
        institution: v.institution.trim() || undefined,
        programme: v.programme.trim() || undefined,
        supervisor_user_id: v.supervisor_user_id || undefined,
        directorate_id: v.directorate_id,
        nss_start_date: v.nss_start_date,
        nss_end_date: v.nss_end_date,
        grade: v.grade.trim() || undefined,
      };
      return api.post<InternCreateResponse>('/admin/interns', payload);
    },
    onSuccess: (res) => {
      if (res.data) {
        setPinResult(res.data);
        toast.success('Intern registered');
        qc.invalidateQueries({ queryKey: ['users'] });
        qc.invalidateQueries({ queryKey: ['nss-users'] });
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Registration failed');
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const v = validateInternForm(values);
    setErrors(v);
    if (Object.keys(v).some((k) => v[k as keyof InternFieldErrors])) return;
    mutation.mutate(values);
  }

  if (pinResult) {
    return (
      <div className="p-6 space-y-5">
        <PinSuccessCard
          title={pinResult.user.name}
          subtitle={pinResult.user.email}
          pin={pinResult.initial_pin}
          internCode={pinResult.user.intern_code}
        />
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={() => {
              setPinResult(null);
              setValues(emptyInternForm);
              setErrors({});
            }}
            className="h-10 px-5 text-[13px] font-medium text-muted hover:text-foreground transition-colors"
          >
            Register Another
          </button>
          <button
            onClick={onDone}
            className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm"
          >
            <CheckCircle2 className="h-4 w-4" />
            I've recorded this — close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <InternRegistrationFields values={values} errors={errors} onChange={setField} />

      {mutation.isError && (
        <div className="flex items-start gap-2 p-3 bg-danger/5 border border-danger/20 rounded-xl">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <p className="text-[13px] text-danger">
            {mutation.error instanceof Error ? mutation.error.message : 'Registration failed'}
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onDone}
          className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GraduationCap className="h-4 w-4" />
          )}
          {mutation.isPending ? 'Registering…' : 'Register Intern'}
        </button>
      </div>
    </form>
  );
}

/* ---- Bulk import ---- */

function BulkTab() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');

  const mutation = useMutation({
    mutationFn: (csv: string) => api.post<BulkResponse>('/admin/nss/bulk-import', { csv }),
    onSuccess: (res) => {
      if (res.data) {
        toast.success(`Imported ${res.data.inserted} NSS personnel, ${res.data.skipped.length} skipped`);
        qc.invalidateQueries({ queryKey: ['users'] });
        qc.invalidateQueries({ queryKey: ['nss-users'] });
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Import failed'),
  });

  const result = mutation.data?.data;

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  const previewLines = useMemo(
    () => csvText.split(/\r?\n/).filter((l) => l.trim().length > 0),
    [csvText],
  );

  return (
    <div className="p-6 space-y-5">
      <div className="space-y-2">
        <p className="text-[13px] text-muted">
          Upload a CSV with the columns:{' '}
          <code className="px-1.5 py-0.5 rounded bg-background border border-border text-[12px]">
            {CSV_HEADERS.join(', ')}
          </code>
          . Directorate values match the existing abbreviation (e.g. <code>RSIMD</code>).
          Each successful row generates a 6-digit initial PIN — record these before closing.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={downloadTemplate}
          className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-medium rounded-xl border border-border hover:border-accent/40 transition-all"
        >
          <Download className="h-4 w-4 text-accent-warm" />
          Download template
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 h-10 px-4 bg-surface text-foreground text-[13px] font-medium rounded-xl border border-border hover:border-primary/30 transition-all"
        >
          <Upload className="h-4 w-4 text-primary" />
          Upload CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFile}
        />
        {fileName && <span className="self-center text-[12px] text-muted">{fileName}</span>}
      </div>

      <div>
        <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
          Or paste CSV
        </label>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={6}
          className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder={`${CSV_HEADERS.join(',')}\nAkua Boateng,akua.boateng@ohcs.gov.gh,NSSGUE8364724,2025-09-01,2026-08-31,RSIMD`}
        />
        {csvText && (
          <p className="mt-1 text-[11px] text-muted">
            {Math.max(previewLines.length - 1, 0)} data row{previewLines.length - 1 === 1 ? '' : 's'} detected
          </p>
        )}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          disabled={!csvText.trim() || mutation.isPending}
          onClick={() => mutation.mutate(csvText)}
          className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4" />
          )}
          {mutation.isPending ? 'Importing…' : 'Import CSV'}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-4 animate-fade-in-up">
          <div className="flex items-center gap-3 p-4 rounded-xl border border-success/30 bg-success-light/30">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <div className="text-[13px]">
              <p className="font-semibold text-foreground">
                {result.inserted} imported · {result.skipped.length} skipped
              </p>
              <p className="text-muted">
                Copy the PINs below and distribute them privately — they are shown once.
              </p>
            </div>
          </div>

          {result.pins.length > 0 && (
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-primary" />
                  <span className="text-[13px] font-semibold text-foreground">
                    Initial PINs ({result.pins.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    copy(
                      result.pins
                        .map((p) => `${p.name}\t${p.email}\t${p.nss_number}\t${p.initial_pin}`)
                        .join('\n'),
                    )
                  }
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium rounded-lg border border-border hover:border-primary/40 transition-all"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy all
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-background/50">
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Row</th>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Name</th>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">NSS Number</th>
                      <th className="text-left px-4 py-2 text-[11px] font-semibold text-muted uppercase tracking-wide">Initial PIN</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {result.pins.map((p) => (
                      <tr key={p.row}>
                        <td className="px-4 py-2 text-[12px] font-mono text-muted">{p.row}</td>
                        <td className="px-4 py-2 text-[13px] text-foreground">{p.name}</td>
                        <td className="px-4 py-2 text-[12px] font-mono text-foreground">{p.nss_number}</td>
                        <td className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => copy(p.initial_pin)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/5 text-primary font-mono text-[13px] font-bold tracking-wider hover:bg-primary/10 transition-all"
                            title="Copy PIN"
                          >
                            {p.initial_pin}
                            <Copy className="h-3 w-3" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.skipped.length > 0 && (
            <div className="bg-surface rounded-xl border border-danger/20 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-danger/5">
                <AlertCircle className="h-4 w-4 text-danger" />
                <span className="text-[13px] font-semibold text-danger">
                  Skipped rows ({result.skipped.length})
                </span>
              </div>
              <ul className="divide-y divide-border">
                {result.skipped.map((s, i) => (
                  <li key={i} className="px-4 py-2 text-[13px] text-foreground">
                    <span className="font-mono text-muted mr-2">Row {s.row}</span>
                    {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---- Reusable bits ---- */

function PinSuccessCard({ title, subtitle, pin, internCode }: {
  title: string; subtitle: string; pin: string; internCode?: string;
}) {
  return (
    <div className="bg-surface rounded-2xl border border-success/30 overflow-hidden">
      <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #2E7D5B, #5BA77B 50%, #2E7D5B)' }} />
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-success" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              {title}
            </p>
            <p className="text-[12px] font-mono text-muted">{subtitle}</p>
          </div>
        </div>
        {internCode && (
          <div className="rounded-xl bg-accent/5 border border-accent/30 p-4">
            <p className="text-[11px] font-semibold text-accent-warm uppercase tracking-wide mb-2">
              Intern code — the intern uses this to sign in
            </p>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[20px] font-mono font-bold tracking-wide text-foreground">{internCode}</span>
              <button
                type="button"
                onClick={() => copy(internCode)}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-[12px] font-semibold rounded-lg bg-accent/10 text-accent-warm hover:bg-accent/15 transition-all"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
          </div>
        )}
        <div className="rounded-xl bg-background border border-border p-4">
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
            Initial PIN — shown once
          </p>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[28px] font-mono font-bold tracking-[0.4em] text-primary">{pin}</span>
            <button
              type="button"
              onClick={() => copy(pin)}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-[12px] font-semibold rounded-lg bg-primary/10 text-primary hover:bg-primary/15 transition-all"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
        </div>
        <p className="text-[12px] text-muted">
          Hand this PIN to the personnel privately. They will be prompted to set a new one on first login.
        </p>
      </div>
    </div>
  );
}

const inputCls =
  'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function FormField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">
        {label}
      </label>
      {children}
      {error && <p className="text-danger text-[12px] mt-1">{error}</p>}
      {!error && hint && <p className="text-[11px] mt-1">{hint}</p>}
    </div>
  );
}
