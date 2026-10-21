import { Download, X } from 'lucide-react'
import type { InstallProgress } from '@shared/types'
import { useApp } from '../store'

const PHASE_LABEL: Record<InstallProgress['phase'], string> = {
  idle: '准备安装',
  'download-node': '下载 Node.js',
  extract: '解压运行时',
  'install-dsh': '安装 DeepSeek Harness',
  verify: '校验运行时',
  done: '安装完成',
  error: '安装失败'
}

export function InstallStrip({ progress }: { progress: InstallProgress }): React.JSX.Element {
  const cancelInstall = useApp((state) => state.cancelInstall)
  return (
    <div className={`install-strip install-${progress.phase}`}>
      <div className="install-icon">
        <Download size={15} />
      </div>
      <div className="install-body">
        <div className="install-head">
          <span className="install-phase">{PHASE_LABEL[progress.phase]}</span>
          <span className="install-message">{progress.message}</span>
          <span className="install-percent">{progress.percent}%</span>
        </div>
        <div className="install-track">
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        {progress.detail ? <div className="install-detail">{progress.detail}</div> : null}
      </div>
      <button className="icon-button" onClick={() => void cancelInstall()} title="取消安装">
        <X size={14} />
      </button>
    </div>
  )
}
