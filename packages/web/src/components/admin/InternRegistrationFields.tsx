import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/* ---- Types ---- */

export interface InternFormValues {
  name: string;
  email: string;
  institution: string;
  programme: string;
  supervisor_user_id: string;
  directorate_id: string;
  nss_start_date: string;
  nss_end_date: string;
  grade: string;
}

export const emptyInternForm: InternFormValues = {
  name: '',
  email: '',
  institution: '',
  programme: '',
  supervisor_user_id: '',
  directorate_id: '',
  nss_start_date: '',
  nss_end_date: '',
  grade: '',
};

interface Directorate {
  id: string;
  name: string;
  abbreviation: string;
}

// Active staff returned by GET /admin/interns/supervisors (already filtered server-side).
interface Supervisor {
  id: string;
  name: string;
}

export type InternFieldErrors = Partial<Record<keyof InternFormValues, string>>;

/* ---- Component ---- */

export function InternRegistrationFields({
  values,
  errors,
  onChange,
}: {
  values: InternFormValues;
  errors?: InternFieldErrors;
  onChange: <K extends keyof InternFormValues>(field: K, value: InternFormValues[K]) => void;
}) {
  const { data: dirData } = useQuery({
    queryKey: ['directorates'],
    queryFn: () => api.get<Directorate[]>('/directorates'),
    staleTime: 5 * 60_000,
  });
  const directorates = dirData?.data ?? [];

  const { data: supervisorsData } = useQuery({
    queryKey: ['intern-supervisors'],
    queryFn: () => api.get<Supervisor[]>('/admin/interns/supervisors'),
    staleTime: 60_000,
  });
  const supervisors = supervisorsData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Full Name" error={errors?.name}>
          <input
            value={values.name}
            onChange={(e) => onChange('name', e.target.value)}
            className={inputCls}
            placeholder="Akua Boateng"
            autoFocus
          />
        </FormField>
        <FormField label="Email" error={errors?.email}>
          <input
            value={values.email}
            onChange={(e) => onChange('email', e.target.value)}
            type="email"
            className={inputCls}
            placeholder="akua.boateng@ohcs.gov.gh"
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Institution" error={errors?.institution}>
          <input
            value={values.institution}
            onChange={(e) => onChange('institution', e.target.value)}
            className={inputCls}
            placeholder="e.g. University of Ghana"
          />
        </FormField>
        <FormField label="Programme" error={errors?.programme}>
          <input
            value={values.programme}
            onChange={(e) => onChange('programme', e.target.value)}
            className={inputCls}
            placeholder="e.g. BSc Computer Science"
          />
        </FormField>
      </div>

      <FormField label="Supervisor (optional)" error={errors?.supervisor_user_id}>
        <select
          value={values.supervisor_user_id}
          onChange={(e) => onChange('supervisor_user_id', e.target.value)}
          className={inputCls}
        >
          <option value="">No supervisor</option>
          {supervisors.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Placement Start" error={errors?.nss_start_date}>
          <input
            value={values.nss_start_date}
            onChange={(e) => onChange('nss_start_date', e.target.value)}
            type="date"
            className={inputCls}
          />
        </FormField>
        <FormField label="Placement End" error={errors?.nss_end_date}>
          <input
            value={values.nss_end_date}
            onChange={(e) => onChange('nss_end_date', e.target.value)}
            type="date"
            className={inputCls}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FormField label="Directorate" error={errors?.directorate_id}>
          <select
            value={values.directorate_id}
            onChange={(e) => onChange('directorate_id', e.target.value)}
            className={inputCls}
          >
            <option value="">Select directorate…</option>
            {directorates.map((d) => (
              <option key={d.id} value={d.id}>
                {d.abbreviation} — {d.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Grade (optional)">
          <input
            value={values.grade}
            onChange={(e) => onChange('grade', e.target.value)}
            className={inputCls}
            placeholder="e.g. Intern"
          />
        </FormField>
      </div>
    </div>
  );
}

/* ---- Reusable bits (mirrors NssRegistrationModal) ---- */

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
