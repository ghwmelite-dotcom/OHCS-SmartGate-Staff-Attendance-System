import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CheckInPage } from './pages/CheckInPage';
import { VisitorsPage } from './pages/VisitorsPage';
import { VisitorDetailPage } from './pages/VisitorDetailPage';
import { LinkTelegramPage } from './pages/LinkTelegramPage';
import { BadgeCheckoutPage } from './pages/BadgeCheckoutPage';
import { KioskPage } from './pages/KioskPage';
import { AdminPage } from './pages/AdminPage';
import { VisitLogPage } from './pages/VisitLogPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { ReportsPage } from './pages/ReportsPage';
import { AppLayout } from './components/layout/AppLayout';
import { useAuthStore } from './stores/auth';
import { OfflineBanner } from './components/OfflineBanner';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const { checkSession, isLoading } = useAuthStore();

  useEffect(() => { checkSession(); }, [checkSession]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center overflow-hidden relative" style={{
        background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)',
      }}>
        {/* Kente pattern */}
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: `repeating-linear-gradient(45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px),
            repeating-linear-gradient(-45deg, #D4A017 0px, #D4A017 1px, transparent 1px, transparent 16px)`,
        }} />

        {/* Animated glow rings behind logo */}
        <div className="relative flex items-center justify-center" style={{ width: 280, height: 280 }}>
          <div className="absolute inset-0 rounded-full" style={{
            border: '2px solid rgba(212, 160, 23, 0.1)',
            animation: 'splash-ring 2.5s ease-out infinite',
          }} />
          <div className="absolute rounded-full" style={{
            inset: 30,
            border: '2px solid rgba(212, 160, 23, 0.15)',
            animation: 'splash-ring 2.5s ease-out 0.5s infinite',
          }} />
          <div className="absolute rounded-full" style={{
            inset: 60,
            border: '2px solid rgba(212, 160, 23, 0.2)',
            animation: 'splash-ring 2.5s ease-out 1s infinite',
          }} />

          {/* Logo */}
          <div className="relative w-36 h-36 rounded-3xl overflow-hidden shadow-2xl" style={{
            boxShadow: '0 0 60px rgba(212, 160, 23, 0.15), 0 20px 60px rgba(0,0,0,0.4)',
            animation: 'logo-entrance 0.8s ease-out both',
          }}>
            <img src="/ohcs-logo.jpg" alt="OHCS" className="w-full h-full object-cover" />
          </div>
        </div>

        {/* Text */}
        <div className="relative mt-8 flex flex-col items-center" style={{
          animation: 'text-entrance 0.6s ease-out 0.3s both',
        }}>
          <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
            OHCS <span style={{ color: '#D4A017' }}>VMS</span>
          </h1>

          {/* Gold divider */}
          <div className="flex items-center gap-3 mt-4">
            <div className="h-[1px] w-12" style={{
              background: 'linear-gradient(90deg, transparent, #D4A017)',
            }} />
            <p className="text-[13px] tracking-[0.25em] uppercase font-semibold" style={{ color: '#D4A017' }}>
              Visitor Management System
            </p>
            <div className="h-[1px] w-12" style={{
              background: 'linear-gradient(90deg, #D4A017, transparent)',
            }} />
          </div>

          {/* Subtitle */}
          <p className="text-white/30 text-[15px] mt-3">Office of the Head of the Civil Service, Ghana</p>
        </div>

        {/* Loading bar */}
        <div className="relative mt-10 w-64 h-1.5 rounded-full overflow-hidden bg-white/10" style={{
          animation: 'text-entrance 0.6s ease-out 0.6s both',
        }}>
          <div className="h-full rounded-full" style={{
            width: '40%',
            background: 'linear-gradient(90deg, #D4A017, #F5D76E)',
            animation: 'loading-slide 1.5s ease-in-out infinite',
          }} />
        </div>

        {/* Ghana flag bar at bottom */}
        <div className="absolute bottom-0 left-0 right-0 h-1" style={{
          background: 'linear-gradient(90deg, #CE1126 33%, #FCD116 33% 66%, #006B3F 66%)',
        }} />

        {/* Motto */}
        <div className="absolute bottom-6 flex items-center gap-4" style={{
          animation: 'text-entrance 0.6s ease-out 0.9s both',
          color: '#D4A017',
        }}>
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold opacity-60">Loyalty</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold opacity-60">Excellence</span>
          <div className="w-1 h-1 rounded-full bg-[#D4A017] opacity-40" />
          <span className="text-[10px] tracking-[0.2em] uppercase font-semibold opacity-60">Service</span>
        </div>

        <style>{`
          @keyframes splash-ring {
            0% { transform: scale(0.8); opacity: 1; }
            100% { transform: scale(1.3); opacity: 0; }
          }
          @keyframes logo-entrance {
            0% { transform: scale(0.5); opacity: 0; }
            60% { transform: scale(1.05); }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes text-entrance {
            0% { transform: translateY(15px); opacity: 0; }
            100% { transform: translateY(0); opacity: 1; }
          }
          @keyframes loading-slide {
            0% { transform: translateX(-100%); }
            50% { transform: translateX(250%); }
            100% { transform: translateX(-100%); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/kiosk" element={<KioskPage />} />
          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route index element={<DashboardPage />} />
            <Route path="check-in" element={<CheckInPage />} />
            <Route path="visitors" element={<VisitorsPage />} />
            <Route path="visitors/:id" element={<VisitorDetailPage />} />
            <Route path="link-telegram" element={<LinkTelegramPage />} />
            <Route path="checkout/:code" element={<BadgeCheckoutPage />} />
            <Route path="checkout" element={<BadgeCheckoutPage />} />
            <Route path="visit-log" element={<VisitLogPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
