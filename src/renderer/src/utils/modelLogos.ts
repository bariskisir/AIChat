/** Maps model ids and names to company brand logos. */

import Ai21ModelLogo from '@renderer/assets/models/ai21.png'
import AlibabaModelLogo from '@renderer/assets/models/alibaba.png'
import AmazonModelLogo from '@renderer/assets/models/amazon.png'
import AnthropicModelLogo from '@renderer/assets/models/anthropic.png'
import BaiduModelLogo from '@renderer/assets/models/baidu.png'
import BytedanceModelLogo from '@renderer/assets/models/bytedance.png'
import ChatGptModelLogo from '@renderer/assets/models/openai.png'
import CohereModelLogo from '@renderer/assets/models/cohere.png'
import DeepSeekModelLogo from '@renderer/assets/models/deepseek.png'
import GoogleModelLogo from '@renderer/assets/models/google.png'
import GrypheModelLogo from '@renderer/assets/models/gryphe.png'
import IbmModelLogo from '@renderer/assets/models/ibm.png'
import InclusionAiModelLogo from '@renderer/assets/models/inclusionai.png'
import MetaModelLogo from '@renderer/assets/models/meta.png'
import MicrosoftModelLogo from '@renderer/assets/models/microsoft.png'
import MinimaxModelLogo from '@renderer/assets/models/minimax.png'
import MistralModelLogo from '@renderer/assets/models/mistral.png'
import MoonshotAiModelLogo from '@renderer/assets/models/moonshotai.png'
import NousResearchModelLogo from '@renderer/assets/models/nousresearch.png'
import NvidiaModelLogo from '@renderer/assets/models/nvidia.png'
import PerplexityModelLogo from '@renderer/assets/models/perplexity.png'
import StepFunModelLogo from '@renderer/assets/models/stepfun.png'
import TencentModelLogo from '@renderer/assets/models/tencent.png'
import UpstageModelLogo from '@renderer/assets/models/upstage.png'
import XiaomiModelLogo from '@renderer/assets/models/xiaomi.png'
import XAiModelLogo from '@renderer/assets/models/xai.png'
import ZhipuModelLogo from '@renderer/assets/models/zhipu.png'

/** Resolves a local company logo for a model id via regex. */
export function getModelLogoById(modelId: string): string | undefined {
  if (!modelId) {
    return undefined
  }

  const logoMap = {
    '(minimax|m2-her)': MinimaxModelLogo,
    '(glm|chatglm|zhipu|cogv)': ZhipuModelLogo,
    '(ai21|jamba-)': Ai21ModelLogo,
    deepseek: DeepSeekModelLogo,
    '(ernie|wenxin|tao-|baidu)': BaiduModelLogo,
    '(qwen|qwq|qvq|wan|tongyi|text-embedding-v)': AlibabaModelLogo,
    '(claude|fable|opus|sonnet|haiku|anthropic-)': AnthropicModelLogo,
    '(amazon|nova-)': AmazonModelLogo,
    '(gemini|gemma|palm-|veo|bison|imagen|google)': GoogleModelLogo,
    '(hermes|nous)': NousResearchModelLogo,
    '(llama|meta)': MetaModelLogo,
    '(mistral|mixtral|magistral)': MistralModelLogo,
    '(moonshot|kimi|^k[3-9](?:[-_.]|$))': MoonshotAiModelLogo,
    '(phi|wizardlm|orca|microsoft)': MicrosoftModelLogo,

    '(cohere|command)': CohereModelLogo,
    '(grok|xai)': XAiModelLogo,
    '(hunyuan|tencent)': TencentModelLogo,
    '(step|stepfun)': StepFunModelLogo,
    '(gryphe|mythomax)': GrypheModelLogo,
    '(nvidia|nemotron)': NvidiaModelLogo,
    '(upstage|solar)': UpstageModelLogo,
    '(ibm|granite)': IbmModelLogo,
    '(perplexity|sonar)': PerplexityModelLogo,
    '(bytedance|doubao)': BytedanceModelLogo,
    '(ling|ring|inclusion)': InclusionAiModelLogo,
    '(xiaomi|mimo)': XiaomiModelLogo,
    '(gpt|gpts|o1-|o1/|o3-|o3/|o4-|o4/|omni|sora|davinci|babbage|text-embedding|text-moderation|chatgpt)':
      ChatGptModelLogo,
  } as const satisfies Record<string, string>

  for (const key in logoMap) {
    const regex = new RegExp(key, 'i')
    if (regex.test(modelId)) {
      return logoMap[key as keyof typeof logoMap]
    }
  }

  return undefined
}

/** Source shape accepted for logo resolution: a model id, a display name, or both. */
export interface ModelLogoSource {
  modelId?: string | undefined
  name?: string | undefined
}

/** Resolves a logo for one model source, checking the model id first and the name as fallback. */
export function getModelLogo(model: ModelLogoSource | undefined | null): string | undefined {
  if (!model) return undefined
  return getModelLogoById(model.modelId ?? '') ?? getModelLogoById(model.name ?? '')
}
