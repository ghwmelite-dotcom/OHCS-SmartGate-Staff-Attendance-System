import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, type Directorate, type Officer } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Building2, UserPlus, Pencil, Power, Plus, X } from 'lucide-react';

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
}

const dirSchema = z.object({
  name: z.string().min(1).max(200),
  abbreviation: z.string().min(1).max(20),
  type: z.enum(['directorate', 'secretariat', 'unit']),
  rooms: z.string().max(200).optional(),
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
  const [showAddDir, setShowAddDir] = useState(false);
  const [showAddOfficer, setShowAddOfficer] = useState(false);

  const { data: dirData } = useQuery({
    queryKey: ['directorates-admin'],
    queryFn: () => api.get<DirectorateExt[]>('/directorates'),
  });

  const { data: offData } = useQuery({
    queryKey: ['officers-admin'],
    queryFn: () => api.get<OfficerExt[]>('/officers'),
  });

  const directorates = dirData?.data ?? [];
  const officers = offData?.data ?? [];

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
          <button onClick={() => setShowAddDir(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Add Entity
          </button>
        </div>

        {showAddDir && <AddDirectorateForm onClose={() => setShowAddDir(false)} onSuccess={() => {
          setShowAddDir(false);
          queryClient.invalidateQueries({ queryKey: ['directorates-admin'] });
        }} />}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Code</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Type</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Rooms</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Reception</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {directorates.map(d => {
                const typeCfg = TYPES.find(t => t.value === d.type);
                return (
                  <tr key={d.id} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-6 py-3 text-[14px] font-mono font-semibold text-foreground">{d.abbreviation}</td>
                    <td className="px-6 py-3 text-[14px] text-foreground">{d.name}</td>
                    <td className="px-6 py-3">
                      <span className={cn('inline-flex items-center h-6 px-2.5 text-[10px] font-bold rounded-lg uppercase tracking-wide', typeCfg?.color)}>
                        {typeCfg?.label ?? d.type}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[13px] text-muted">{d.rooms ?? '—'}</td>
                    <td className="px-6 py-3">
                      <ReceptionOfficerCell
                        directorate={d}
                        officers={officers}
                        onSaved={() => queryClient.invalidateQueries({ queryKey: ['directorates-admin'] })}
                      />
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
          <button onClick={() => setShowAddOfficer(true)}
            className="inline-flex items-center gap-1.5 h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-sm">
            <Plus className="h-3.5 w-3.5" /> Add Officer
          </button>
        </div>

        {showAddOfficer && <AddOfficerForm
          directorates={directorates}
          onClose={() => setShowAddOfficer(false)}
          onSuccess={() => {
            setShowAddOfficer(false);
            queryClient.invalidateQueries({ queryKey: ['officers-admin'] });
          }}
        />}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Title</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Directorate</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Office</th>
                <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {officers.map(o => (
                <tr key={o.id} className="hover:bg-background-warm/50 transition-colors">
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReceptionOfficerCell({ directorate, officers, onSaved }: {
  directorate: DirectorateExt;
  officers: OfficerExt[];
  onSaved: () => void;
}) {
  const mutation = useMutation({
    mutationFn: (reception_officer_id: string) =>
      api.put(`/admin/directorates/${directorate.id}`, { reception_officer_id }),
    onSuccess: onSaved,
  });
  const own = officers.filter((o) => o.directorate_id === directorate.id);
  return (
    <select
      value={directorate.reception_officer_id ?? ''}
      onChange={(e) => mutation.mutate(e.target.value)}
      disabled={mutation.isPending}
      className="h-8 px-2 rounded-lg border border-border bg-background text-[13px] disabled:opacity-50"
    >
      <option value="">— none —</option>
      {own.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function AddDirectorateForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const form = useForm({ resolver: zodResolver(dirSchema), defaultValues: { name: '', abbreviation: '', type: 'directorate' as const, rooms: '' } });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof dirSchema>) => api.post('/admin/directorates', data),
    onSuccess,
  });

  return (
    <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="px-6 py-4 border-b border-border bg-background-warm/50 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Name</label>
        <input {...form.register('name')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-56" placeholder="Directorate name" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Code</label>
        <input {...form.register('abbreviation')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-24 uppercase" placeholder="CMD" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Type</label>
        <select {...form.register('type')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px]">
          {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Rooms</label>
        <input {...form.register('rooms')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-32" placeholder="19, 21" />
      </div>
      <button type="submit" disabled={mutation.isPending} className="h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary-light disabled:opacity-50">
        {mutation.isPending ? 'Adding...' : 'Add'}
      </button>
      <button type="button" onClick={onClose} className="h-9 px-3 text-[13px] text-muted hover:text-foreground">Cancel</button>
      {mutation.isError && <p className="text-danger text-[12px] w-full">{mutation.error instanceof Error ? mutation.error.message : 'Failed'}</p>}
    </form>
  );
}

function AddOfficerForm({ directorates, onClose, onSuccess }: { directorates: DirectorateExt[]; onClose: () => void; onSuccess: () => void }) {
  const form = useForm({ resolver: zodResolver(officerSchema), defaultValues: { name: '', title: '', directorate_id: '', email: '', phone: '', office_number: '' } });
  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof officerSchema>) => api.post('/admin/directorates/officers', data),
    onSuccess,
  });

  return (
    <form onSubmit={form.handleSubmit(d => mutation.mutate(d))} className="px-6 py-4 border-b border-border bg-background-warm/50 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Name</label>
        <input {...form.register('name')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-44" placeholder="Mr. Kwame Mensah" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Title</label>
        <input {...form.register('title')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-32" placeholder="Director" />
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Directorate</label>
        <select {...form.register('directorate_id')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px]">
          <option value="">Select...</option>
          {directorates.map(d => <option key={d.id} value={d.id}>{d.abbreviation}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-semibold text-muted uppercase mb-1">Office</label>
        <input {...form.register('office_number')} className="h-9 px-3 rounded-lg border border-border bg-background text-[13px] w-24" placeholder="Room 19" />
      </div>
      <button type="submit" disabled={mutation.isPending} className="h-9 px-4 bg-primary text-white text-[13px] font-semibold rounded-lg hover:bg-primary-light disabled:opacity-50">
        {mutation.isPending ? 'Adding...' : 'Add'}
      </button>
      <button type="button" onClick={onClose} className="h-9 px-3 text-[13px] text-muted hover:text-foreground">Cancel</button>
      {mutation.isError && <p className="text-danger text-[12px] w-full">{mutation.error instanceof Error ? mutation.error.message : 'Failed'}</p>}
    </form>
  );
}
