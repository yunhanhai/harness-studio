import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { tabLimitMessage, useApp } from '../store'

interface TabStripProps {
  /** The host is up and the tabs have live webviews. */
  ready: boolean
}

/**
 * Session tabs in the workspace toolbar. Chips only appear with two or more tabs;
 * the "+" button is always there so the feature can be discovered.
 */
export function TabStrip({ ready }: TabStripProps): React.JSX.Element {
  const tabs = useApp((state) => state.tabs)
  const activeTabId = useApp((state) => state.activeTabId)
  const limit = useApp((state) => state.settings?.tabs.limit ?? 4)
  const newTab = useApp((state) => state.newTab)
  const closeTab = useApp((state) => state.closeTab)
  const activateTab = useApp((state) => state.activateTab)
  const listRef = useRef<HTMLDivElement | null>(null)

  // While the host is down the tabs have no pages, and a restart collapses them
  // anyway, so the strip waits for a ready host.
  const showChips = ready && tabs.length > 1
  const atLimit = tabs.length >= limit

  // Past a handful of tabs the row scrolls; keep the active chip in sight.
  useEffect(() => {
    if (!showChips) return
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, showChips, tabs.length])

  return (
    <div
      className="workspace-tabs"
      style={{ '--tab-slots': showChips ? Math.min(tabs.length, 4) : 0 } as React.CSSProperties}
    >
      {showChips ? (
        <div className="tab-list" role="tablist" aria-label="会话标签页" ref={listRef}>
          {tabs.map((tab) => {
            const label = tab.title || `会话 ${tab.seq}`
            const selected = tab.id === activeTabId
            return (
              <div
                key={tab.id}
                className={`tab-chip ${selected ? 'is-active' : ''}`}
                role="tab"
                aria-selected={selected}
                title={label}
                onClick={() => activateTab(tab.id)}
                // Chips never take focus, so the conversation keeps it (and a
                // middle click does not start autoscroll).
                onMouseDown={(event) => event.preventDefault()}
                // Middle click closes, like a browser tab.
                onAuxClick={(event) => {
                  if (event.button === 1) closeTab(tab.id)
                }}
              >
                <span className="tab-chip-label">{label}</span>
                <button
                  className="tab-chip-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                  title="关闭标签页"
                  aria-label={`关闭「${label}」`}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
      <button
        className="icon-button tab-new"
        disabled={!ready || atLimit}
        onClick={() => newTab()}
        title={atLimit ? tabLimitMessage(limit) : '新建会话标签页（Ctrl+T）'}
        aria-label="新建会话标签页"
      >
        <Plus size={15} />
      </button>
    </div>
  )
}
