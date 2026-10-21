import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '../store'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle
}

export function ToastHost(): React.JSX.Element {
  const toasts = useApp((state) => state.toasts)
  const dismiss = useApp((state) => state.dismissToast)

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <Icon size={16} className="toast-icon" />
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="关闭提示">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
