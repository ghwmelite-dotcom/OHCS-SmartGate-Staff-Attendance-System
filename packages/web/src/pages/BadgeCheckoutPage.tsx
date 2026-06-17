import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { apiOrQueue } from '@/lib/offlineQueue';
import { CheckCircle2, LogOut, Loader2 } from 'lucide-react';
import { QrScanner } from '@/components/QrScanner';

interface BadgeData {
  badge_code: string;
  status: string;
  visitor_name: string;
  organisation: string | null;
  host_name: string | null;
  directorate_abbr: string | null;
}

export function BadgeCheckoutPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [checkedOut, setCheckedOut] = useState(false);
  const [showScanner, setShowScanner] = useState(!code);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['badge', code],
    queryFn: () => api.get<BadgeData>(`/badges/${code}`),
    enabled: !!code,
  });

  const checkOutMutation = useMutation({
    mutationFn: async () => {
      const visits = await api.get<Array<{ id: string }>>(`/visits?badge_code=${code}&limit=1`);
      const visitId = visits.data?.[0]?.id;
      if (!visitId) throw new Error('Visit not found');
      return await apiOrQueue<unknown>('visit-queue', `/visits/${visitId}/check-out`, {});
    },
    onSuccess: () => {
      setCheckedOut(true);
      queryClient.invalidateQueries({ queryKey: ['visits'] });
    },
  });

  const badge = data?.data;

  if (!code && showScanner) {
    return (
      <div className="max-w-sm mx-auto py-12">
        <QrScanner
          onScan={(scanned) => { setShowScanner(false); navigate(`/checkout/${scanned}`); }}
          onCancel={() => navigate('/')}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-sm mx-auto text-center py-12">
        <Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" />
      </div>
    );
  }

  if (isError || !badge) {
    return (
      <div className="max-w-sm mx-auto text-center py-12 space-y-3">
        <p className="text-sm text-muted">Badge not found</p>
        <button onClick={() => navigate('/')} className="text-sm text-primary hover:underline">
          Go to Dashboard
        </button>
      </div>
    );
  }

  if (checkedOut || badge.status !== 'checked_in') {
    return (
      <div className="max-w-sm mx-auto text-center py-12 space-y-4">
        <div className="w-14 h-14 bg-success/10 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-7 w-7 text-success" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          {checkedOut ? 'Visitor Checked Out' : 'Visit Already Ended'}
        </h2>
        <p className="text-sm text-muted">{badge.visitor_name} — {badge.badge_code}</p>
        <button onClick={() => navigate('/')} className="h-10 px-5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors">
          Go to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto text-center py-12 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">Check Out Visitor?</h2>
      <div className="bg-surface rounded-xl border border-border p-4 space-y-1">
        <p className="text-base font-medium text-foreground">{badge.visitor_name}</p>
        {badge.organisation && <p className="text-sm text-muted">{badge.organisation}</p>}
        <p className="text-xs text-muted">
          {badge.host_name && `Host: ${badge.host_name}`}
          {badge.directorate_abbr && ` \u2022 ${badge.directorate_abbr}`}
        </p>
        <p className="text-xs font-mono text-accent mt-2">{badge.badge_code}</p>
      </div>
      <button
        onClick={() => checkOutMutation.mutate()}
        disabled={checkOutMutation.isPending}
        className="h-10 px-5 bg-danger text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all disabled:opacity-50 inline-flex items-center gap-2"
      >
        <LogOut className="h-4 w-4" />
        {checkOutMutation.isPending ? 'Checking out...' : 'Confirm Check Out'}
      </button>
    </div>
  );
}
