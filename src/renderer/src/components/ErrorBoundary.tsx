import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Copy, RotateCcw } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
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
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <div className="crash-card">
          <div className="crash-icon">
            <AlertTriangle size={26} />
          </div>
          <h1>界面遇到了一个错误</h1>
          <p>会话与运行时数据没有丢失。可以复制错误信息后重新加载界面。</p>
          <pre className="crash-detail">{this.state.error.message}</pre>
          <div className="crash-actions">
            <button className="button button-primary" onClick={() => window.location.reload()}>
              <RotateCcw size={15} />
              重新加载
            </button>
            <button className="button button-secondary" onClick={this.copy}>
              <Copy size={15} />
              复制错误
            </button>
          </div>
        </div>
      </div>
    )
  }
}
