import { useState, useRef, useEffect } from 'react';
import { useChatStore } from '@/stores/chat';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';
import { Send, Bot, User, BarChart2 } from 'lucide-react';

const RECEPTIONIST_SUGGESTIONS = [
  '"Which directorate handles pensions?"',
  '"Is Mr. Mensah available?"',
  '"How many visitors today?"',
];

const ANALYTICS_SUGGESTIONS = [
  '"What\'s today\'s attendance rate?"',
  '"Which directorate had the most visitors this month?"',
  '"Who hasn\'t clocked in yet today?"',
  '"Show me visit trends for the last 30 days"',
];

export function ChatPanel() {
  const { messages, isLoading, sendMessage } = useChatStore();
  const user = useAuthStore((s) => s.user);
  const isAnalytics = user?.role === 'superadmin' || user?.role === 'admin';
  const suggestions = isAnalytics ? ANALYTICS_SUGGESTIONS : RECEPTIONIST_SUGGESTIONS;
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    await sendMessage(text);
  }

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[370px] h-[520px] bg-surface rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden animate-fade-in-up">
      {/* Header */}
      <div className="px-4 py-3.5 flex items-center gap-3 shrink-0" style={{
        background: 'linear-gradient(135deg, #1A4D2E, #0F2E1B)',
      }}>
        <div className="w-9 h-9 rounded-xl overflow-hidden ring-1 ring-accent/30">
          <img src="/ohcs-logo.jpg" alt="" className="w-full h-full object-cover" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'var(--font-display)' }}>
            OHCS <span style={{ color: '#D4A017' }}>VMS</span> Assistant
          </h3>
          <p className="text-[10px] text-accent/60 tracking-wide">Powered by AI</p>
        </div>
        {isAnalytics && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-accent/15 border border-accent/25">
            <BarChart2 className="h-3 w-3 text-accent" style={{ color: '#D4A017' }} />
            <span className="text-[10px] font-semibold tracking-wide" style={{ color: '#D4A017' }}>Analytics</span>
          </div>
        )}
      </div>
      <div className="h-[2px]" style={{
        background: 'linear-gradient(90deg, #D4A017, #F5D76E, #D4A017)',
      }} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-background-warm">
        {messages.length === 0 && (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-primary/8 flex items-center justify-center mx-auto mb-3">
              <Bot className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm text-foreground font-medium" style={{ fontFamily: 'var(--font-display)' }}>
              {isAnalytics ? 'What would you like to analyse?' : 'How can I help?'}
            </p>
            <div className="mt-3 space-y-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s.replace(/^"|"$/g, ''))}
                  className="block w-full text-left px-3 py-1.5 rounded-lg text-[11px] text-muted hover:text-foreground hover:bg-surface transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          const isEmptyStreaming = msg.role === 'assistant' && (msg as { streaming?: boolean }).streaming && !msg.content;
          return (
            <div
              key={msg.id}
              className={cn(
                'flex gap-2',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-xl px-3.5 py-2.5 text-[13px] whitespace-pre-wrap leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary text-white rounded-br-sm'
                    : 'bg-surface text-foreground border border-border rounded-bl-sm shadow-sm'
                )}
              >
                {isEmptyStreaming ? (
                  <span className="inline-flex gap-1.5 items-center py-0.5">
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-primary/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                ) : msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-lg bg-accent/10 text-accent-warm flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-3.5 w-3.5" />
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-border bg-surface px-3 py-2.5 flex gap-2 shrink-0">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question..."
          className="flex-1 h-10 px-3.5 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary transition-all"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLoading}
          className="h-10 w-10 bg-primary text-white rounded-xl flex items-center justify-center hover:bg-primary-light transition-all disabled:opacity-40 shrink-0 shadow-sm"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
