# Model icons

Local, monochrome marks used by `ModelIcon`. They are applied as a CSS mask so
the tile inherits the current text color and works in both themes.

| File | Model families | Source |
| --- | --- | --- |
| `meta.svg` | `llama`, `muse` | [LobeHub Icons](https://github.com/lobehub/lobe-icons) |
| `mistral.svg` | `ministral`, `mistral` | LobeHub Icons |
| `qwen.svg` | `qwen` | LobeHub Icons |
| `openai.svg` | `gpt`, `gpt-oss` | LobeHub Icons |
| `microsoft.svg` | `phi` | LobeHub Icons |
| `gemma.svg` | `gemma` | LobeHub Icons |
| `nvidia.svg` | `nemotron` | LobeHub Icons |
| `zhipu.svg` | `glm` | LobeHub Icons |
| `minimax.svg` | `minimax` | LobeHub Icons |
| `thinking-machines.svg` | `inkling` | [models.dev](https://models.dev/logos/thinkingmachines.svg) |
| `deepseek.svg` | `deepseek` | LobeHub Icons |
| `hunyuan.svg` | `hy` | LobeHub Icons |
| `xiaomimimo.svg` | `mimo` | LobeHub Icons |
| `kimi.svg` | `kimi` | LobeHub Icons |
| `claude.svg` | `claude` | LobeHub Icons |
| `gemini.svg` | `gemini` | LobeHub Icons |
| `grok.svg` | `grok` | LobeHub Icons |
| `cohere.svg` | `command` | LobeHub Icons |

The icons themselves remain trademarks of their respective owners. The
`@lobehub/icons-static-svg` collection is MIT-licensed and model marks are
provided for identification; confirm the brand guidelines before any use that
suggests endorsement. `MODEL_FAMILY_AVATARS` in
`packages/core/src/model-registry.ts` maps a family to its file, and every
registry entry inherits that `avatarUrl`.
