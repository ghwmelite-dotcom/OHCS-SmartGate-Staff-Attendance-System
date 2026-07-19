import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { ChatBubble } from '../chat/ChatBubble';
import { Toaster } from '../Toaster';
import { WelcomeWizard } from '../WelcomeWizard';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useAuthStore } from '@/stores/auth';
import { hasSeenWizard, markWizardSeen, shouldAutoOpenWizard, stepsForRole } from '@/lib/welcome-wizard';

export function AppLayout() {
  useKeyboardShortcuts();
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Auto-open the welcome tour once per device per user, and only over the dashboard
  useEffect(() => {
    if (!user || location.pathname !== '/' || wizardOpen) return;
    if (shouldAutoOpenWizard(stepsForRole(user.role), hasSeenWizard(user.id))) {
      setWizardOpen(true);
    }
  }, [user, location.pathname, wizardOpen]);

  // Every close path (×, ESC, backdrop, Skip tour, Get started) marks the tour seen
  function closeWizard() {
    if (user) markWizardSeen(user.id);
    setWizardOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Desktop (lg+): collapsible sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      <div className="flex flex-col flex-1 overflow-hidden min-w-0">
        <Header onOpenWizard={() => setWizardOpen(true)} />
        <main className="flex-1 overflow-auto bg-background bg-kente p-4 md:p-6 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] lg:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile/tablet: bottom navigation bar */}
      <BottomNav />

      {/* Chat bubble — positioned above bottom nav on mobile */}
      <div className="lg:bottom-6 bottom-20 fixed right-6 z-30">
        <ChatBubble />
      </div>

      <Toaster />

      <WelcomeWizard open={wizardOpen} onClose={closeWizard} />
    </div>
  );
}
