import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NEW_API_URL = 'https://your-new-api.example.com/v1/chat/completions'
const NEW_API_API_KEY = 'replace-me'
const NEW_API_IMAGE_URL = ''
const DEFAULT_MODELS = ['Qwen3.6-35B-A3B', 'Qwen3.6-27B', 'Gemma-4-31B-it', 'MiniMax M2.7']
const DEFAULT_THINKING_PAYLOAD = {
  enable_thinking: true,
  thinking_budget: 1000
}
const REQUEST_TIMEOUT_MS = 60_000

const SERVICE_DEFINITION = {
  service_key: 'new-api',
  provider: 'new-api',
  label: '界面编排',
  allow_empty_api_key: false,
  sort: 10
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const outputPath = path.join(scriptDir, 'builtin-services.json')

const log = (level, message) => {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  console.log(`[probeModelCapabilities] [${time}] ${level} ${message}`)
}

class ProbeHttpError extends Error {
  constructor(message, { statusCode, responseSummary, responseJson } = {}) {
    super(message)
    this.name = 'ProbeHttpError'
    this.statusCode = statusCode
    this.responseSummary = responseSummary
    this.responseJson = responseJson
  }
}

const getToday = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

const ensureConfigured = () => {
  const missing = []

  if (!NEW_API_URL || NEW_API_URL.includes('your-new-api.example.com')) {
    missing.push('NEW_API_URL')
  }

  if (!NEW_API_API_KEY || NEW_API_API_KEY === 'replace-me') {
    missing.push('NEW_API_API_KEY')
  }

  if (missing.length) {
    throw new Error(`请先在脚本顶部填写这些常量: ${missing.join(', ')}`)
  }
}

const summarizeText = (text = '', limit = 500) => {
  if (!text) {
    return ''
  }

  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized
}

const parseJson = (text) => {
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const extractAssistantMessage = (responseJson) => responseJson?.choices?.[0]?.message || null

const extractAssistantText = (message) => {
  if (!message) {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.content)) {
    return message.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n')
  }

  return ''
}

const buildHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${NEW_API_API_KEY}`
})

const postChatCompletions = async (payload) => {
  const response = await fetch(NEW_API_URL, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  const responseText = await response.text()
  const responseJson = parseJson(responseText)
  const responseSummary = summarizeText(responseText)

  if (!response.ok) {
    throw new ProbeHttpError(`HTTP ${response.status}`, {
      statusCode: response.status,
      responseSummary,
      responseJson
    })
  }

  if (!responseJson) {
    throw new ProbeHttpError('响应不是合法 JSON', {
      statusCode: response.status,
      responseSummary
    })
  }

  return {
    statusCode: response.status,
    responseJson,
    responseSummary
  }
}

const createBasePayload = (model, content) => ({
  model,
  stream: false,
  messages: [
    {
      role: 'user',
      content
    }
  ]
})

const createVisionPayload = (model) => ({
  model,
  stream: false,
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请简要描述这张图片里有什么，只回答一句话。'
        },
        {
          type: 'image_url',
          image_url: {
            url: NEW_API_IMAGE_URL
          }
        }
      ]
    }
  ]
})

const classifyStatus = (statusCode) => {
  if (statusCode === 429 || statusCode >= 500) {
    return 'environment'
  }

  if (statusCode >= 400) {
    return 'protocol_or_unsupported'
  }

  return 'unknown'
}

const normalizeError = (error) => {
  if (error instanceof ProbeHttpError) {
    return {
      message: error.message,
      statusCode: error.statusCode,
      responseSummary: error.responseSummary || '',
      kind: classifyStatus(error.statusCode)
    }
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    statusCode: null,
    responseSummary: '',
    kind: 'unknown'
  }
}

const runBasicProbe = async (model) => {
  const payload = createBasePayload(model, '你好，请只回复 ok')
  const result = await postChatCompletions(payload)
  const message = extractAssistantMessage(result.responseJson)
  const content = extractAssistantText(message)

  return {
    passed: Boolean(content),
    statusCode: result.statusCode,
    note: content ? '收到有效文本回复' : '接口返回 200，但未提取到文本内容',
    responseSummary: result.responseSummary
  }
}

const runToolCallingProbe = async (model) => {
  const payload = {
    ...createBasePayload(model, '请调用工具 get_weather 查询北京天气，不要直接回答。'),
    tools: [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: '查询天气',
          parameters: {
            type: 'object',
            properties: {
              city: {
                type: 'string',
                description: '城市名'
              }
            },
            required: ['city']
          }
        }
      }
    ]
  }
  const result = await postChatCompletions(payload)
  const message = extractAssistantMessage(result.responseJson)
  const toolCalls = message?.tool_calls

  return {
    passed: Array.isArray(toolCalls) && toolCalls.length > 0,
    statusCode: result.statusCode,
    note: Array.isArray(toolCalls) && toolCalls.length > 0 ? '返回了 tool_calls' : '未返回 tool_calls',
    responseSummary: result.responseSummary
  }
}

const runJsonOutputProbe = async (model) => {
  const payload = {
    ...createBasePayload(model, '请只返回一个合法 JSON 对象，字段 answer 的值为 ok，不要使用 markdown 代码块。'),
    response_format: {
      type: 'json_object'
    }
  }
  const result = await postChatCompletions(payload)
  const message = extractAssistantMessage(result.responseJson)
  const content = extractAssistantText(message)
  const parsed = parseJson(content)

  return {
    passed: Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)),
    statusCode: result.statusCode,
    note: parsed ? '返回内容可解析为 JSON 对象' : '返回内容不是合法 JSON 对象',
    responseSummary: result.responseSummary
  }
}

const runVisionProbe = async (model) => {
  if (!NEW_API_IMAGE_URL) {
    return {
      skipped: true,
      note: '未配置 NEW_API_IMAGE_URL'
    }
  }

  const result = await postChatCompletions(createVisionPayload(model))
  const message = extractAssistantMessage(result.responseJson)
  const content = extractAssistantText(message)

  return {
    passed: Boolean(content),
    statusCode: result.statusCode,
    note: content ? '接口接受图片消息并返回结果' : '接口返回 200，但未提取到图片回答内容',
    responseSummary: result.responseSummary
  }
}

const runReasoningProbe = async (model) => {
  const payload = {
    ...createBasePayload(model, '请简要解释快速排序的核心思路。'),
    ...DEFAULT_THINKING_PAYLOAD
  }
  const result = await postChatCompletions(payload)

  return {
    passed: true,
    statusCode: result.statusCode,
    note: '接口接受 reasoning 探测参数',
    responseSummary: result.responseSummary
  }
}

const runProbe = async (runner) => {
  try {
    return await runner()
  } catch (error) {
    return {
      passed: false,
      ...normalizeError(error)
    }
  }
}

const buildCapabilities = (testResults) => {
  const capabilities = {}

  if (testResults.toolCalling?.passed) {
    capabilities.toolCalling = true
  }

  if (testResults.vision?.passed) {
    capabilities.vision = true
  }

  if (testResults.jsonOutput?.passed) {
    capabilities.jsonOutput = {
      extraBody: {
        enable: {
          response_format: {
            type: 'json_object'
          }
        },
        disable: null
      }
    }
  }

  if (testResults.reasoning?.passed) {
    capabilities.reasoning = {
      extraBody: {
        enable: { ...DEFAULT_THINKING_PAYLOAD },
        disable: null
      }
    }
  }

  return capabilities
}

const createModelEntry = (modelName, testResults) => ({
  name: modelName,
  label: modelName,
  capabilities: buildCapabilities(testResults)
})

const createOutput = (models) => ({
  ...SERVICE_DEFINITION,
  base_url: NEW_API_URL,
  seed_version: getToday(),
  models
})

const formatStatus = (result) => {
  if (!result) {
    return 'N/A'
  }

  if (result.skipped) {
    return 'SKIPPED'
  }

  return result.passed ? 'PASS' : 'FAIL'
}

const printSummary = (reportItems) => {
  console.log('')
  log('INFO', '模型能力探测结果摘要')
  console.table(
    reportItems.map((item) => ({
      model: item.model,
      basic: formatStatus(item.tests.basic),
      toolCalling: formatStatus(item.tests.toolCalling),
      jsonOutput: formatStatus(item.tests.jsonOutput),
      vision: formatStatus(item.tests.vision),
      reasoning: formatStatus(item.tests.reasoning)
    }))
  )

  reportItems.forEach((item) => {
    log('INFO', `模型 ${item.model} 详情`)

    Object.entries(item.tests).forEach(([testName, result]) => {
      const note = result?.note || result?.message || ''
      const statusCode = result?.statusCode ? ` [HTTP ${result.statusCode}]` : ''
      console.log(`  - ${testName}: ${formatStatus(result)}${statusCode}${note ? ` - ${note}` : ''}`)

      if (result?.responseSummary) {
        console.log(`    响应摘要: ${result.responseSummary}`)
      }
    })
  })
}

const writeOutputFile = async (output) => {
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  log('SUCCESS', `已生成 ${outputPath}`)
}

const main = async () => {
  ensureConfigured()

  log('INFO', `探测地址: ${NEW_API_URL}`)
  log('INFO', `输出文件: ${outputPath}`)

  const reportItems = []

  for (const model of DEFAULT_MODELS) {
    log('INFO', `开始探测模型 ${model}`)

    const tests = {
      basic: await runProbe(() => runBasicProbe(model)),
      toolCalling: await runProbe(() => runToolCallingProbe(model)),
      jsonOutput: await runProbe(() => runJsonOutputProbe(model)),
      vision: await runProbe(() => runVisionProbe(model)),
      reasoning: await runProbe(() => runReasoningProbe(model))
    }

    reportItems.push({
      model,
      tests,
      modelEntry: createModelEntry(model, tests)
    })
  }

  printSummary(reportItems)

  const output = createOutput(reportItems.map((item) => item.modelEntry))
  await writeOutputFile(output)

  console.log('')
  log('INFO', 'builtin-services.json 内容预览')
  console.log(JSON.stringify(output, null, 2))
}

main().catch((error) => {
  log('ERROR', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
