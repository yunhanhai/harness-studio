import { useI18n } from '../lib/i18n'
import { Download, X } from 'lucide-react'
import type { InstallProgress } from '@shared/types'
import { useApp } from '../store'

export function InstallStrip({ progress }: { progress: InstallProgress }): React.JSX.Element {
  const { t } = useI18n()
  const PHASE_LABEL: Record<InstallProgress['phase'], string> = {
    idle: t('shell.preparingInstallation'),
    'download-node': t('shell.downloadingNodeJs'),
    extract: t('shell.extractingRuntime'),
    'install-dsh': t('shell.installingDeepseekHarness'),
    verify: t('shell.verifyingRuntime'),
    done: t('shell.installationComplete'),
    error: t('shell.installationFailed')
  }
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
      <button className="icon-button" onClick={() => void cancelInstall()} title={t('shell.cancelInstallation')}>
        <X size={14} />
      </button>
    </div>
  )
}
