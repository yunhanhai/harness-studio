import { BrandMark } from './BrandMark'

export function Splash(): React.JSX.Element {
  return (
    <div className="splash">
      <div className="splash-glow" />
      <div className="splash-mark">
        <BrandMark size={58} />
      </div>
      <div className="splash-title">Harness Studio</div>
      <div className="splash-subtitle">正在准备你的工作台…</div>
      <div className="splash-bar">
        <span />
      </div>
    </div>
  )
}
