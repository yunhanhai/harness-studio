/** Navigation choices use Harness' own editors and credential storage. */
export type ModelSetupChoice = 'custom' | 'account' | 'later'
export type ModelNavigationChoice = ModelSetupChoice | 'models'

export type OpenModelPanelResult =
  | { status: 'opened' }
  | { status: 'cancelled' }
  | { status: 'missing' | 'failed' | 'blocked'; message: string }
