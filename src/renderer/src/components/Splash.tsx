import { useI18n } from '../lib/i18n'
import { BrandMark } from './BrandMark'

export function Splash(): React.JSX.Element {
  const { t } = useI18n()
  return (
    <div className="splash">
      <div className="splash-glow" />
      <div className="splash-mark">
        <BrandMark size={58} />
      </div>
      <div className="splash-title">Harness Studio</div>
      <div className="splash-subtitle">{t('shell.preparingYourWorkspace')}</div>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  )
}
