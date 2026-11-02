export const modelMessages = {
  'models.setupTitle': ['选择如何使用模型', 'Choose how to use models'],
  'models.description': ['无需登录 DeepSeek 账号，也可以使用第三方 API 或自定义模型。', 'Use a third-party API or a custom model without a DeepSeek account.'],
  'models.custom': ['使用自定义模型', 'Use a custom model'],
  'models.customDescription': ['连接第三方 API、中转站或本地兼容服务，在 Harness 中配置地址、协议、模型与服务要求的密钥。', 'Connect a third-party API, relay, or local compatible service. Configure its URL, protocol, model, and required key in Harness.'],
  'models.account': ['登录 DeepSeek 账号', 'Sign in to DeepSeek'],
  'models.accountDescription': ['打开 Harness 的账号入口，使用官方账号服务。', 'Open the Harness account entry to use the official account service.'],
  'models.later': ['稍后配置', 'Configure later'],
  'models.laterDescription': ['先进入工作区写草稿、查看项目或管理技能；生成回答前需要配置并选择可用模型。', 'Enter the workspace to draft, view projects, or manage skills. Configure and select an available model before generating replies.'],
  'models.localHint': ['本地服务若不验证密钥，当前 Harness 兼容层可填 local-placeholder；若服务有认证，请使用它要求的密钥。', 'For a local service that does not validate keys, the current Harness compatibility layer accepts local-placeholder. If the service requires authentication, use its required key.'],
  'models.protocolHint': ['支持 OpenAI Chat Completions、OpenAI Responses 与 Anthropic Messages。工具调用和图片能力取决于所选模型与接口。', 'Supports OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. Tool calling and image support depend on the selected model and API.'],
  'models.sharedHint': ['模型配置由 Harness 保存，同一运行时的标签页共用。', 'Harness saves model settings shared by tabs using the same runtime.'],
  'models.runtimeHint': ['运行时就绪后可以打开模型配置。也可以先稍后配置。', 'Open model configuration once the runtime is ready, or configure later.'],
  'models.openSettings': ['模型设置', 'Model settings'],
  'models.openFailed': ['无法打开 Harness 模型设置。请在当前会话内打开“设置 → 模型”，或重试。', 'Could not open Harness model settings. Open Settings → Models in the current session, or retry.'],
  'models.unavailable': ['当前 Harness 界面没有兼容的模型入口。请在会话内打开“设置 → 模型”，或检查运行时版本。', 'This Harness interface has no compatible model entry. Open Settings → Models in the session, or check the runtime version.'],
  'models.blocked': ['当前会话有尚未完成的弹窗或已填写的配置。请先完成或关闭它，再重试模型入口。', 'The current session has an unfinished dialog or a filled configuration form. Complete or close it, then retry the model entry.'],
  'models.navigationTimeout': ['打开模型设置超时，请重试。', 'Opening model settings timed out. Please retry.']
} as const
