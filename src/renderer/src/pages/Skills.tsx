import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, ExternalLink, FolderInput, History, Pencil, Plus, Puzzle, RefreshCw, Search, Trash2 } from 'lucide-react'
import type { LocalSkill, SkillBackup, SkillPreview, SkillsInventory } from '@shared/skills'
import { useI18n } from '../lib/i18n'
import { useApp } from '../store'
import { Modal } from '../components/Modal'
import './Skills.css'

const PLUGINS = [
  { name: 'better-sidebar', url: 'https://github.com/omdsh-dev/DSH-better-sidebar', zh: '文件、Git 与终端侧栏。建议先确认多标签、终端快捷键和窄窗口布局。', en: 'Files, Git and terminal sidebar. Check tabs, terminal shortcuts and narrow layouts first.' },
  { name: 'DSH Skills Manager', url: 'https://github.com/MichengAI/dsh-skills-manager', zh: '完整技能管理的可选扩展；会聚合其他工具的技能来源，安装前确认范围。', en: 'Optional skill management extension. It aggregates skills from other tools; review its source scope.' },
  { name: 'dshmarket', url: 'https://github.com/dsh-market/dsh-market', zh: '社区市场。其重启功能可能与 Studio 冲突；关闭 allowRestart 后由 Studio 重启。', en: 'Community market. Its restart feature may conflict with Studio; disable allowRestart and restart from Studio.' },
  { name: 'billion-context', url: 'https://github.com/ranxianglei/billion-context', zh: '长上下文压缩。改变模型请求与上下文；有额外署名条款。', en: 'Long-context compression. Changes requests and context; includes additional attribution terms.' },
  { name: 'dsh-codex-ui', url: 'https://github.com/MichengAI/dsh-codex-ui', zh: '会话界面外观选项。更改导航与输入结构，需重验标签和快速提问。', en: 'Alternative conversation UI. Changes navigation and input structure; recheck tabs and Quick Ask.' },
  { name: 'Whale Widget', url: 'https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget', zh: '查询真实余额。使用提供商凭据与网络接口，区别于 Studio 的费用估算。', en: 'Live balance queries. Uses provider credentials and network services; distinct from Studio cost estimates.' },
  { name: 'modlens', url: 'https://github.com/liustack/modlens', zh: '文本模型的图像理解桥。需要额外视觉引擎，图片可能发送至另一端点并计费。', en: 'Image understanding for text models. Needs a vision engine; images may reach a separate endpoint and incur charges.' },
  { name: 'Hindsight', url: 'https://github.com/vectorize-io/hindsight/tree/main/hindsight-integrations/coding-agents', zh: '长期记忆。需要额外部署与采集范围配置；提取模型可能使用外部服务。', en: 'Long-term memory. Requires deployment and capture scope configuration; extraction may use external models.' }
]

interface Draft { id?: string; revision?: string; sourceId: string; name: string; content: string }

export function Skills(): React.JSX.Element {
  const { locale, t } = useI18n()
  const host = useApp(state => state.host)
  const activeTabId = useApp(state => state.activeTabId)
  const activePath = useApp(state => state.tabs.find(tab => tab.id === state.activeTabId)?.path)
  const openPlugins = useApp(state => state.openPlugins)
  const toast = useApp(state => state.toast)
  const [tab, setTab] = useState<'local' | 'plugins'>('local')
  const [inventory, setInventory] = useState<SkillsInventory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [deleting, setDeleting] = useState<LocalSkill | null>(null)
  const [backups, setBackups] = useState<SkillBackup[] | null>(null)
  const [busy, setBusy] = useState(false)
  const listSequence = useRef(0)
  const previewSequence = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++listSequence.current
    setLoading(true)
    setError('')
    try {
      const value = await window.studio.skills.list()
      if (sequence !== listSequence.current) return
      setInventory(value)
      setSourceId(current => value.sources.some(source => source.id === current) ? current : '')
      setSelectedId(current => value.skills.some(skill => skill.id === current) ? current : '')
    } catch (failure) {
      if (sequence === listSequence.current) { setError(String(failure)); setInventory(null) }
    } finally { if (sequence === listSequence.current) setLoading(false) }
  }, [])

  useEffect(() => {
    setPreview(null)
    setSelectedId('')
    void refresh()
    return () => { listSequence.current++; previewSequence.current++ }
  }, [refresh, activeTabId, activePath, host.pid, host.state])

  useEffect(() => {
    const sequence = ++previewSequence.current
    setPreview(null)
    if (!selectedId) { setPreviewLoading(false); return }
    setPreviewLoading(true)
    void window.studio.skills.preview(selectedId).then(value => {
      if (sequence === previewSequence.current) setPreview(value)
    }).catch(failure => {
      if (sequence === previewSequence.current) setError(String(failure))
    }).finally(() => { if (sequence === previewSequence.current) setPreviewLoading(false) })
    return () => { previewSequence.current++ }
  }, [selectedId, inventory])

  const filtered = useMemo(() => inventory?.skills.filter(skill => (!sourceId || skill.sourceId === sourceId)
    && `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(query.trim().toLowerCase())) ?? [], [inventory, sourceId, query])
  const destinations = inventory?.sources.filter(source => source.writable) ?? []
  const destination = destinations.find(source => source.id === destinationId) ?? destinations[0]
  const scopeLabel = (scope: 'project' | 'user' | 'custom' | 'bundled'): string => t(`skills.${scope}`)

  const mutate = async (action: () => Promise<unknown>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const result = await action()
      if (result === undefined) return
      setDraft(null)
      setDeleting(null)
      setPreview(null)
      toast(t('skills.saved'), 'success')
      await refresh()
      if (backups) setBackups(await window.studio.skills.backups())
    } catch (failure) { toast(String(failure), 'error') }
    finally { setBusy(false) }
  }

  const create = (): void => {
    if (!destination) return toast(t('skills.pickDestination'), 'info')
    setDraft({ sourceId: destination.id, name: 'my-skill', content: `---\nname: my-skill\ndescription: ${t('skills.defaultTemplate')}\n---\n\n# My skill\n\n${t('skills.defaultTemplate')}\n` })
  }

  return <div className="page skills-page">
    <header className="page-head">
      <div><div className="eyebrow"><BookOpen size={13} />DSH</div><h1>{t('skills.title')}</h1><p>{t('skills.subtitle')}</p></div>
      <div className="page-head-actions">
        <button className="button button-ghost" disabled={busy || loading} onClick={() => void refresh()}><RefreshCw size={15} />{t('skills.refresh')}</button>
        <button className="button button-ghost" disabled={busy} onClick={() => void window.studio.skills.backups().then(setBackups).catch(failure => toast(String(failure), 'error'))}><History size={15} />{t('skills.backups')}</button>
      </div>
    </header>
    <div className="skills-tabs">
      <button className={`button ${tab === 'local' ? 'button-primary' : 'button-ghost'}`} onClick={() => setTab('local')}><BookOpen size={15} />{t('skills.local')}</button>
      <button className={`button ${tab === 'plugins' ? 'button-primary' : 'button-ghost'}`} onClick={() => setTab('plugins')}><Puzzle size={15} />{t('skills.plugins')}</button>
    </div>
    {tab === 'plugins' ? <>
      <p className="skills-note">{t('skills.pluginNote')}</p>
      <div className="skills-plugin-grid">{PLUGINS.map(plugin => <article className="panel skill-plugin" key={plugin.name}>
        <h3>{plugin.name}</h3><p>{locale === 'zh-CN' ? plugin.zh : plugin.en}</p>
        <button className="button button-ghost button-small" onClick={() => void window.studio.app.openExternal(plugin.url)}><ExternalLink size={14} />{t('skills.openRepository')}</button>
      </article>)}</div>
      <section className="panel skill-market"><h3>{t('skills.marketTitle')}</h3><p>{t('skills.marketNote')}</p><div className="skills-actions">
        <button className="button button-primary" disabled={host.state !== 'ready'} onClick={() => void openPlugins()}>{t('skills.openPlugins')}</button>
        <button className="button button-ghost" onClick={() => void window.studio.app.openExternal('https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/experimental/plugin-market-bundle/README.zh.md')}>{t('skills.marketDocs')}</button>
        <button className="button button-ghost" onClick={() => void window.studio.clipboard.write('https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json').then(() => toast(t('skills.indexCopied'), 'success'))}>{t('skills.copyIndex')}</button>
      </div></section>
    </> : <>
      <p className="skills-note">{t('skills.diskNote')}</p>
      {inventory && !inventory.configurationVerified ? <p className="skills-notice">{t('skills.unverified')}</p> : null}
      {inventory && !inventory.cwd ? <p className="skills-note">{t('skills.noProject')}</p> : null}
      {inventory?.cwd ? <div className="skills-context mono" title={inventory.cwd}>{inventory.cwd} · {inventory.profile}</div> : null}
      {inventory?.warnings.filter(warning => !warning.startsWith('Default filesystem directories are shown.') && !warning.startsWith('This is a local file inventory.')).map(warning => <p className="skills-notice" key={warning}>{warning}</p>)}
      {inventory?.sources.filter(source => source.diagnostic).map(source => <p className="skills-notice" key={source.id}>{source.path} · {source.diagnostic}</p>)}
      <div className="skills-toolbar">
        <div className="search-field"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t('skills.search')} /></div>
        <select aria-label={t('skills.all')} value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">{t('skills.all')}</option>{inventory?.sources.map(source => <option key={source.id} value={source.id}>{scopeLabel(source.scope)} · {source.path} {source.writable ? '' : `(${t('skills.readonly')})`}</option>)}</select>
        <label className="skills-destination">{t('skills.destination')}<select title={destination?.path} value={destination?.id ?? ''} onChange={event => setDestinationId(event.target.value)} aria-label={t('skills.destination')}>{destinations.map(source => <option key={source.id} value={source.id}>{scopeLabel(source.scope)} · {source.path}</option>)}</select></label>
        <button className="button button-ghost" disabled={busy || loading || !destination} onClick={() => destination && void mutate(async () => {
          const result = await window.studio.skills.import(destination.id)
          if (!result) return
          if (result.skill) setSelectedId(result.skill.id)
          return result
        })}><FolderInput size={15} />{t('skills.import')}</button>
        <button className="button button-primary" disabled={busy || loading || !destination} onClick={create}><Plus size={15} />{t('skills.create')}</button>
      </div>
      {error ? <p role="alert" className="skills-notice">{error}</p> : null}
      {loading ? <p>{t('skills.loading')}</p> : <div className="skills-layout">
        <div className="skills-list">{filtered.length ? filtered.map(skill => <button key={skill.id} className={`skill-row ${skill.id === selectedId ? 'selected' : ''}`} onClick={() => setSelectedId(skill.id)}>
          <div className="skill-row-heading"><strong>{skill.name}</strong><span className="skill-badge">{skill.writable ? t('skills.writable') : t('skills.readonly')}</span></div>
          <p>{skill.description || skill.diagnostic}</p><div className="skill-path mono">{skill.path}</div>
          {!skill.valid ? <span className="skill-state">{t('skills.invalid')}</span> : skill.shadowedBy ? <span className="skill-state">{t('skills.shadowed')}</span> : null}
        </button>) : <p className="skills-note">{t('skills.empty')}</p>}</div>
        <section className="panel skill-preview">{previewLoading ? <p>{t('skills.loading')}</p> : preview ? <>
          <div className="skill-preview-head"><h3>{preview.skill.name}</h3><div className="skills-actions">
            <button className="button button-ghost button-small" disabled={busy || !preview.skill.writable} onClick={() => setDraft({ id: preview.skill.id, revision: preview.skill.revision, sourceId: preview.skill.sourceId, name: preview.skill.name, content: preview.content })}><Pencil size={14} />{t('skills.edit')}</button>
            <button className="button button-ghost button-small" disabled={busy || !preview.skill.writable} onClick={() => setDeleting(preview.skill)}><Trash2 size={14} />{t('skills.delete')}</button>
          </div></div>
          {preview.skill.diagnostic ? <p className="skills-notice">{preview.skill.diagnostic}</p> : null}
          {preview.skill.shadowedBy ? <p className="skills-notice">{t('skills.shadowed')} · {inventory?.skills.find(skill => skill.id === preview.skill.shadowedBy)?.path}</p> : null}
          <p className="skills-note">{t(preview.skill.modelInvocable ? 'skills.modelAllowed' : 'skills.modelBlocked')}</p>
          <pre className="skill-content">{preview.content}</pre>
          <details><summary>{t('skills.resources', { count: preview.resources.length })}</summary><ul>{preview.resources.map(path => <li className="mono" key={path}>{path}</li>)}</ul></details>
        </> : <p className="skills-note">{t('skills.preview')}</p>}</section>
      </div>}
    </>}
    <Modal open={Boolean(draft)} title={draft?.id ? t('skills.edit') : t('skills.create')} width={820} onClose={() => { if (!busy) setDraft(null) }} footer={<>
      <button className="button button-ghost" disabled={busy} onClick={() => setDraft(null)}>{t('skills.cancel')}</button>
      <button className="button button-primary" disabled={busy || !draft?.content.trim() || !draft?.name.trim()} onClick={() => draft && void mutate(() => draft.id ? window.studio.skills.save(draft.id, draft.revision!, draft.content) : window.studio.skills.create(draft.sourceId, draft.name, draft.content))}>{t('skills.save')}</button>
    </>}>
      {draft ? <div className="skill-editor">
        {!draft.id ? <><label>{t('skills.destination')}<select value={draft.sourceId} onChange={event => setDraft({ ...draft, sourceId: event.target.value })}>{destinations.map(source => <option key={source.id} value={source.id}>{scopeLabel(source.scope)} · {source.path}</option>)}</select></label><label>{t('skills.name')}<input value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value, content: draft.content.replace(/^name: .*$/m, () => `name: ${event.target.value}`) })} /></label></> : null}
        <label>{t('skills.content')}<textarea className="mono" spellCheck={false} rows={17} value={draft.content} onChange={event => setDraft({ ...draft, content: event.target.value })} /></label>
      </div> : null}
    </Modal>
    <Modal open={Boolean(deleting)} title={t('skills.deleteTitle')} subtitle={deleting?.name} onClose={() => { if (!busy) setDeleting(null) }} footer={<><button className="button button-ghost" disabled={busy} onClick={() => setDeleting(null)}>{t('skills.cancel')}</button><button className="button button-primary" disabled={busy} onClick={() => deleting && void mutate(() => window.studio.skills.remove(deleting.id, deleting.revision))}>{t('skills.delete')}</button></>}><p>{t('skills.deleteNote')}</p></Modal>
    <Modal open={Boolean(backups)} title={t('skills.backups')} width={720} onClose={() => { if (!busy) setBackups(null) }}>
      {backups?.length ? backups.map(backup => <div className="skill-backup" key={backup.id}><div><strong>{backup.name}</strong><p>{new Date(backup.createdAt).toLocaleString(locale)} · {backup.operation}</p><div className="skill-path mono">{backup.sourcePath}</div></div><button className="button button-ghost button-small" disabled={busy || backup.restored} onClick={() => void mutate(() => window.studio.skills.restore(backup.id))}>{t(backup.restored ? 'skills.restored' : 'skills.restore')}</button></div>) : <p>{t('skills.noBackups')}</p>}
    </Modal>
  </div>
}
