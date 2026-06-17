import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { toast } from '@/stores/toast';
import { cn } from '@/lib/utils';
import { ShieldCheck, Loader2 } from 'lucide-react';

interface Props {
  user: {
    id: string;
    role: string;
    user_type?: string | null;
  };
}

/**
 * Toggle that promotes/demotes a staff user between `staff` and `hr`.
 * Hidden when the viewer is not `superadmin`, or when the target user is NSS.
 */
export function UserRoleToggle({ user }: Props) {
  const viewer = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const isHr = user.role === 'hr';

  const mutation = useMutation({
    mutationFn: () =>
      api.put(`/users/${user.id}`, {
        role: isHr ? 'staff' : 'hr',
      }),
    onSuccess: () => {
      toast.success(isHr ? 'Demoted to Staff' : 'Promoted to HR');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Role update failed'),
  });

  // Visibility guards
  if (viewer?.role !== 'superadmin') return null;
  if (user.user_type === 'nss') return null;

  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4.5 w-4.5 text-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground">HR Access</p>
          <p className="text-[12px] text-muted mt-0.5">
            Grants the HR admin views (NSS register, attendance reports) plus
            visitor-management oversight. Toggle off to revert to plain staff.
          </p>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          aria-pressed={isHr}
          aria-label={isHr ? 'Demote to staff' : 'Promote to HR'}
          className={cn(
            'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 focus:ring-offset-surface',
            isHr ? 'bg-primary' : 'bg-border',
            mutation.isPending && 'opacity-60 cursor-wait',
          )}
        >
          <span
            className={cn(
              'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
              isHr ? 'translate-x-5' : 'translate-x-0.5',
            )}
          />
          {mutation.isPending && (
            <Loader2 className="absolute right-1 h-3 w-3 animate-spin text-white" />
          )}
        </button>
      </div>
    </div>
  );
}
