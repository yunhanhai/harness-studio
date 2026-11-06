import { useI18n } from '../lib/i18n'
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
  const { t } = useI18n()
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
            {t('shell.promptLibrary')}
          </div>
          <h1>{t('shell.keepYourBestQuestionsHandy')}</h1>
          <p>{t('shell.copyFrequentlyUsedPromptsIntoASessionWith')}</p>
        </div>
        <div className="page-head-actions">
          <div className="search-field">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('shell.searchTitlesContentOrTags')} />
            {query ? (
              <button className="search-clear" onClick={() => setQuery('')}>
                {t('shell.clear')}
              </button>
            ) : null}
          </div>
          <button className="button button-primary" onClick={() => openEditor()}>
            <Plus size={15} />
            {t('shell.newPrompt')}
          </button>
        </div>
      </header>

      <div className="prompt-meta-row">
        <span>{t('shell.promptsCount', { count: prompts.length })}</span>
        <span className="meta-dot" />
        <span>{t('shell.promptsUsageTotal', { count: prompts.reduce((sum, item) => sum + item.usageCount, 0) })}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-card prompts-empty">
          <div className="empty-art">
            <Sparkles size={24} />
          </div>
          <div className="empty-copy">
            <h3>{query ? t('shell.noMatchingPrompts') : t('shell.noPromptsYet')}</h3>
            <p>{query ? t('shell.tryAnotherKeywordOrCreateANewPrompt') : t('shell.saveYourReviewRefactoringAndTestingInstructionsFor')}</p>
          </div>
          <button className="button button-secondary" onClick={() => openEditor()}>
            <Plus size={15} />
            {t('shell.new')}
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
                <span className="prompt-usage" title={t('shell.usedTimes', { p0: item.usageCount })}>
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
                  {t('shell.copyToUse')}
                </button>
                <button className="icon-button" onClick={() => openEditor(item)} title={t('shell.edit')}>
                  <Pencil size={14} />
                </button>
                <button className="icon-button danger" onClick={() => setPendingDelete(item)} title={t('shell.delete')}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(draft)}
        title={draft?.id ? t('shell.editPrompt') : t('shell.newPrompt')}
        subtitle={t('shell.promptsStayOnThisComputerAndCanBe')}
        onClose={() => setDraft(null)}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setDraft(null)}>
              {t('shell.cancel')}
            </button>
            <button
              className="button button-primary"
              disabled={saving || !draft?.title.trim() || !draft?.content.trim()}
              onClick={() => void submit()}
            >
              {saving ? t('shell.saving') : draft?.id ? t('shell.saveChanges') : t('shell.createPrompt')}
            </button>
          </>
        }
      >
        {draft ? (
          <div className="form-stack">
            <label className="field">
              <span>{t('shell.title')}</span>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder={t('shell.forExampleCodeReviewTaskBreakdown')}
                autoFocus
              />
            </label>
            <label className="field">
              <span>{t('shell.content')}</span>
              <textarea
                value={draft.content}
                onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                rows={8}
                placeholder={t('shell.writeTheCompleteInstructionsForHarness')}
              />
            </label>
            <label className="field">
              <span>{t('shell.tags')}</span>
              <input
                value={draft.tags}
                onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                placeholder={t('shell.separateWithCommasForExampleCodeQualityRefactoring')}
              />
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(pendingDelete)}
        title={t('shell.deleteThisPrompt')}
        subtitle={pendingDelete?.title}
        onClose={() => setPendingDelete(null)}
        width={460}
        footer={
          <>
            <button className="button button-ghost" onClick={() => setPendingDelete(null)}>
              {t('shell.cancel')}
            </button>
            <button
              className="button button-danger"
              onClick={async () => {
                if (pendingDelete && await deletePrompt(pendingDelete.id)) setPendingDelete(null)
              }}
            >
              {t('shell.delete')}
            </button>
          </>
        }
      >
        <p className="modal-text">{t('shell.thisCannotBeUndoneContentAlreadyCopiedInto')}</p>
      </Modal>
    </div>
  )
}
