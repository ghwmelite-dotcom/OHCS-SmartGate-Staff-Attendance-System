import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { DirectoratesTab } from '@/components/admin/DirectoratesTab';
import { BulkImportTab } from '@/components/admin/BulkImportTab';
import { AttendanceTab } from '@/components/admin/AttendanceTab';
import { NssTab } from '@/components/admin/NssTab';
import { AuditLogTab } from '@/components/admin/AuditLogTab';
import { AppointmentsTab } from '@/components/admin/AppointmentsTab';
import {
  Users,
  UserPlus,
  Pencil,
  Power,
  KeyRound,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { toast } from '@/stores/toast';

interface UserRecord {
  id: string;
  name: string;
  email: string;
  staff_id: string | null;
  phone: string | null;
  role: string;
  display_role?: string | null;
  grade: string | null;
  directorate_abbr: string | null;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
  user_type?: string | null;
}

const ROLES = [
  { value: 'superadmin', label: 'Super Admin', color: 'bg-secondary/10 text-secondary' },
  { value: 'admin', label: 'Admin', color: 'bg-accent/15 text-accent-warm' },
  // Display-tier pseudo-role: stored as role='admin' + display_role='client_service'.
  { value: 'client_service', label: 'Client Service', color: 'bg-service/10 text-service' },
  { value: 'receptionist', label: 'Receptionist', color: 'bg-primary/10 text-primary' },
  { value: 'it', label: 'IT Support', color: 'bg-info/10 text-info' },
  { value: 'director', label: 'Director', color: 'bg-accent/10 text-accent-warm' },
  { value: 'staff', label: 'Staff', color: 'bg-success/10 text-success' },
] as const;

type ReadinessLevel = 'ready' | 'partial' | 'inactive';

function getReadiness(user: UserRecord): ReadinessLevel {
  if (!user.is_active) return 'inactive';
  if (!user.phone || user.email.endsWith('@ohcs.internal')) return 'partial';
  return 'ready';
}

const READINESS_BADGE: Record<ReadinessLevel, { label: string; cls: string }> = {
  ready:    { label: 'Ready',    cls: 'bg-success/10 text-success' },
  partial:  { label: 'Partial',  cls: 'bg-accent/15 text-accent-warm' },
  inactive: { label: 'Inactive', cls: 'bg-border text-muted-foreground' },
};

const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.string().email('Invalid email').max(255),
  staff_id: z.string().min(1, 'Staff ID is required').max(20),
  pin: z.string().length(4, 'PIN must be 4 digits').regex(/^\d{4}$/, 'PIN must be 4 digits'),
  role: z.enum(['superadmin', 'admin', 'client_service', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  directorate_code: z.string().max(20).optional(),
});
type CreateUserForm = z.infer<typeof createUserSchema>;

const editUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().max(255),
  staff_id: z.string().min(1).max(20),
  role: z.enum(['superadmin', 'admin', 'client_service', 'receptionist', 'it', 'director', 'staff']),
  grade: z.string().max(100).optional(),
  phone: z.string().max(20).optional(),
  directorate_code: z.string().max(20).optional(),
  pin: z.string().length(4).regex(/^\d{4}$/).or(z.literal('')).optional(),
});
type EditUserForm = z.infer<typeof editUserSchema>;

// The display-tier pseudo-role maps to its access role at the API boundary:
// client_service ⇒ role='admin' + display_role='client_service'; any other
// selection clears the display label (NULL).
function toUserPayload<T extends { role: string }>(data: T) {
  const { role, ...rest } = data;
  return role === 'client_service'
    ? { ...rest, role: 'admin', display_role: 'client_service' }
    : { ...rest, role, display_role: null };
}

type AdminTab = 'users' | 'org' | 'attendance' | 'nss' | 'import' | 'audit' | 'appointments';

export function AdminPage() {
  const user = useAuthStore(s => s.user);
  const role = user?.role ?? '';
  const isAdmin = role === 'admin';
  const isSuperadmin = role === 'superadmin';

  // Tab visibility:
  // - superadmin: all tabs
  // - admin: NSS only (everything else hidden — they cannot manage system users)
  // - other roles: shouldn't reach this page (Sidebar gates the link), but render NSS as a safe default if they do
  const tabs = useMemo<{ value: AdminTab; label: string }[]>(() => {
    if (isSuperadmin) {
      return [
        { value: 'users', label: 'Users' },
        { value: 'org', label: 'Org Entities' },
        { value: 'attendance', label: 'Attendance' },
        { value: 'nss', label: 'NSS & Interns' },
        { value: 'import', label: 'Bulk Import' },
        { value: 'audit', label: 'Audit Log' },
        { value: 'appointments', label: 'Appointments' },
      ];
    }
    return [
      { value: 'nss', label: 'NSS & Interns' },
      { value: 'appointments', label: 'Appointments' },
    ];
  }, [isSuperadmin]);

  // Admin defaults to NSS; superadmin defaults to ?tab= or 'users'.
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialTab: AdminTab = (() => {
    const fromUrl = searchParams.get('tab') as AdminTab | null;
    const allowed = tabs.map(t => t.value);
    if (fromUrl && allowed.includes(fromUrl)) return fromUrl;
    if (isAdmin) return 'nss';
    return 'users';
  })();
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);

  // If the role can't see the chosen tab, snap to a permitted one
  useEffect(() => {
    const allowed = tabs.map(t => t.value);
    if (!allowed.includes(activeTab)) {
      setActiveTab(allowed[0] ?? 'nss');
    }
  }, [tabs, activeTab]);

  // Reflect tab in URL (replace, don't push, to keep history clean)
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    if (params.get('tab') !== activeTab) {
      params.set('tab', activeTab);
      setSearchParams(params, { replace: true });
    }
  }, [activeTab, searchParams, setSearchParams]);

  // Hard-block users who shouldn't be here at all (Sidebar already hides the
  // link, but a direct URL can still reach the route).
  useEffect(() => {
    if (!isSuperadmin && !isAdmin) {
      navigate('/', { replace: true });
    }
  }, [isSuperadmin, isAdmin, navigate]);

  if (!isSuperadmin && !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Administration
          </h1>
          <p className="text-[15px] text-muted mt-0.5">
            {isAdmin
              ? 'NSS personnel oversight'
              : 'Manage users, directorates, and officers'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl border border-border p-1 w-fit animate-fade-in-up stagger-1">
        {tabs.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={cn(
              'h-9 px-5 rounded-lg text-[14px] font-medium transition-all',
              activeTab === tab.value
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'users' && isSuperadmin && <UsersTab />}
      {activeTab === 'org' && isSuperadmin && <DirectoratesTab />}
      {activeTab === 'attendance' && isSuperadmin && <AttendanceTab />}
      {activeTab === 'nss' && <NssTab />}
      {activeTab === 'import' && isSuperadmin && <BulkImportTab />}
      {activeTab === 'audit' && isSuperadmin && <AuditLogTab />}
      {activeTab === 'appointments' && <AppointmentsTab />}
    </div>
  );
}


function UsersTab() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<UserRecord[]>('/users'),
  });

  const { data: unprovisionedData, refetch: refetchUnprovisioned } = useQuery({
    queryKey: ['unprovisioned-count'],
    queryFn: () => api.get<{ count: number }>('/users/unprovisioned-count'),
  });
  const unprovisionedCount = unprovisionedData?.data?.count ?? 0;

  const provisionMutation = useMutation({
    mutationFn: () =>
      api.post<{ provisioned: number; skipped: number; skipped_details: string[] }>(
        '/users/provision-from-officers', {}
      ),
    onSuccess: (res) => {
      const d = res.data;
      if (d) {
        if (d.provisioned > 0) {
          toast.success(`${d.provisioned} account${d.provisioned !== 1 ? 's' : ''} created`);
        } else {
          toast.success('All officers with staff IDs already have accounts');
        }
        if (d.skipped > 0) toast.error(`${d.skipped} skipped — check Bulk Import tab`);
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      refetchUnprovisioned();
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (user: UserRecord) =>
      user.is_active
        ? api.delete(`/users/${user.id}`)
        : api.put(`/users/${user.id}`, { is_active: 1 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const [pendingResetId, setPendingResetId] = useState<string | null>(null);

  const resetPinMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/users/${userId}/reset-pin`, {}),
    onSuccess: (_, userId) => {
      toast.success('PIN reset to default — staff will be prompted to change it on next login');
      setPendingResetId(null);
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => {
      toast.error('Failed to reset PIN');
      setPendingResetId(null);
    },
  });

  const [search, setSearch] = useState('');

  const users = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const filteredUsers = q
    ? users.filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.staff_id ?? '').toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        (u.directorate_abbr ?? '').toLowerCase().includes(q)
      )
    : users;

  return (
    <div className="space-y-6">
      {/* Header: stats + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4 text-[13px]">
          <span className="text-success font-semibold">
            {users.filter(u => getReadiness(u) === 'ready').length} ready
          </span>
          <span className="text-accent-warm font-semibold">
            {users.filter(u => getReadiness(u) === 'partial').length} partial
          </span>
          {unprovisionedCount > 0 && (
            <span className="text-muted font-semibold">{unprovisionedCount} no account</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {unprovisionedCount > 0 && (
            <button
              onClick={() => provisionMutation.mutate()}
              disabled={provisionMutation.isPending}
              className="inline-flex items-center gap-2 h-10 px-4 bg-surface border border-border text-[13px] font-semibold rounded-xl hover:border-primary/40 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4 text-primary" />
              {provisionMutation.isPending ? 'Provisioning…' : `Provision ${unprovisionedCount} Missing`}
            </button>
          )}
          <button
            onClick={() => { setShowCreate(true); setEditingUser(null); }}
            className="inline-flex items-center gap-2 h-11 px-5 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all shadow-lg shadow-primary/15 active:scale-[0.98]"
          >
            <UserPlus className="h-4.5 w-4.5" />
            Add User
          </button>
        </div>
      </div>

      {/* Create / Edit modal */}
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, staff ID, role or directorate…"
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-border bg-surface text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all placeholder:text-muted"
        />
        {q && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Users table */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up stagger-2">
        <div className="h-[2px]" style={{
          background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)',
        }} />

        <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Users className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              System Users
            </h2>
            <p className="text-[13px] text-muted">{users.length} user{users.length !== 1 ? 's' : ''} registered</p>
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center">
            <div className="h-5 w-5 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-muted">Loading users...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="p-10 text-center">
            <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-[15px] text-muted font-medium">No users yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Name</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Staff ID</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden md:table-cell">Grade</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">Phone</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Dir</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Role</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Readiness</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide hidden xl:table-cell">Last Login</th>
                  <th className="text-right px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredUsers.map((user) => {
                  const roleCfg = ROLES.find(r => r.value === (user.display_role ?? user.role));
                  return (
                    <tr key={user.id} className="hover:bg-background-warm/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-[13px] font-bold shrink-0">
                            {user.name.charAt(0)}
                          </div>
                          <span className="text-[15px] font-semibold text-foreground">{user.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[14px] font-mono font-medium text-foreground">{user.staff_id ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4 hidden md:table-cell">
                        <span className="text-[14px] text-muted">{user.grade ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4 hidden lg:table-cell">
                        <span className="text-[13px] font-mono text-muted">{user.phone ?? '—'}</span>
                      </td>
                      <td className="px-6 py-4">
                        {user.directorate_abbr ? (
                          <span className="inline-flex items-center h-6 px-2 text-[10px] font-bold bg-primary/8 text-primary rounded-lg">
                            {user.directorate_abbr}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          'inline-flex items-center h-7 px-3 text-[11px] font-bold rounded-lg uppercase tracking-wide',
                          roleCfg?.color ?? 'bg-border text-muted'
                        )}>
                          {roleCfg?.label ?? user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const r = getReadiness(user);
                          const cfg = READINESS_BADGE[r];
                          return (
                            <span className={cn(
                              'inline-flex items-center gap-1.5 h-6 px-2.5 text-[11px] font-bold rounded-lg uppercase tracking-wide',
                              cfg.cls
                            )}>
                              {cfg.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 hidden xl:table-cell">
                        <span className="text-[13px] text-muted">
                          {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setEditingUser(user)}
                            className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-primary hover:bg-primary/5 transition-all"
                            title="Edit user"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {user.staff_id && (
                            pendingResetId === user.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => resetPinMutation.mutate(user.id)}
                                  disabled={resetPinMutation.isPending}
                                  className="h-7 px-2 text-[11px] font-bold bg-secondary text-white rounded-lg disabled:opacity-50"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setPendingResetId(null)}
                                  className="h-7 px-2 text-[11px] font-medium text-muted hover:text-foreground rounded-lg border border-border"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setPendingResetId(user.id)}
                                className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-accent-warm hover:bg-accent/10 transition-all"
                                title="Reset PIN to default"
                              >
                                <KeyRound className="h-4 w-4" />
                              </button>
                            )
                          )}
                          <button
                            onClick={() => toggleActiveMutation.mutate(user)}
                            className={cn(
                              'h-8 w-8 rounded-lg flex items-center justify-center transition-all',
                              user.is_active
                                ? 'text-muted hover:text-secondary hover:bg-secondary/10'
                                : 'text-muted hover:text-success hover:bg-success/10'
                            )}
                            title={user.is_active ? 'Deactivate' : 'Reactivate'}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredUsers.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={9} className="px-6 py-10 text-center text-[14px] text-muted">
                      {q ? `No users match "${search}"` : 'No users yet'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {q && filteredUsers.length > 0 && (
              <div className="px-6 py-3 border-t border-border text-[12px] text-muted">
                Showing {filteredUsers.length} of {users.length} users
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---- Create User Modal ---- */

function CreateUserModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', staff_id: '', pin: '', role: 'staff', grade: '', phone: '', directorate_code: '' },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateUserForm) => api.post('/users', toUserPayload(data)),
    onSuccess,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Add New User</h3>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(data => mutation.mutate(data))} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Full Name" error={form.formState.errors.name?.message}>
              <input {...form.register('name')} className={inputCls} placeholder="Kwame Mensah" autoFocus />
            </FormField>
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <input {...form.register('email')} type="email" className={inputCls} placeholder="k.mensah@ohcs.gov.gh" />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Staff ID" error={form.formState.errors.staff_id?.message}>
              <input {...form.register('staff_id')} className={cn(inputCls, 'uppercase')} placeholder="12345" />
            </FormField>
            <FormField label="4-Digit PIN" error={form.formState.errors.pin?.message}>
              <input {...form.register('pin')} type="password" maxLength={4} className={cn(inputCls, 'text-center tracking-[0.3em] font-mono')} placeholder="****" inputMode="numeric" />
            </FormField>
            <FormField label="System Role" error={form.formState.errors.role?.message}>
              <select {...form.register('role')} className={inputCls}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Grade / Designation">
              <input {...form.register('grade')} className={inputCls} placeholder="e.g. Snr IT/IM Technician" />
            </FormField>
            <FormField label="Phone">
              <input {...form.register('phone')} type="tel" className={inputCls} placeholder="0241234567" inputMode="tel" />
            </FormField>
            <FormField label="Directorate Code">
              <input {...form.register('directorate_code')} className={cn(inputCls, 'uppercase')} placeholder="e.g. RSIMD" />
            </FormField>
          </div>

          {mutation.isError && (
            <p className="text-danger text-[13px] font-medium">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to create user'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
            >
              {mutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Edit User Modal ---- */

function EditUserModal({ user, onClose, onSuccess }: { user: UserRecord; onClose: () => void; onSuccess: () => void }) {
  const form = useForm<EditUserForm>({
    resolver: zodResolver(editUserSchema),
    defaultValues: {
      name: user.name,
      email: user.email,
      staff_id: user.staff_id ?? '',
      role: (user.display_role ?? user.role) as EditUserForm['role'],
      grade: user.grade ?? '',
      phone: user.phone ?? '',
      directorate_code: user.directorate_abbr ?? '',
      pin: '',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: EditUserForm) => {
      const payload: Record<string, unknown> = { ...toUserPayload(data) };
      if (!data.pin) delete payload.pin;
      return api.put(`/users/${user.id}`, payload);
    },
    onSuccess,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-surface rounded-2xl shadow-2xl border border-border w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)' }} />
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Pencil className="h-4 w-4 text-accent-warm" />
            </div>
            <h3 className="text-lg font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Edit User</h3>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-all">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(data => mutation.mutate(data))} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Full Name" error={form.formState.errors.name?.message}>
              <input {...form.register('name')} className={inputCls} autoFocus />
            </FormField>
            <FormField label="Email" error={form.formState.errors.email?.message}>
              <input {...form.register('email')} type="email" className={inputCls} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Staff ID" error={form.formState.errors.staff_id?.message}>
              <input {...form.register('staff_id')} className={cn(inputCls, 'uppercase')} />
            </FormField>
            <FormField label="New PIN (optional)" error={form.formState.errors.pin?.message}>
              <input {...form.register('pin')} type="password" maxLength={4} className={cn(inputCls, 'text-center tracking-[0.3em] font-mono')} placeholder="****" inputMode="numeric" />
            </FormField>
            <FormField label="System Role" error={form.formState.errors.role?.message}>
              <select {...form.register('role')} className={inputCls}>
                {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </FormField>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Grade / Designation">
              <input {...form.register('grade')} className={inputCls} placeholder="e.g. Snr IT/IM Technician" />
            </FormField>
            <FormField label="Phone">
              <input {...form.register('phone')} type="tel" className={inputCls} inputMode="tel" />
            </FormField>
            <FormField label="Directorate Code">
              <input {...form.register('directorate_code')} className={cn(inputCls, 'uppercase')} placeholder="e.g. RSIMD" />
            </FormField>
          </div>

          {mutation.isError && (
            <p className="text-danger text-[13px] font-medium">
              {mutation.error instanceof Error ? mutation.error.message : 'Failed to update user'}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="h-11 px-5 text-[14px] text-muted hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="h-11 px-6 bg-primary text-white text-[14px] font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-50 shadow-lg shadow-primary/15"
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---- Helpers ---- */

const inputCls = 'w-full h-11 px-3.5 rounded-xl border border-border bg-background text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all';

function FormField({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-foreground/70 uppercase tracking-wide mb-1.5">{label}</label>
      {children}
      {error && <p className="text-danger text-[12px] mt-1">{error}</p>}
    </div>
  );
}
