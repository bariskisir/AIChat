/** Provider template list for quick OpenAI-compatible setup. */

namespace ProviderTemplates {
  export interface Template {
    name: string;
    apiUrl: string;
  }

  export const items: Template[] = [
    { name: "abacus", apiUrl: "https://routellm.abacus.ai/v1" },
    { name: "aihubmix", apiUrl: "https://aihubmix.com/v1" },
    { name: "chutes", apiUrl: "https://llm.chutes.ai/v1" },
    { name: "cortecs", apiUrl: "https://api.cortecs.ai/v1" },
    { name: "deepinfra", apiUrl: "https://api.deepinfra.com/v1" },
    { name: "fastrouter", apiUrl: "https://go.fastrouter.ai/api/v1" },
    { name: "friendli", apiUrl: "https://api.friendli.ai/serverless/v1" },
    { name: "helicone", apiUrl: "https://ai-gateway.helicone.ai/v1" },
    { name: "huggingface", apiUrl: "https://router.huggingface.co/v1" },
    { name: "inception", apiUrl: "https://api.inceptionlabs.ai/v1" },
    { name: "ionet", apiUrl: "https://api.intelligence.io.solutions/api/v1" },
    { name: "moark", apiUrl: "https://moark.com/v1" },
    { name: "modelscope", apiUrl: "https://api-inference.modelscope.cn/v1" },
    { name: "nanogpt", apiUrl: "https://nano-gpt.com/api/v1" },
    { name: "novitaai", apiUrl: "https://api.novita.ai/openai" },
    { name: "nvidia", apiUrl: "https://integrate.api.nvidia.com/v1" },
    { name: "ollamacloud", apiUrl: "https://ollama.com/v1" },
    { name: "opencodezen", apiUrl: "https://opencode.ai/zen/v1" },
    { name: "openrouter", apiUrl: "https://openrouter.ai/api/v1" },
    { name: "ovhcloud", apiUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1" },
    { name: "poe", apiUrl: "https://api.poe.com/v1" },
    { name: "requesty", apiUrl: "https://router.requesty.ai/v1" },
    { name: "synthetic", apiUrl: "https://api.synthetic.new/v1" },
    { name: "zenmux", apiUrl: "https://zenmux.ai/api/v1" },
  ];

  // Finds the first template matching a stored API URL.
  export function byApiUrl(apiUrl: string): Template | undefined {
    const normalized = apiUrl.trim().replace(/\/+$/, "");
    return items.find((item) => item.apiUrl.replace(/\/+$/, "") === normalized);
  }
}
