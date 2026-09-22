import { useChatStore } from '@/stores/chat';
import { MessageCircle, X } from 'lucide-react';
import { ChatPanel } from './ChatPanel';
import { useAuthStore } from '@/stores/auth';
import { hasRoleAccess, MODULE_ROLES } from '@/lib/roles';

export function ChatBubble() {
  const { isOpen, toggle } = useChatStore();
  const user = useAuthStore((s) => s.user);
  // Normal staff have a personal dashboard, not the operational assistant.
  if (!hasRoleAccess(user?.role, MODULE_ROLES.visits, user?.directorate_abbr)) return null;

  return (
    <>
      {isOpen && <ChatPanel />}
      <button
        onClick={toggle}
        className="w-14 h-14 rounded-2xl shadow-xl hover:shadow-2xl transition-all flex items-center justify-center hover:scale-105 active:scale-95 text-white z-50"
        style={{
          background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)',
          boxShadow: '0 8px 32px rgba(26, 77, 46, 0.3), 0 0 0 1px rgba(212, 160, 23, 0.15)',
        }}
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </>
  );
}
