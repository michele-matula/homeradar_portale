import { Component, type ReactNode } from 'react';
import { reportError } from '../errors';

/** Un errore di render non lascia la pagina bianca: si segnala e si offre di ricaricare. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportError(`${error.name}: ${error.message}`);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="page page--center">
        <div className="card">
          <p>Qualcosa non va.</p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Ricarica la pagina
          </button>
        </div>
      </div>
    );
  }
}
