import { useI18n } from '../lib/i18n'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

class ErrorBoundaryInner extends Component<Props & { t: ReturnType<typeof useI18n>['t'] }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[Harness Studio] renderer crashed', error, info.componentStack)
  }

  private copy = (): void => {
    const text = `${this.state.error?.message ?? 'Unknown error'}\n\n${this.state.error?.stack ?? ''}`
    void navigator.clipboard?.writeText(text)
  }

  render(): ReactNode {
    const { t } = this.props
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <div className="crash-icon">
            <AlertTriangle size={26} />
          </div>
          <h1>{t('shell.theInterfaceEncounteredAnError')}</h1>
          <p>{t('shell.yourSessionsAndRuntimeDataAreSafeCopy')}</p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <div className="crash-actions">
            <button className="button button-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} />
              {t('shell.reload')}
            </button>
            <button className="button button-secondary" onClick={this.copy}>
              <Copy size={15} />
              {t('shell.copyError')}
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export function ErrorBoundary(props: Props): React.JSX.Element {
  const { t } = useI18n()
  return <ErrorBoundaryInner {...props} t={t} />
}
