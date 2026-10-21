import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Loader2, Send, Sparkles, X } from 'lucide-react'
import type { QuickAskResult, Settings } from '@shared/types'

type Phase = 'idle' | 'sending' | 'error'

export default function QuickAsk(): React.JSX.Element {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [autoSend, setAutoSend] = useState(true)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    document.body.classList.add('quickask-body')
    const api = window.studio

    void api.settings.get().then((value) => {
      setSettings(value)
      setAutoSend(value.quickAsk.autoSend)
    })

    const offSettings = api.settings.onChange((value) => {
      setSettings(value)
      setAutoSend(value.quickAsk.autoSend)
    })

    const reset = (): void => {
      setText('')
      setError('')
      setPhase('idle')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    const offOpen = api.quickAsk.onOpen(reset)
    const offResult = api.quickAsk.onResult((result: QuickAskResult) => {
      if (result.status === 'failed' || result.status === 'needs-host' || result.status === 'no-workspace') {
        setPhase('error')
        setError(result.message ?? '发送失败')
      }
    })

    window.addEventListener('focus', reset)
    reset()

    return () => {
      offSettings()
      offOpen()
      offResult()
      window.removeEventListener('focus', reset)
    }
  }, [])

  const submit = async (): Promise<void> => {
    const value = text.trim()
    if (!value || phase === 'sending') return
    setPhase('sending')
    setError('')
    try {
      const result = await window.studio.quickAsk.submit(value, { autoSend })
      if (result.status === 'failed' || result.status === 'needs-host' || result.status === 'no-workspace') {
        setPhase('error')
        setError(result.message ?? '发送失败')
        return
      }
      setText('')
      setPhase('idle')
    } catch (caught) {
      setPhase('error')
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      window.studio.quickAsk.hide()
    }
  }

  const shortcutLabel = settings?.shortcuts.quickAsk ?? 'Ctrl+Alt+Space'

  return (
    <div className="quickask">
      <div className={`quickask-card ${phase === 'error' ? 'is-error' : ''}`}>
        <div className="quickask-head">
          <span className="quickask-mark">
            <Sparkles size={14} />
          </span>
          <span className="quickask-title">快速提问</span>
          <span className="quickask-hint">{shortcutLabel}</span>
          <button className="quickask-close" onClick={() => window.studio.quickAsk.hide()} aria-label="关闭">
            <X size={13} />
          </button>
        </div>

        <textarea
          ref={inputRef}
          className="quickask-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="直接输入，Enter 发送到 Harness…"
          rows={3}
          spellCheck={false}
          autoFocus
        />

        {error ? <div className="quickask-error">{error}</div> : null}

        <div className="quickask-foot">
          <label className="quickask-toggle">
            <input
              type="checkbox"
              checked={autoSend}
              onChange={(event) => setAutoSend(event.target.checked)}
            />
            <span>自动发送</span>
          </label>
          <span className="quickask-keys">
            <kbd>Enter</kbd> 发送
            <kbd>Shift+Enter</kbd> 换行
            <kbd>Esc</kbd> 关闭
          </span>
          <button
            className="quickask-submit"
            disabled={!text.trim() || phase === 'sending'}
            onClick={() => void submit()}
          >
            {phase === 'sending' ? <Loader2 size={13} className="spin" /> : autoSend ? <Send size={13} /> : <CornerDownLeft size={13} />}
            {phase === 'sending' ? '发送中' : autoSend ? '发送' : '填入'}
          </button>
        </div>
      </div>
    </div>
  )
}
