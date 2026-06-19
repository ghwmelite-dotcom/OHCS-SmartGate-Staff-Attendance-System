import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// App-wide error boundary. A render-time crash must NOT leave staff staring at
// a white screen — we surface a friendly recovery card with a reload action.
// Class component because error boundaries require the componentDidCatch /
// getDerivedStateFromError lifecycle.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep a console trace for field debugging; no PII is logged.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
        style={{ background: 'linear-gradient(165deg, #1A4D2E 0%, #0F2E1B 50%, #071A0F 100%)' }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'rgba(212, 160, 23, 0.12)', boxShadow: '0 0 40px rgba(212, 160, 23, 0.15)' }}
        >
          <AlertTriangle className="h-8 w-8" style={{ color: '#D4A017' }} />
        </div>
        <h1
          className="text-2xl md:text-3xl font-bold text-white tracking-tight"
          style={{ fontFamily: "'Playfair Display', serif" }}
        >
          Something went wrong
        </h1>
        <p className="text-white/50 text-[15px] mt-3 max-w-sm">
          An unexpected error occurred. Reloading usually fixes it.
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="mt-8 inline-flex items-center gap-2 h-11 px-6 rounded-xl font-semibold text-[15px] transition-all"
          style={{ background: 'linear-gradient(90deg, #D4A017, #F5D76E)', color: '#0F2E1B' }}
        >
          <RotateCcw className="h-4 w-4" />
          Reload
        </button>
      </div>
    );
  }
}
