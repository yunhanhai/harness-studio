import { ArrowUpRight, Clock3, Server, UserRound } from 'lucide-react'
import type { ModelSetupChoice } from '@shared/models'
import { modelMessages } from '@shared/locales/models'
import { useI18n } from '../lib/i18n'
import { Modal } from './Modal'
import './ModelSetup.css'

interface ModelSetupChoicesProps {
  runtimeReady: boolean
  busy?: boolean
  onChoose: (choice: ModelSetupChoice) => void
}

/** Reusable in the first-use dialog and the regular Studio model settings card. */
export function ModelSetupChoices({ runtimeReady, busy = false, onChoose }: ModelSetupChoicesProps): React.JSX.Element {
  const { locale } = useI18n()
  const copy = (key: keyof typeof modelMessages): string => modelMessages[key][locale === 'zh-CN' ? 0 : 1]
  return (
    <div className="model-setup-choices">
      <div className="model-setup-grid">
        {([
          { choice: 'custom', title: 'models.custom', description: 'models.customDescription', Icon: Server },
          { choice: 'account', title: 'models.account', description: 'models.accountDescription', Icon: UserRound },
          { choice: 'later', title: 'models.later', description: 'models.laterDescription', Icon: Clock3 }
        ] as const).map(({ choice, title, description, Icon }) => (
          <button
            key={choice}
            type="button"
            className={`model-setup-choice ${choice === 'custom' ? 'is-primary' : ''}`}
            disabled={busy || (choice !== 'later' && !runtimeReady)}
            onClick={() => onChoose(choice)}
          >
            <span className="model-setup-choice-head"><Icon size={20} /><ArrowUpRight size={15} /></span>
            <strong>{copy(title)}</strong>
            <span>{copy(description)}</span>
          </button>
        ))}
      </div>
      {!runtimeReady ? <p className="model-setup-runtime">{copy('models.runtimeHint')}</p> : null}
      <div className="model-setup-notes">
        <p>{copy('models.localHint')}</p>
        <p>{copy('models.protocolHint')}</p>
        <p>{copy('models.sharedHint')}</p>
      </div>
    </div>
  )
}

interface ModelSetupProps extends ModelSetupChoicesProps {
  open: boolean
  error?: string
  onClose: () => void
}

export function ModelSetup({ open, error, onClose, ...choices }: ModelSetupProps): React.JSX.Element | null {
  const { locale } = useI18n()
  const copy = (key: keyof typeof modelMessages): string => modelMessages[key][locale === 'zh-CN' ? 0 : 1]
  return (
    <Modal open={open} title={copy('models.setupTitle')} subtitle={copy('models.description')} width={780} onClose={onClose}>
      {error ? <p className="model-setup-error" role="alert">{error}</p> : null}
      <ModelSetupChoices {...choices} />
    </Modal>
  )
}
