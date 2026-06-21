import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type Directorate, type Officer } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Building2, UserPlus, Pencil, Plus } from 'lucide-react';

const TYPES = [
  { value: 'directorate', label: 'Directorate', color: 'bg-primary/10 text-primary' },
  { value: 'secretariat', label: 'Secretariat', color: 'bg-accent/10 text-accent-warm' },
  { value: 'unit', label: 'Unit', color: 'bg-info/10 text-info' },
] as const;

interface DirectorateExt extends Directorate {
  type: string;
  rooms: string | null;
}

interface OfficerExt extends Officer {
  directorate_abbr?: string;
  has_override_pin?: number;
}

const dirSchema = z.object({
  name: z.string().min(1).max(200),
  abbreviation: z.string().min(1).max(20),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().max(200).optional(),
  floor: z.string().max(100).optional(),
  wing: z.string().max(100).optional(),
});

const officerSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().max(100).optional(),
  directorate_id: z.string().min(1),
  email: z.string().email().or(z.literal('')).optional(),
  phone: z.string().max(20).optional(),
  office_number: z.string().max(20).optional(),
});

export function DirectoratesTab() {
  const queryClient = useQueryClient();
  const [dirForm, setDirForm] = useState<{ open: boolean; editing: DirectorateExt | null }>({ open: false, editing: null });
  const [offForm, setOffForm] = useState<{ open: boolean; editing: OfficerExt | null }>({ open: false, editing: null });

  const { data: dirData } = useQuery({
    queryKey: ['directorates-admin'],
    queryFn: () => api.get<DirectorateExt[]>('/admin/directorates'),
  });

  const { data: offData } = useQuery({
    queryKey: ['officers-admin'],
    queryFn: () => api.get<OfficerExt[]>('/officers'),
  });

  const directorates = dirData?.data ?? [];
  const officers = offData?.data ?? [];

  const refreshDirs = () => queryClient.invalidateQueries({ queryKey: ['directorates-admin'] });
  const refreshOfficers = () => queryClient.invalidateQueries({ queryKey: ['officers-admin'] });

  return (
    <div className="space-y-6">
      {/* Directorates */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-4.5 w-4.5 text-primary" />
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Org Entities ({directorates.length})
            </h3>
          </div>
          <button onClick={() => setDirForm({ open: true, editing: null })}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Add Entity
          </button>
        </div>

        {dirForm.open && (
          <DirectorateForm
            key={dirForm.editing?.id ?? 'new'}
            editing={dirForm.editing}
            onClose={() => setDirForm({ open: false, editing: null })}
            onSuccess={() => { setDirForm({ open: false, editing: null }); refreshDirs(); }}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Code</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Type</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Location</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Reception team</th>
                <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {directorates.map(d => {
                const typeCfg = TYPES.find(t => t.value === d.type);
                const location = locationLabel(d);
                return (
                  <tr key={d.id} className={cn('hover:bg-background-warm/50 transition-colors', !d.is_active && 'opacity-55')}>
                    <td className="px-6 py-3 text-[14px] font-mono font-semibold text-foreground">{d.abbreviation}</td>
                    <td className="px-6 py-3 text-[14px] text-foreground">{d.name}</td>
                    <td className="px-6 py-3">
                      <span className={cn('inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-lg uppercase tracking-wide', typeCfg?.color)}>
                        {typeCfg?.label ?? d.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[13px] text-muted">{location ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className={cn('inline-flex items-center h-6 px-2 text-[10px] font-bold rounded-lg uppercase tracking-wide',
                        d.is_active ? 'bg-success/10 text-success' : 'bg-border text-muted')}>
                        {d.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      <ReceptionTeamCell directorate={d} officers={officers} onChanged={refreshDirs} />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button type="button" onClick={() => setDirForm({ open: true, editing: d })}
                        title="Edit entity"
                        className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted hover:text-primary hover:bg-primary/8 transition-colors">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Officers */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <UserPlus className="h-4.5 w-4.5 text-primary" />
            <h3 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Officers ({officers.length})
            </h3>
          </div>
          <button onClick={() => setOffForm({ open: true, editing: null })}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Add Officer
          </button>
        </div>

        {offForm.open && (
          <OfficerForm
            key={offForm.editing?.id ?? 'new'}
            editing={offForm.editing}
            directorates={directorates}
            onClose={() => setOffForm({ open: false, editing: null })}
            onSuccess={() => { setOffForm({ open: false, editing: null }); refreshOfficers(); }}
          />
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Title</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Directorate</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Office</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
                <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {officers.map(o => (
                <tr key={o.id} className={cn('hover:bg-background-warm/50 transition-colors', !o.is_available && 'opacity-55')}>
                  <td className="px-6 py-3 text-[14px] font-semibold text-foreground">{o.name}</td>
                  <td className="px-6 py-3 text-[14px] text-muted">{o.title ?? '—'}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                      {o.directorate_abbr ?? '—'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[13px] text-muted">{o.office_number ?? '—'}</td>
                  <td className="px-6 py-3">
                    <span className={cn('text-[13px] font-medium', o.is_available ? 'text-success' : 'text-muted-foreground')}>
                      {o.is_available ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button type="button" onClick={() => setOffForm({ open: true, editing: o })}
                      title="Edit officer"
                      className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-muted hover:text-primary hover:bg-primary/8 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function locationLabel(d: DirectorateExt): string | null {
  const parts: string[] = [];
  if (d.rooms) parts.push(`Rm ${d.rooms}`);
  if (d.floor) parts.push(d.floor);
  if (d.wing) parts.push(`${d.wing} Wing`);
  return parts.length ? parts.join(' · ') : null;
}

interface ReceiverRow { id: string; name: string; linked: boolean; primary: boolean }

function ReceptionTeamCell({ directorate, officers, onChanged }: {
  directorate: DirectorateExt;
  officers: OfficerExt[];
  onChanged: () => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: ['dir-receivers', directorate.id],
    queryFn: () => api.get<ReceiverRow[]>(`/admin/directorates/${directorate.id}/receivers`),
  });
  const receivers = data?.data ?? [];
  const [linkUrl, setLinkUrl] = useState<string | null>(null);

  const own = officers.filter((o) => o.directorate_id === directorate.id);
  const candidates = own.filter((o) => !receivers.some((r) => r.id === o.id));

  const after = () => { refetch(); onChanged(); };
  const addM = useMutation({ mutationFn: (officer_id: string) => api.post(`/admin/directorates/${directorate.id}/receivers`, { officer_id }), onSuccess: after });
  const delM = useMutation({ mutationFn: (officerId: string) => api.delete(`/admin/directorates/${directorate.id}/receivers/${officerId}`), onSuccess: after });
  const primaryM = useMutation({ mutationFn: (reception_officer_id: string) => api.put(`/admin/directorates/${directorate.id}`, { reception_officer_id }), onSuccess: after });
  const linkM = useMutation({ mutationFn: (officerId: string) => api.post<{ url: string }>(`/admin/directorates/officers/${officerId}/link-token`, {}), onSuccess: (r) => setLinkUrl(r.data?.url ?? null) });
  const unlinkM = useMutation({ mutationFn: (officerId: string) => api.delete(`/admin/directorates/officers/${officerId}/telegram`), onSuccess: after });

  return (
    <div className="space-y-1.5 min-w-[260px]">
      {receivers.length === 0 && <p className="text-[12px] text-muted">No receivers</p>}
      {receivers.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-[13px] flex-wrap">
          <span className="font-medium text-foreground">{r.name}</span>
          {r.primary && <span className="text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">PRIMARY</span>}
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded', r.linked ? 'bg-success/10 text-success' : 'bg-border text-muted')}>{r.linked ? 'linked' : 'not linked'}</span>
          {!r.primary && <button type="button" onClick={() => primaryM.mutate(r.id)} className="text-[11px] text-primary hover:underline">make primary</button>}
          <button type="button" onClick={() => linkM.mutate(r.id)} className="text-[11px] text-accent-warm hover:underline">generate link</button>
          {r.linked && <button type="button" onClick={() => unlinkM.mutate(r.id)} className="text-[11px] text-muted hover:text-danger">unlink</button>}
          <button type="button" onClick={() => delM.mutate(r.id)} className="text-[11px] text-muted hover:text-danger ml-auto">remove</button>
        </div>
      ))}
      {candidates.length > 0 && (
        <select value="" onChange={(e) => { if (e.target.value) addM.mutate(e.target.value); }}
          className="h-8 px-2 rounded-lg border border-border bg-background text-[12px]">
          <option value="">+ add receiver…</option>
          {candidates.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
      {linkUrl && (
        <div className="text-[11px] space-y-0.5">
          <input readOnly value={linkUrl} onFocus={(e) => e.currentTarget.select()} className="w-full h-7 px-2 rounded border border-border bg-background font-mono" />
          <p className="text-muted">Copy &amp; send to the officer; they tap it once on their phone.</p>
        </div>
      )}
    </div>
  );
}

const fieldLabel = 'block text-[11px] font-semibold text-muted uppercase mb-1';
const fieldInput = 'h-9 px-3 rounded-lg border border-border bg-background text-[13px]';

function DirectorateForm({ editing, onClose, onSuccess }: { editing: DirectorateExt | null; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!editing;
  const [active, setActive] = useState(editing ? editing.is_active === 1 : true);
  const form = useForm({
    resolver: zodResolver(dirSchema),
    defaultValues: {
      name: editing?.name ?? '',
      abbreviation: editing?.abbreviation ?? '',
      type: (editing?.type as 'directorate' | 'secretariat' | 'unit') ?? 'directorate',
      rooms: editing?.rooms ?? '',
      floor: editing?.floor ?? '',
      wing: editing?.wing ?? '',
    },
  });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof dirSchema>) =>
      isEdit
        ? api.put(`/admin/directorates/${editing!.id}`, { ...data, is_active: active ? 1 : 0 })
        : api.post('/admin/directorates', data),
    onSuccess,
  });

  return (
    <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="px-6 py-4 border-b border-border bg-background-warm/50 flex flex-wrap gap-3 items-end">
      <div>
        <label className={fieldLabel}>Name</label>
        <input {...form.register('name')} className={cn(fieldInput, 'w-56')} placeholder="Directorate name" />
      </div>
      <div>
        <label className={fieldLabel}>Code</label>
        <input {...form.register('abbreviation')} className={cn(fieldInput, 'w-24 uppercase')} placeholder="CMD" />
      </div>
      <div>
        <label className={fieldLabel}>Type</label>
        <select {...form.register('type')} className={fieldInput}>
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className={fieldLabel}>Rooms</label>
        <input {...form.register('rooms')} className={cn(fieldInput, 'w-28')} placeholder="19, 21" />
      </div>
      <div>
        <label className={fieldLabel}>Floor</label>
        <input {...form.register('floor')} className={cn(fieldInput, 'w-32')} placeholder="1st Floor" />
      </div>
      <div>
        <label className={fieldLabel}>Wing</label>
        <input {...form.register('wing')} className={cn(fieldInput, 'w-28')} placeholder="East" />
      </div>
      {isEdit && (
        <label className="flex items-center gap-2 h-9 text-[13px] text-foreground cursor-pointer select-none">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
          Active
        </label>
      )}
      <button type="submit" disabled={mutation.isPending} className="h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary-light disabled:opacity-50">
        {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
      </button>
      <button type="button" onClick={onClose} className="h-9 px-3 text-[13px] text-muted hover:text-foreground">Cancel</button>
      {mutation.isError && <p className="text-danger text-[12px] w-full">{mutation.error instanceof Error ? mutation.error.message : 'Failed'}</p>}
    </form>
  );
}

function OfficerForm({ editing, directorates, onClose, onSuccess }: { editing: OfficerExt | null; directorates: DirectorateExt[]; onClose: () => void; onSuccess: () => void }) {
  const isEdit = !!editing;
  const hasPin = !!editing?.has_override_pin;
  const [available, setAvailable] = useState(editing ? editing.is_available === 1 : true);
  const [overridePin, setOverridePin] = useState('');
  const [removeOverride, setRemoveOverride] = useState(false);
  const form = useForm({
    resolver: zodResolver(officerSchema),
    defaultValues: {
      name: editing?.name ?? '',
      title: editing?.title ?? '',
      directorate_id: editing?.directorate_id ?? '',
      email: editing?.email ?? '',
      phone: editing?.phone ?? '',
      office_number: editing?.office_number ?? '',
    },
  });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof officerSchema>) => {
      // override_pin: '' clears, digits set, omitted = keep existing.
      const override: { override_pin?: string } = {};
      if (removeOverride) override.override_pin = '';
      else if (overridePin.trim()) override.override_pin = overridePin.trim();
      return isEdit
        ? api.put(`/admin/directorates/officers/${editing!.id}`, { ...data, is_available: available ? 1 : 0, ...override })
        : api.post('/admin/directorates/officers', { ...data, ...override });
    },
    onSuccess,
  });

  return (
    <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="px-6 py-4 border-b border-border bg-background-warm/50 flex flex-wrap gap-3 items-end">
      <div>
        <label className={fieldLabel}>Name</label>
        <input {...form.register('name')} className={cn(fieldInput, 'w-44')} placeholder="Mr. Kwame Mensah" />
      </div>
      <div>
        <label className={fieldLabel}>Title</label>
        <input {...form.register('title')} className={cn(fieldInput, 'w-32')} placeholder="Director" />
      </div>
      <div>
        <label className={fieldLabel}>Directorate</label>
        <select {...form.register('directorate_id')} className={fieldInput}>
          <option value="">Select...</option>
          {directorates.map(d => <option key={d.id} value={d.id}>{d.abbreviation}</option>)}
        </select>
      </div>
      <div>
        <label className={fieldLabel}>Office</label>
        <input {...form.register('office_number')} className={cn(fieldInput, 'w-24')} placeholder="Room 19" />
      </div>
      <div>
        <label className={fieldLabel}>Email</label>
        <input {...form.register('email')} className={cn(fieldInput, 'w-52')} placeholder="k.mensah@ohcs.gov.gh" />
      </div>
      <div>
        <label className={fieldLabel}>Phone</label>
        <input {...form.register('phone')} className={cn(fieldInput, 'w-36')} placeholder="0241234567" />
      </div>
      <div>
        <label className={fieldLabel}>Override PIN{hasPin ? ' ✓' : ''}</label>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={overridePin}
          onChange={(e) => setOverridePin(e.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
          disabled={removeOverride}
          className={cn(fieldInput, 'w-32 font-mono tracking-widest disabled:opacity-50')}
          placeholder={hasPin ? 'change (4–8)' : 'set (4–8)'}
        />
      </div>
      {isEdit && hasPin && (
        <label className="flex items-center gap-2 h-9 text-[13px] text-foreground cursor-pointer select-none">
          <input type="checkbox" checked={removeOverride} onChange={(e) => { setRemoveOverride(e.target.checked); if (e.target.checked) setOverridePin(''); }} className="h-4 w-4 rounded border-border accent-danger" />
          Remove PIN
        </label>
      )}
      {isEdit && (
        <label className="flex items-center gap-2 h-9 text-[13px] text-foreground cursor-pointer select-none">
          <input type="checkbox" checked={available} onChange={(e) => setAvailable(e.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
          Available
        </label>
      )}
      <button type="submit" disabled={mutation.isPending} className="h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary-light disabled:opacity-50">
        {mutation.isPending ? 'Saving…' : isEdit ? 'Save' : 'Add'}
      </button>
      <button type="button" onClick={onClose} className="h-9 px-3 text-[13px] text-muted hover:text-foreground">Cancel</button>
      {mutation.isError && <p className="text-danger text-[12px] w-full">{mutation.error instanceof Error ? mutation.error.message : 'Failed'}</p>}
    </form>
  );
}
