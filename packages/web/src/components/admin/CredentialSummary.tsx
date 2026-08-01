import { Download, KeyRound } from 'lucide-react';

/**
 * Credential summary shown ONCE after accounts are provisioned with random
 * initial PINs (bulk NSS/intern/officer import, provision-from-officers). The
 * server stores only hashes — this card is the admin's single chance to
 * download or record the PINs.
 */

export type CredentialType = 'nss' | 'interns' | 'officers';

export type PinRecord = {
  row?: number;
  name: string;
  email: string | null;
  identifier: string;
  initial_pin: string;
};

const TYPE_META: Record<CredentialType, { identifierHeader: string; identifierCsv: string; unit: (n: number) => string }> = {
  nss: {
    identifierHeader: 'NSS Number',
    identifierCsv: 'nss_number',
    unit: (n) => `${n} NSS personnel`,
  },
  interns: {
    identifierHeader: 'Intern Code',
    identifierCsv: 'intern_code',
    unit: (n) => `${n} intern${n !== 1 ? 's' : ''}`,
  },
  officers: {
    identifierHeader: 'Staff ID',
    identifierCsv: 'staff_id',
    unit: (n) => `${n} staff account${n !== 1 ? 's' : ''}`,
  },
};

export function downloadCredentials(pins: PinRecord[], type: CredentialType) {
  const meta = TYPE_META[type];
  const header = ['name', 'email', meta.identifierCsv, 'initial_pin'].join(',');
  const rows = pins.map(p => [
    `"${p.name.replace(/"/g, '""')}"`,
    p.email ?? '',
    p.identifier,
    p.initial_pin,
  ].join(','));
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smartgate-${type}-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function CredentialSummary({ type, pins }: { type: CredentialType; pins: PinRecord[] }) {
  const meta = TYPE_META[type];
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
      <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #22c55e, #4ade80 50%, #22c55e)' }} />
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <KeyRound className="h-5 w-5 text-success" />
          <div>
            <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
              Credential Summary — {meta.unit(pins.length)}
            </h3>
            <p className="text-[13px] text-danger font-medium">Download now — initial PINs cannot be retrieved again</p>
          </div>
        </div>
        <button
          onClick={() => downloadCredentials(pins, type)}
          className="inline-flex items-center gap-2 h-9 px-4 bg-success text-white text-[13px] font-semibold rounded-xl hover:opacity-90 shadow-sm transition-all"
        >
          <Download className="h-4 w-4" />
          Download CSV
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-background/50">
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">#</th>
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Name</th>
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Email</th>
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">{meta.identifierHeader}</th>
              <th className="text-left px-5 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-wide">Initial PIN</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pins.map((p, i) => (
              <tr key={p.row ?? i} className="hover:bg-background-warm/50 transition-colors">
                <td className="px-5 py-2.5 text-[13px] text-muted font-mono">{p.row ?? i + 1}</td>
                <td className="px-5 py-2.5 text-[14px] text-foreground font-medium">{p.name}</td>
                <td className="px-5 py-2.5 text-[13px] text-muted">{p.email ?? '—'}</td>
                <td className="px-5 py-2.5 text-[13px] font-mono text-foreground">{p.identifier}</td>
                <td className="px-5 py-2.5">
                  <span className="font-mono text-[15px] font-bold text-primary tracking-widest">{p.initial_pin}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
