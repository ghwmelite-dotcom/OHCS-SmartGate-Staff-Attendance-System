import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/auth';
import { DOC_SECTIONS, DOCS_LAST_UPDATED, type DocSection, type DocStatus } from '@/docs/content';
import { cn } from '@/lib/utils';
import {
  Layers, Fingerprint, ShieldCheck, MonitorSmartphone, Users, Send, Calendar,
  ShieldAlert, KeyRound, Settings, Search, BookOpen, BookMarked,
} from 'lucide-react';

/* Superadmin-only system documentation — renders docs/content.ts.
   The maintenance rule lives in AGENTS.md and in this page's footer. */

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  layers: Layers,
  fingerprint: Fingerprint,
  'shield-check': ShieldCheck,
  monitor: MonitorSmartphone,
  users: Users,
  send: Send,
  calendar: Calendar,
  'shield-alert': ShieldAlert,
  key: KeyRound,
  settings: Settings,
};

const STATUS_META: Record<DocStatus, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-success/10 text-success' },
  shadow: { label: 'Shadow', cls: 'bg-accent/15 text-accent-warm' },
  design: { label: 'Design', cls: 'bg-border/70 text-muted' },
};

export function DocsPage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [activeSection, setActiveSection] = useState<string>(DOC_SECTIONS[0]?.id ?? '');

  // Hard gate — same posture as AdminPage: the nav never shows the link, and a
  // direct URL visit bounces non-superadmins back to the dashboard.
  useEffect(() => {
    if (user && user.role !== 'superadmin') navigate('/', { replace: true });
  }, [user, navigate]);
  if (!user || user.role !== 'superadmin') return null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return DOC_SECTIONS;
    return DOC_SECTIONS
      .map((s) => ({
        ...s,
        features: s.features.filter((f) =>
          [f.name, f.summary, ...(f.details ?? [])].join(' ').toLowerCase().includes(q)
        ),
      }))
      .filter((s) => s.features.length > 0);
  }, [query]);

  const featureCount = useMemo(() => DOC_SECTIONS.reduce((n, s) => n + s.features.length, 0), []);
  const matchCount = useMemo(() => filtered.reduce((n, s) => n + s.features.length, 0), [filtered]);

  function scrollTo(id: string) {
    setActiveSection(id);
    document.getElementById(`docs-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-8">
      {/* ---- HERO ---- */}
      <div
        className="relative overflow-hidden rounded-3xl border border-border px-7 py-9 animate-fade-in-up"
        style={{ background: 'linear-gradient(135deg, #1A4D2E 0%, #0F2E1B 55%, #071A0F 100%)' }}
      >
        {/* kente texture + gold top rule */}
        <div className="absolute inset-0 opacity-[0.05]" style={{
          backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 14px),
            repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 14px)`,
        }} />
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{
          background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-accent">
            <BookMarked className="h-4 w-4" />
            <span className="text-[11px] font-semibold tracking-[0.25em] uppercase">Superadmin Library</span>
          </div>
          <h1 className="text-[34px] font-bold text-white mt-2 tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            System Documentation
          </h1>
          <p className="text-[14px] text-white/60 mt-1.5 max-w-xl">
            Everything the SmartGate VMS and Staff Attendance systems comprise — maintained as code, updated with every shipped feature.
          </p>

          <div className="flex flex-wrap items-center gap-2 mt-5">
            <span className="text-[12px] font-semibold text-white/80 bg-white/10 rounded-full px-3 py-1">{DOC_SECTIONS.length} sections</span>
            <span className="text-[12px] font-semibold text-white/80 bg-white/10 rounded-full px-3 py-1">{featureCount} features</span>
            <span className="text-[12px] font-semibold text-accent bg-accent/15 rounded-full px-3 py-1">Updated {DOCS_LAST_UPDATED}</span>
          </div>

          {/* Search */}
          <div className="relative mt-6 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search features, flags, endpoints…"
              className="w-full h-11 pl-11 pr-4 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/35 text-[14px] focus:outline-none focus:border-accent/50 focus:bg-white/15 transition-all"
            />
          </div>
        </div>
      </div>

      {/* ---- SECTION PILL NAV ---- */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/85 backdrop-blur-md animate-fade-in-up stagger-1">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {filtered.map((s) => {
            const Icon = ICONS[s.icon] ?? BookOpen;
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                onClick={() => scrollTo(s.id)}
                className={cn(
                  'shrink-0 inline-flex items-center gap-2 h-9 px-3.5 rounded-full border text-[13px] font-semibold transition-all',
                  active
                    ? 'text-white border-transparent shadow-md'
                    : 'bg-surface text-muted border-border hover:text-foreground hover:border-border-strong',
                )}
                style={active ? { background: s.color } : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.title}
              </button>
            );
          })}
        </div>
      </div>

      {query && (
        <p className="text-[13px] text-muted animate-fade-in-up">
          {matchCount} feature{matchCount === 1 ? '' : 's'} matching “{query}”
        </p>
      )}

      {/* ---- SECTIONS ---- */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 animate-fade-in-up">
          <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-[16px] font-semibold text-foreground">Nothing matches “{query}”</p>
          <p className="text-[13px] text-muted mt-1">Try a feature name, a flag like presence_qr_mode, or an endpoint.</p>
        </div>
      ) : (
        filtered.map((section, idx) => (
          <SectionBlock
            key={section.id}
            section={section}
            stagger={Math.min(idx + 2, 5)}
            onVisible={() => setActiveSection(section.id)}
          />
        ))
      )}

      {/* ---- MAINTENANCE RULE FOOTER ---- */}
      <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5 flex items-start gap-4 animate-fade-in-up">
        <div className="w-10 h-10 rounded-xl bg-accent/15 text-accent-warm flex items-center justify-center shrink-0">
          <BookMarked className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>The documentation rule</h3>
          <p className="text-[13px] text-muted mt-1 leading-relaxed">
            This page is a maintained artifact, not a snapshot. Every shipped feature adds or updates its entry in{' '}
            <code className="text-[12px] font-mono bg-surface border border-border rounded px-1.5 py-0.5">packages/web/src/docs/content.ts</code>{' '}
            in the same commit, with the correct status badge — <span className="font-semibold text-success">Live</span>,{' '}
            <span className="font-semibold text-accent-warm">Shadow</span>, or{' '}
            <span className="font-semibold text-muted">Design</span>. The AGENTS.md feature-state table is the internal mirror of this page.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---- Section ---- */

function SectionBlock({ section, stagger, onVisible }: {
  section: DocSection;
  stagger: number;
  onVisible: () => void;
}) {
  const Icon = ICONS[section.icon] ?? BookOpen;

  // Light scroll-spy: mark the pill active when the section crosses mid-viewport.
  useEffect(() => {
    const el = document.getElementById(`docs-${section.id}`);
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) onVisible(); },
      { rootMargin: '-30% 0px -60% 0px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [section.id, onVisible]);

  return (
    <section id={`docs-${section.id}`} className={cn('scroll-mt-24 animate-fade-in-up', `stagger-${stagger}`)}>
      <div className="flex items-center gap-3.5 mb-4">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
          style={{ background: `${section.color}1A`, color: section.color }}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[20px] font-bold text-foreground leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {section.title}
          </h2>
          <p className="text-[13px] text-muted truncate">{section.tagline}</p>
        </div>
        <div className="flex-1 h-[2px] rounded-full ml-2" style={{ background: `linear-gradient(90deg, ${section.color}55, transparent)` }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {section.features.map((f) => (
          <FeatureCard key={f.name} feature={f} color={section.color} />
        ))}
      </div>
    </section>
  );
}

/* ---- Feature card ---- */

function FeatureCard({ feature, color }: { feature: DocSection['features'][number]; color: string }) {
  const meta = STATUS_META[feature.status];
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-bold text-foreground leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
          {feature.name}
        </h3>
        <span className={cn('shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full', meta.cls)}>
          {meta.label}
        </span>
      </div>
      <p className="text-[13px] text-muted mt-2 leading-relaxed">{feature.summary}</p>
      {feature.details && feature.details.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {feature.details.map((d) => (
            <li key={d} className="flex items-start gap-2.5 text-[12px] text-muted leading-relaxed">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
              {d}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
