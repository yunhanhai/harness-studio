import { useI18n } from '../lib/i18n'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useApp } from '../store'

const ICONS = {
  info: Info,
  success: CheckCircle2,
  error: AlertCircle
}

export function ToastHost(): React.JSX.Element {
  const { t } = useI18n()
  const toasts = useApp((state) => state.toasts)
  const dismiss = useApp((state) => state.dismissToast)

  return (
    <div className="toast-host" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.kind]
        return (
          <div
            key={toast.id}
            className={`toast toast-${toast.kind} ${toast.sticky ? 'is-sticky' : ''}`}
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon size={16} className="toast-icon" />
            <div className="toast-body">
              <span className="toast-message">{toast.message}</span>
              {toast.action ? (
                <button
                  className="toast-action"
                  onClick={() => {
                    toast.action?.run()
                    dismiss(toast.id)
                  }}
                >
                  {toast.action.labelKey ? t(toast.action.labelKey) : toast.action.label}
                </button>
              ) : null}
            </div>
            <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label={t('shell.dismissNotification')}>
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
