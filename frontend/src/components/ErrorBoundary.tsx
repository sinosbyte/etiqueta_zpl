import React from 'react';
import { t } from '../i18n';

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-950 text-gray-100 gap-4 p-8">
          <span className="text-4xl">⚠</span>
          <h1 className="text-xl font-semibold">{t('error.title')}</h1>
          <p className="text-sm text-gray-400 max-w-md text-center">
            {this.state.error.message}
          </p>
          <button
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded"
            onClick={() => this.setState({ error: null })}
          >
            {t('error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
