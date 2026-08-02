import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorStatus } from '@/lib/api';
import { AlertTriangle, Check } from 'lucide-react';
import { AbsenceNoticeModal } from './AbsenceNoticeModal';

type Reason = 'sick' | 'family_emergency' | 'transport' | 'other';

interface Notice {
  id: string;
  reason: Reason;
  note: string | null;
  notice_date: string;
  expected_return_date: string | null;
}

const REASON_LABELS: Record<Reason, string> = {
  sick: '🤒 Sick',
  family_emergency: '👨‍👩‍👧 Family emergency',
  transport: '🚗 Transport',
  other: '📝 Other',
};

export function AbsenceNoticeButton() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { data } = useQuery({
    queryKey: ['absence-notice-today'],
    queryFn: () => api.get<Notice | null>('/attendance/absence-notice/today'),
    staleTime: 60_000,
  });

  const unreport = () => queryClient.invalidateQueries({ queryKey: ['absence-notice-today'] });

  const withdraw = useMutation({
    mutationFn: () => api.del('/attendance/absence-notice/today'),
    onSuccess: unreport,
    onError: (err) => {
      // 404 = the notice is already gone (e.g. withdrawn from another device);
      // the end state is the same, so just refresh.
      if (apiErrorStatus(err) === 404) unreport();
    },
  });

  const notice = data?.data ?? null;

  if (notice) {
    if (confirming) {
      return (
        <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-[12px] font-medium animate-fade-in-up">
          <span className="text-muted-foreground">Withdraw notice? You can then clock in normally.</span>
          <button
            type="button"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
            className="px-2.5 py-1 rounded-md bg-red-600 text-white font-semibold hover:brightness-110 disabled:opacity-50"
          >
            {withdraw.isPending ? 'Withdrawing…' : 'Withdraw'}
          </button>
          <button
            type="button"
            disabled={withdraw.isPending}
            onClick={() => setConfirming(false)}
            className="px-2.5 py-1 rounded-md border border-border text-muted-foreground font-semibold hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface border border-border text-muted-foreground text-[12px] font-medium">
        <Check className="h-3.5 w-3.5 text-success" />
        Reported absence today · {REASON_LABELS[notice.reason]}
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="ml-1 text-[11px] font-semibold text-red-600 hover:underline"
        >
          Withdraw
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-surface text-muted-foreground hover:text-foreground hover:border-muted text-[13px] font-semibold transition-colors shadow-sm"
      >
        <AlertTriangle className="h-4 w-4" />
        🏠 Can't make it today?
      </button>
      {showModal && <AbsenceNoticeModal onClose={() => setShowModal(false)} />}
    </>
  );
}
