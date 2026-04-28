# Electron 端侧 AI 启动器意图识别调研交付

日期：2026-04-28

## 结论

严格按当前红线，现成可直接采用的模型方案为 0。

可落地路线是自研一个轻量中文多任务模型：

```text
uer/chinese_roberta_L-4_H-256
  -> 中文剪贴板/启动器语料多任务微调
  -> 单个 ONNX graph
  -> q8 动态量化
  -> Electron Renderer Worker
  -> ONNX Runtime Web WASM/SIMD
```

同一个模型输出两个头：

- `intent_logits`：文本意图分类。
- `token_logits`：BIO 序列标注实体抽取。

产品实时链路不应每次输入都跑 Transformer。推荐先用规则、词典和轻量分类器覆盖确定性场景，再把模糊文本交给小型 ONNX 模型。

```text
Clipboard/Input
  -> text normalizer
  -> deterministic extractors
  -> lightweight intent classifier
  -> optional ONNX token classifier
  -> plugin matcher
  -> extension action
```

## 红线核验

| 红线 | 结论 |
|---|---|
| 单模型量化后 <=50MB，优先 <=30MB | 自研 `L-4_H-256` q8 ONNX 有机会满足；现成通用模型多数不满足。 |
| Electron 跨平台纯 JS/WASM 离线 | ONNX Runtime Web WASM 支持 Electron frontend，可随包离线。 |
| 中文意图分类 + 中文 NER + 自定义标签 | 现成模型不满足；自研多任务微调可以满足。 |
| i5/R5 单条 <=20ms，内存 <=200MB | 内存有机会满足；<=20ms 必须 PoC 实测，公开资料不足以承诺。 |
| 剪贴板常见中文场景 | 推荐规则抽取覆盖主场景，模型处理语义歧义和自定义插件。 |
| 商用免费授权 | UER-py 仓库为 Apache-2.0；需在模型卡/权重来源做最终法务确认。 |

## 模型选型对比

| 候选 | 体积/参数 | 能力 | 授权 | JS/WASM 兼容 | 判断 |
|---|---:|---|---|---|---|
| `uer/chinese_roberta_L-2_H-128` | PyTorch 权重约 12.8MB | 中文 tiny encoder，可微调分类/NER | UER-py Apache-2.0，HF model card 未显式标注 | BERT/RoBERTa 架构，可转 ONNX | 最轻候选，精度风险较高 |
| `uer/chinese_roberta_L-4_H-128` | PyTorch 权重约 14.4MB | 中文 small encoder | 同上 | 可转 ONNX | 更稳但 hidden 仍小 |
| `uer/chinese_roberta_L-4_H-256` | PyTorch 权重约 35.2MB，约 8.8M 参数 | 体积/精度平衡最好 | 同上 | 可转 ONNX + q8 | 推荐主候选 |
| `voidful/albert_chinese_tiny` / `clue/albert_chinese_tiny` | 约 4.14M 参数，约 16.6MB | 中文 ALBERT tiny | 授权不够清晰 | ALBERT 可转 ONNX，但 tokenizer/Transformers.js 需验证 | 授权红线不稳，暂不推荐 |
| `ckiplab/albert-tiny-chinese-ner` | 约 16MB | 现成中文 NER，偏繁中 | GPL-3.0 | 可转 ONNX | 排除：GPL-3.0 + NER-only |
| `ckiplab/bert-tiny-chinese-ner` | 约 45.9MB | 现成中文 NER，偏繁中 | GPL-3.0 | 可转 ONNX | 排除：GPL-3.0 + NER-only |
| `google-bert/bert-base-chinese` | 原始权重约 400MB 级 | 中文基础能力稳定 | Apache-2.0 | 可转 ONNX | 排除：体积超红线 |
| GLiNER small/multilingual | 166M+ 参数 | 自定义实体能力强 | Apache-2.0 | 依赖路线不适合纯前端小体积 | 排除：体积和运行约束不满足 |
| fastText / 线性分类器 | KB-MB 级 | 意图分类极快 | MIT | WASM 可行 | 只能做 intent，不能单独满足 NER 红线 |

## 推荐模型结构

### 输入输出

输入：

- `input_ids`: 固定 `max_length = 64`，MVP 可先限制到 128 字以内。
- `attention_mask`
- `token_type_ids`，如果导出模型需要。

输出：

- `intent_logits`: `[batch, intent_count]`
- `token_logits`: `[batch, seq_len, entity_label_count]`

### 初始意图标签

- `open_url`
- `call_phone`
- `send_email`
- `open_map`
- `track_package`
- `create_schedule`
- `translate`
- `search_web`
- `open_app`
- `run_plugin`
- `summarize`
- `unknown`

### 初始实体类型

- `URL`
- `PHONE`
- `EMAIL`
- `ADDRESS`
- `DATETIME`
- `FLIGHT_NO`
- `TRACKING_NO`
- `TAO_PASSWORD`
- `APP_NAME`
- `MONEY`
- `PERSON`
- `ORG`

NER 使用 BIO 标签，例如 `B-ADDRESS`、`I-ADDRESS`、`O`。

## 技术落地方案

### 推理栈

推荐：

- 主推理层：`onnxruntime-web/wasm`
- 运行位置：Electron renderer `Worker`
- 加速：默认 WASM SIMD；WASM threads 作为可探测能力开启
- 模型分发：模型、tokenizer、wasm 文件随应用资源打包
- Transformers.js：只用于原型、tokenizer 验证和模型生态，不作为唯一底座
- WebGPU/WebNN：可选实验加速，不作为 MVP 红线依赖

### Electron 集成边界

```text
main process
  clipboard read / window wake / plugin execution boundary

preload
  typed launcher-intelligence API only

renderer
  input UI / debounce / display

worker
  model session / tokenizer / inference scheduler
```

不要让 renderer 直接调用任意 IPC channel。AI 能力应收口为一个明确的 launcher intelligence host。

### 剪贴板读取

主进程使用 Electron `clipboard.readText()` 读取文本，launcher 唤醒时触发一次：

```ts
import { clipboard } from "electron"

export function readLauncherClipboardText(): string {
  return clipboard.readText().trim()
}
```

唤醒链路：

```text
globalShortcut / native island / tray
  -> show launcher window
  -> main reads clipboard
  -> send typed clipboard context to renderer
  -> renderer posts text to worker
```

### 实时输入调度

建议策略：

- 输入变化后 40-80ms debounce。
- 文本长度小于 2 时不跑模型。
- 已命中强规则时可以只跑轻量 intent，不跑 NER。
- Worker 内部维护单飞队列，只保留最新输入。
- session warmup 在 launcher 首次显示或 app idle 后执行。
- 固定 `max_length=64`，避免动态 shape 带来的抖动。

Worker 伪代码：

```ts
let latestJobId = 0

self.onmessage = async (event) => {
  const jobId = ++latestJobId
  const input = normalize(event.data.text)
  const deterministic = extractDeterministicEntities(input)

  if (jobId !== latestJobId) return

  const modelResult = deterministic.isStrongMatch
    ? classifyIntentOnly(input)
    : await runOnnxIntentAndNer(input)

  if (jobId !== latestJobId) return

  self.postMessage({
    jobId,
    result: mergeSignals(deterministic, modelResult)
  })
}
```

### 插件匹配

插件注册不直接依赖模型标签，而是声明可匹配的 intent/entity 条件：

```ts
export interface LauncherIntentPlugin {
  id: string
  title: string
  match: {
    intents: string[]
    requiredEntities?: string[]
    optionalEntities?: string[]
    minConfidence?: number
  }
  action: {
    commandId: string
    argumentsFromEntities: Record<string, string>
  }
}
```

匹配流程：

```text
recognition result
  -> confidence gate
  -> required entity check
  -> plugin priority score
  -> command preview
  -> user confirm / direct action
```

### 规则抽取建议

规则层负责高精度、低延迟场景：

- URL：标准 URL 和裸域名。
- 手机号：中国大陆手机号。
- 邮箱：RFC 近似即可。
- 航班号：航司二字码 + 数字。
- 快递单号：长度/字符规则 + 可选快递公司规则。
- 日期时间：今天、明天、下周三、2026-05-01 14:00。
- 淘口令：常见包裹字符形态。
- 地址：规则只能做候选抽取，最终建议模型或地址 parser 补充。

## 微调与集成指南

### 数据集准备

目标 MVP 数据量：

- 每个 intent 300-800 条短文本。
- 每个 entity 类型 300+ 个覆盖样本。
- 负样本/unknown 至少占 15%-25%。
- 真实剪贴板文本要脱敏。

样本格式：

```json
{
  "text": "明天下午三点提醒我给张三打电话 13800138000",
  "intent": "create_schedule",
  "entities": [
    { "type": "DATETIME", "start": 0, "end": 6 },
    { "type": "PERSON", "start": 10, "end": 12 },
    { "type": "PHONE", "start": 15, "end": 26 }
  ]
}
```

### 训练步骤

1. 用 `uer/chinese_roberta_L-4_H-256` 初始化 encoder。
2. 添加 intent classification head。
3. 添加 token classification head。
4. 多任务 loss：`loss = intent_loss + token_loss * 1.0`。
5. dev set 同时看 intent accuracy/F1、entity span F1、端侧延迟。
6. 输出 PyTorch 权重。
7. 导出 ONNX。
8. q8 动态量化。
9. Electron benchmark。

### 验收指标

上线前必须实测：

- macOS Intel/Apple Silicon、Windows Intel/AMD、Linux Intel/AMD。
- warm inference p50/p95。
- cold session load time。
- renderer/worker memory delta。
- 连续输入 60 秒 CPU 占用。
- 离线模式下禁网启动和推理。

最低建议门槛：

- 规则命中场景 p95 < 5ms。
- 模型兜底场景 p95 < 20ms，若未达标则改为 80ms debounce + 异步建议。
- worker 常驻内存增量 < 200MB。
- 模型文件 <=50MB，目标 <=30MB。

## 风险与规避

| 风险 | 影响 | 规避 |
|---|---|---|
| 现成模型不满足全部红线 | 无法直接开发 | 走自研微调小模型 |
| 20ms 无公开证明 | 不能承诺实时体验 | 先做 benchmark gate |
| 中文地址/时间表达复杂 | 误识别 | 规则 + 领域样本 + 低置信度提示 |
| 授权不清 | 商用风险 | 只采用明确 Apache-2.0/MIT 来源，保留模型卡和 commit 证据 |
| WASM threads 不稳定 | 性能波动 | 单线程/SIMD baseline，可探测开启 threads |
| WebGPU/WebNN 平台差异 | 线上兼容性 | 只作为实验加速 |

## 资料来源

- ONNX Runtime Web tutorial: <https://onnxruntime.ai/docs/tutorials/web/>
- ONNX Runtime Web build docs: <https://onnxruntime.ai/docs/build/web.html>
- ONNX Runtime Web env flags: <https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html>
- ONNX Runtime Web performance diagnosis: <https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html>
- ONNX Runtime GitHub license: <https://github.com/microsoft/onnxruntime>
- Transformers.js README: <https://github.com/huggingface/transformers.js>
- Transformers.js env docs: <https://huggingface.co/docs/transformers.js/v3.0.0/api/env>
- Transformers.js custom models: <https://huggingface.co/docs/transformers.js/v3.0.0/custom_usage>
- fastText WebAssembly docs: <https://fasttext.cc/docs/en/webassembly-module.html>
- fastText.zip paper: <https://arxiv.org/abs/1612.03651>
- fastText GitHub license: <https://github.com/facebookresearch/fastText>
- UER `chinese_roberta_L-2_H-128`: <https://huggingface.co/uer/chinese_roberta_L-2_H-128>
- UER `chinese_roberta_L-4_H-128`: <https://huggingface.co/uer/chinese_roberta_L-4_H-128>
- UER `chinese_roberta_L-4_H-256`: <https://huggingface.co/uer/chinese_roberta_L-4_H-256>
- UER-py license: <https://github.com/dbiir/UER-py>
- Google BERT base Chinese model card: <https://huggingface.co/google-bert/bert-base-chinese>
- GLiNER small model card: <https://huggingface.co/urchade/gliner_small-v2.1>
- brightmart Chinese ALBERT notes: <https://github.com/brightmart/albert_zh>

