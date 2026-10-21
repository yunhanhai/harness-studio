import { useMemo, useState } from 'react'
import { Copy, Pencil, Plus, Search, Sparkles, Tag, Trash2 } from 'lucide-react'
import type { PromptItem } from '@shared/types'
import { useApp } from '../store'
import { Modal } from '../components/Modal'

interface Draft {
  id?: string
  title: string
  content: string
  tags: string
}

const EMPTY_DRAFT: Draft = { title: '', content: '', tags: '' }

export function Prompts(): React.JSX.Element {
  const prompts = useApp((state) => state.prompts)
  const savePrompt = useApp((state) => state.savePrompt)
  const deletePrompt = useApp((state) => state.deletePrompt)
  const usePrompt = useApp((state) => state.usePrompt)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PromptItem | null>(null)
  const [saving, setSaving] = useState(false)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const list = keyword
      ? prompts.filter((item) =>
          [item.title, item.content, ...item.tags].some((value) => value.toLowerCase().includes(keyword))
        )
      : prompts
    return [...list].sort((a, b) => b.usageCount - a.usageCount || b.updatedAt - a.updatedAt)
  }, [prompts, query])

  const openEditor = (item?: PromptItem): void => {
    setDraft(
      item
        ? { id: item.id, title: item.title, content: item.content, tags: item.tags.join(', ') }
        : { ...EMPTY_DRAFT }
    )
  }

  const submit = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    const ok = await savePrompt({
      id: draft.id,
      title: draft.title,
      content: draft.content,
      tags: draft.tags
        .split(/[,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    })
    setSaving(false)
    if (ok) setDraft(null)
  }

  return (
    <div className="page prompts-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">
            <Sparkles size={13} />
            提示词库
          </div>
          <h1>把好问题沉淀下来</h1>
          <p>常用提示词一键复制到会话。它们保存在本地，不会上传。</p>
        </div>
        <div className="page-head-actions">
          <div className="search-field">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容或标签" />
            {query ? (
              <button className="search-clear" onClick={() => setQuery('')}>
                清除
              </button>
            ) : null}
          </div>
          <button className="button button-primary" onClick={() => openEditor()}>
            <Plus size={15} />
            新建提示词
          </button>
        </div>
      </header>

      <div className="prompt-meta-row">
        <span>{prompts.length} 条提示词</span>
        <span className="meta-dot" />
        <span>累计使用 {prompts.reduce((sum, item) => sum + item.usageCount, 0)} 次</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card prompts-empty">
          <div className="empty-art">
            <Sparkles size={24} />
          </div>
          <div className="empty-copy">
            <h3>{query ? '没有匹配的提示词' : '还没有提示词'}</h3>
            <p>{query ? '换一个关键词试试，或者创建一条新的提示词。' : '把常用的代码审查、重构、测试要求存下来，下一次只需一次点击。'}</p>
          </div>
          <button className="button button-secondary" onClick={() => openEditor()}>
            <Plus size={15} />
            新建
          </button>
        </div>
      ) : (
        <div className="prompt-grid">
          {filtered.map((item) => (
            <article key={item.id} className="prompt-card">
              <div className="prompt-card-head">
                <div className="prompt-icon">
                  <Sparkles size={15} />
                </div>
                <h3 title={item.title}>{item.title}</h3>
                <span className="prompt-usage" title={`使用 ${item.usageCount} 次`}>
                  {item.usageCount}
                </span>
              </div>
              <p className="prompt-preview">{item.content}</p>
              <div className="prompt-tags">
                {item.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="tag">
                    <Tag size={10} />
                    {tag}
                  </span>
                ))}
              </div>
              <div className="prompt-actions">
                <button className="button button-prompt button-small" onClick={() => void usePrompt(item)}>
                  <Copy size={13} />
                  复制使用
                </button>
                <button className="icon-button" onClick={() => openEditor(item)} title="编辑">
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" onClick={() => setPendingDelete(item)} title="删除">
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? '编辑提示词' : '新建提示词'}
        subtitle="提示词只保存在本机，可随时修改。"
        onClose={() => setDraft(null)}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setDraft(null)}>
              取消
            </button>
            <button
              className="button button-primary"
              disabled={saving || !draft?.title.trim() || !draft?.content.trim()}
              onClick={() => void submit()}
            >
              {saving ? '保存中…' : draft?.id ? '保存修改' : '创建提示词'}
            </button>
          </>
        }
      >
        {draft ? (
          <div className="form-stack">
            <label className="field">
              <span>标题</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder="例如：代码审查、需求拆解"
                autoFocus
              />
            </label>
            <label className="field">
              <span>内容</span>
              <textarea
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                rows={8}
                placeholder="写下你希望 Harness 遵循的完整指令…"
              />
            </label>
            <label className="field">
              <span>标签</span>
              <input
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                placeholder="用逗号分隔，例如：代码质量, 重构"
              />
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        title="删除这条提示词？"
        subtitle={pendingDelete?.title}
        onClose={() => setPendingDelete(null)}
        width={460}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setPendingDelete(null)}>
              取消
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                if (pendingDelete) void deletePrompt(pendingDelete.id)
                setPendingDelete(null)
              }}
            >
              删除
            </button>
          </>
        }
      >
        <p className="modal-text">删除后无法恢复。已复制到会话中的内容不受影响。</p>
      </Modal>
    </div>
  )
}
