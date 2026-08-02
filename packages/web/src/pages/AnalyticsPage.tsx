import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AccessDenied } from '@/components/AccessDenied';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import {
  Users, Building2, Clock, TrendingUp, Flame, BarChart3,
} from 'lucide-react';

interface TodayData {
  total_today: number;
  in_building: number;
  checked_out: number;
  avg_duration_minutes: number;
  peak_hour: number | null;
  busiest_directorate: { abbreviation: string; count: number } | null;
  by_directorate: Array<{ abbreviation: string; name: string; count: number }>;
}

interface TrendsData {
  daily_volumes: Array<{ date: string; count: number }>;
  by_day_of_week: Array<{ day: number; label: string; avg_count: number }>;
  by_hour: Array<{ hour: number; avg_count: number }>;
  by_category: Array<{ category: string; label: string; count: number }>;
}

interface TopVisitor {
  first_name: string;
  last_name: string;
  organisation: string | null;
  visit_count: number;
  last_visit_at: string;
}

const PERIOD_OPTIONS = [
  { value: 7, label: '7 Days' },
  { value: 30, label: '30 Days' },
  { value: 90, label: '90 Days' },
];

const CHART_COLORS = ['#1A4D2E', '#D4A017', '#8B1A1A', '#1A4D8B', '#2A9D8F', '#9A1B1B', '#6B6352', '#C4920F', '#256B3E', '#A62828'];

export function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data: todayData, error: todayError } = useQuery({
    queryKey: ['analytics', 'today'],
    queryFn: () => api.get<TodayData>('/analytics/today'),
  });

  const { data: trendsData, error: trendsError } = useQuery({
    queryKey: ['analytics', 'trends', days],
    queryFn: () => api.get<TrendsData>(`/analytics/trends?days=${days}`),
  });

  const { data: topData, error: topError } = useQuery({
    queryKey: ['analytics', 'top-visitors', days],
    queryFn: () => api.get<TopVisitor[]>(`/analytics/top-visitors?days=${days}&limit=10`),
  });

  // Role-gated module: a 403 (direct URL visit by a role the nav hides)
  // renders an explicit no-access state instead of zeros and empty charts.
  const forbidden = [todayError, trendsError, topError].some(
    (e) => e instanceof ApiError && e.status === 403
  );

  const today = todayData?.data;
  const trends = trendsData?.data;
  const topVisitors = topData?.data ?? [];

  const formatHour = (h: number) => {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  };

  if (forbidden) {
    return (
      <div className="space-y-6">
        <div className="animate-fade-in-up">
          <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
            Analytics
          </h1>
          <p className="text-[15px] text-muted mt-0.5">Visitor insights and trends</p>
        </div>
        <AccessDenied module="Analytics" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="animate-fade-in-up">
        <h1 className="text-[28px] font-bold text-foreground tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>
          Analytics
        </h1>
        <p className="text-[15px] text-muted mt-0.5">Visitor insights and trends</p>
      </div>

      {/* Today's snapshot */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 animate-fade-in-up stagger-1">
        <MiniStat icon={<Users className="h-4 w-4" />} label="Total Today" value={today?.total_today ?? 0} color="primary" />
        <MiniStat icon={<Users className="h-4 w-4" />} label="In Building" value={today?.in_building ?? 0} color="accent" />
        <MiniStat icon={<TrendingUp className="h-4 w-4" />} label="Checked Out" value={today?.checked_out ?? 0} color="success" />
        <MiniStat icon={<Clock className="h-4 w-4" />} label="Avg Duration" value={today?.avg_duration_minutes ? `${today.avg_duration_minutes}m` : '--'} color="muted" />
        <MiniStat icon={<Flame className="h-4 w-4" />} label="Peak Hour" value={today?.peak_hour != null ? formatHour(today.peak_hour) : '--'} color="secondary" />
        <MiniStat icon={<Building2 className="h-4 w-4" />} label="Busiest" value={today?.busiest_directorate?.abbreviation ?? '--'} color="info" />
      </div>

      {/* Today's directorate breakdown */}
      {today?.by_directorate && today.by_directorate.length > 0 && (
        <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 animate-fade-in-up stagger-2">
          <h3 className="text-[15px] font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>Visits by Directorate — Today</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={today.by_directorate} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8DFC9" />
              <XAxis type="number" tick={{ fontSize: 12, fill: '#6B6352' }} />
              <YAxis type="category" dataKey="abbreviation" tick={{ fontSize: 13, fill: '#1C1810', fontWeight: 600 }} width={55} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E8DFC9', fontFamily: 'DM Sans' }} />
              <Bar dataKey="count" fill="#1A4D2E" radius={[0, 6, 6, 0]} barSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Period selector */}
      <div className="flex items-center gap-2 animate-fade-in-up stagger-3">
        <BarChart3 className="h-4 w-4 text-muted" />
        <span className="text-[14px] font-semibold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>Trends</span>
        <div className="flex items-center gap-1 ml-3 bg-surface rounded-xl border border-border p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={cn(
                'h-8 px-4 rounded-lg text-[13px] font-medium transition-all',
                days === opt.value
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted hover:text-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Daily volume */}
        <ChartCard title="Daily Visit Volume">
          {trends?.daily_volumes && trends.daily_volumes.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trends.daily_volumes}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFC9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B6352' }}
                  tickFormatter={(d: string) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} />
                <YAxis tick={{ fontSize: 12, fill: '#6B6352' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E8DFC9' }}
                  labelFormatter={(d) => new Date(String(d)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} />
                <Line type="monotone" dataKey="count" stroke="#1A4D2E" strokeWidth={2.5} dot={{ fill: '#1A4D2E', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* By day of week */}
        <ChartCard title="Average by Day of Week">
          {trends?.by_day_of_week && trends.by_day_of_week.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trends.by_day_of_week}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFC9" />
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#6B6352' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6B6352' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E8DFC9' }} />
                <Bar dataKey="avg_count" fill="#D4A017" radius={[6, 6, 0, 0]} barSize={32} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* By hour */}
        <ChartCard title="Average by Hour of Day">
          {trends?.by_hour && trends.by_hour.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={trends.by_hour}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E8DFC9" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#6B6352' }} tickFormatter={formatHour} />
                <YAxis tick={{ fontSize: 12, fill: '#6B6352' }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E8DFC9' }}
                  labelFormatter={(h) => formatHour(Number(h))} />
                <Bar dataKey="avg_count" fill="#1A4D2E" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>

        {/* Purpose categories */}
        <ChartCard title="Visit Purpose Breakdown">
          {trends?.by_category && trends.by_category.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={trends.by_category} dataKey="count" nameKey="label" cx="50%" cy="50%"
                  outerRadius={90} innerRadius={45} paddingAngle={2} label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  } labelLine={{ stroke: '#9C9280' }}
                  style={{ fontSize: 11 }}>
                  {trends.by_category.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #E8DFC9' }} />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart />}
        </ChartCard>
      </div>

      {/* Top visitors */}
      <div className="bg-surface rounded-2xl border border-border shadow-sm overflow-hidden animate-fade-in-up">
        <div className="h-[2px]" style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E 50%, #D4A017)' }} />
        <div className="px-6 py-4 border-b border-border">
          <h3 className="text-[15px] font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>
            Top 10 Frequent Visitors — Last {days} Days
          </h3>
        </div>
        {topVisitors.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-muted">No visitor data for this period</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-background/50">
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">#</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Visitor</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Organisation</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Visits</th>
                  <th className="text-left px-6 py-3 text-[12px] font-semibold text-muted uppercase tracking-wide">Last Visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topVisitors.map((v, i) => (
                  <tr key={i} className="hover:bg-background-warm/50 transition-colors">
                    <td className="px-6 py-3 text-[14px] text-muted font-mono">{i + 1}</td>
                    <td className="px-6 py-3 text-[15px] font-semibold text-foreground">{v.first_name} {v.last_name}</td>
                    <td className="px-6 py-3 text-[14px] text-muted">{v.organisation ?? '—'}</td>
                    <td className="px-6 py-3">
                      <span className="inline-flex items-center h-7 px-3 text-[12px] font-bold bg-primary/10 text-primary rounded-lg">
                        {v.visit_count}
                      </span>
                    </td>
                    <td className="px-6 py-3 text-[13px] text-muted">
                      {new Date(v.last_visit_at).toLocaleDateString('en-GB')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, color }: {
  icon: React.ReactNode; label: string; value: string | number;
  color: 'primary' | 'accent' | 'success' | 'muted' | 'secondary' | 'info';
}) {
  const colors = {
    primary: 'bg-primary/8 text-primary', accent: 'bg-accent/10 text-accent-warm',
    success: 'bg-success/8 text-success', muted: 'bg-foreground/5 text-foreground',
    secondary: 'bg-secondary/8 text-secondary', info: 'bg-info/8 text-info',
  };
  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-4 card-lift">
      <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center mb-2', colors[color])}>
        {icon}
      </div>
      <p className="text-xl font-bold text-foreground" style={{ fontFamily: 'var(--font-display)' }}>{value}</p>
      <p className="text-[12px] text-muted font-medium mt-0.5">{label}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl border border-border shadow-sm p-5 animate-fade-in-up">
      <h3 className="text-[14px] font-bold text-foreground mb-4" style={{ fontFamily: 'var(--font-display)' }}>{title}</h3>
      {children}
    </div>
  );
}

function EmptyChart() {
  return <div className="h-[240px] flex items-center justify-center text-[14px] text-muted">No data for this period</div>;
}
