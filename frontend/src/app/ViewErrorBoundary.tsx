import React from 'react';
import { RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorText: string;
}

// Catches a view that fails to render and offers to reset it instead of a blank app
export class ViewErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset: () => void }) {
    super(props);
    this.state = { hasError: false, errorText: '' };
  }

  static getDerivedStateFromError(err: Error): ErrorBoundaryState {
    return { hasError: true, errorText: err?.message || 'Unbekannter Darstellungsfehler' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 panel-surface text-xs space-y-3 max-w-lg mx-auto my-8">
          <h3 className="text-sm font-bold text-main">Ansicht konnte nicht geladen werden</h3>
          <p className="text-muted">{this.state.errorText}</p>
          <button
            onClick={() => {
              this.setState({ hasError: false, errorText: '' });
              this.props.onReset();
            }}
            className="btn-primary h-8 px-3 text-xs flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Ansicht zurücksetzen</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
