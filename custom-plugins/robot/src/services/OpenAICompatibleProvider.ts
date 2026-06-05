import type {
  AIModelConfig,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamHandler,
  AIAdapterError
} from '@opentiny/tiny-robot-kit'
import { BaseModelProvider, ErrorType } from '@opentiny/tiny-robot-kit'
import { formatMessages } from '../utils'

interface AxiosRequestConfig {
  url: string
  method: string
  baseURL?: string
  headers: Record<string, string>
  data?: unknown
  signal?: AbortSignal
  adapter?: (config: AxiosRequestConfig) => Promise<unknown>
}

interface AxiosInstance {
  request: (config: AxiosRequestConfig) => Promise<{ data: unknown }>
}

interface ChatCompletionRequestOptions {
  options?: {
    model?: string
    apiUrl?: string
    signal?: AbortSignal
    beforeRequest?: (request: ChatRequestData) => ChatRequestData | Promise<ChatRequestData>
  }
}

// 定义请求数据类型
export interface ChatRequestData {
  model: string
  messages: unknown[]
  stream: boolean
  [key: string]: unknown
}

export type ProviderConfig = Omit<AIModelConfig, 'provider' | 'providerImplementation'> & {
  apiUrl?: string
  httpClientType?: 'axios' | 'fetch'
  axiosClient?: AxiosInstance | (() => AxiosInstance)
  beforeRequest?: (request: ChatRequestData) => ChatRequestData | Promise<ChatRequestData>
}

type NormalizedFinishReason = 'stop' | 'tool_calls' | 'aborted' | 'error' | 'unknown'

interface ThinkContentState {
  inThinking: boolean
  pendingContent: string
}

type NormalizedDeltaSegment = {
  content?: string
  reasoning_content?: string
}

export class OpenAICompatibleProvider extends BaseModelProvider {
  private apiUrl: string = 'https://api.openai.com/v1/chat/completions'
  private apiKey: string = ''
  private defaultModel: string = 'gpt-3.5-turbo'
  private beforeRequest: (request: ChatRequestData) => ChatRequestData | Promise<ChatRequestData> = (req) => req
  private httpClientType: 'axios' | 'fetch' = 'fetch'
  private axiosClient: AxiosInstance | (() => AxiosInstance) | undefined

  /**
   * @param config AI模型配置
   * @param options 额外选项
   */
  constructor(providerConfig: ProviderConfig) {
    const { beforeRequest, httpClientType, axiosClient, ...config } = providerConfig
    super(config as AIModelConfig)
    this.setConfig(providerConfig)
  }

  /**
   * 将错误转换为AIAdapterError格式
   * @private
   */
  private toAIAdapterError(error: unknown): AIAdapterError {
    if (!(error instanceof Error)) {
      return {
        type: ErrorType.UNKNOWN_ERROR,
        message: String(error)
      }
    }

    const message = error.message.toLowerCase()
    let type = ErrorType.UNKNOWN_ERROR
    let statusCode: number | undefined

    if (message.includes('http error')) {
      const statusMatch = message.match(/status:\s*(\d+)/)
      if (statusMatch) {
        statusCode = parseInt(statusMatch[1], 10)
        const statusMap: Record<number, ErrorType> = {
          401: ErrorType.AUTHENTICATION_ERROR,
          403: ErrorType.AUTHENTICATION_ERROR,
          429: ErrorType.RATE_LIMIT_ERROR
        }
        type = statusMap[statusCode] || (statusCode >= 500 ? ErrorType.SERVER_ERROR : ErrorType.NETWORK_ERROR)
      }
    } else {
      const keywordMap: Record<string, ErrorType> = {
        network: ErrorType.NETWORK_ERROR,
        fetch: ErrorType.NETWORK_ERROR,
        timeout: ErrorType.TIMEOUT_ERROR
      }

      for (const [keyword, errorType] of Object.entries(keywordMap)) {
        if (message.includes(keyword)) {
          type = errorType
          break
        }
      }
    }

    return {
      type,
      message: error.message,
      statusCode,
      originalError: error
    }
  }

  /**
   * 构建请求头
   * @private
   */
  private buildHeaders(isStream = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }

    if (isStream) {
      headers.Accept = 'text/event-stream'
    }

    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }

    return headers
  }

  /**
   * 准备请求数据
   * @private
   */
  private async prepareRequestData(
    request: Omit<ChatCompletionRequest, 'options'> & ChatCompletionRequestOptions,
    isStream: boolean
  ): Promise<ChatRequestData> {
    const messages = formatMessages(JSON.parse(JSON.stringify(request.messages)))

    const requestData: ChatRequestData = {
      model: request.options?.model || this.config.defaultModel || this.defaultModel,
      messages,
      stream: isStream
    }

    const beforeRequest = request.options?.beforeRequest || this.beforeRequest
    return beforeRequest(requestData)
  }

  /**
   * 创建Axios适配器，使用fetch实现
   * @private
   */
  private createFetchAdapter(isStream = false) {
    return async (config: AxiosRequestConfig) => {
      // 构建完整URL
      let url = config.url
      if (!url.startsWith('http') && config.baseURL) {
        const baseURL =
          config.baseURL.startsWith('http') && !config.baseURL.endsWith('/') ? `${config.baseURL}/` : config.baseURL
        url = new URL(url, baseURL).href
      }

      try {
        const fetchResponse = await fetch(url, {
          method: config.method.toUpperCase(),
          headers: config.headers,
          body: config.data as string,
          signal: config.signal
        })

        if (!fetchResponse.ok) {
          const errorText = await fetchResponse.text()
          const customError: any = new Error(
            `HTTP error! status: ${fetchResponse.status}${errorText ? ', details: ' + errorText : ''}`
          )
          customError.response = fetchResponse
          throw customError
        }

        if (isStream) {
          // 流式响应处理
          return {
            data: { response: fetchResponse },
            status: fetchResponse.status,
            statusText: fetchResponse.statusText,
            headers: fetchResponse.headers,
            config
          }
        }

        // 非流式响应处理
        let responseData: unknown
        try {
          responseData = await fetchResponse.json()
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          throw new Error(`Failed to parse response JSON: ${errorMessage}`)
        }

        return {
          data: responseData,
          status: fetchResponse.status,
          statusText: fetchResponse.statusText,
          headers: fetchResponse.headers,
          config
        }
      } catch (error) {
        // 增强错误信息
        if (error instanceof Error) {
          throw error
        }
        throw new Error(`Request failed: ${String(error)}`)
      }
    }
  }

  /**
   * 使用 fetch 发送请求
   * @private
   */
  private async sendFetchRequest(
    requestData: ChatRequestData,
    headers: Record<string, string>,
    {
      signal,
      apiUrl
    }: {
      signal?: AbortSignal
      apiUrl?: string
    } = {}
  ): Promise<Response> {
    const response = await fetch(apiUrl || this.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestData),
      signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      const customError: any = new Error(
        `HTTP error! status: ${response.status}${errorText ? ', details: ' + errorText : ''}`
      )
      customError.response = response

      throw customError
    }

    return response
  }

  /**
   * 使用 axios 发送请求
   * @private
   */
  private async sendAxiosRequest(
    requestData: ChatRequestData,
    headers: Record<string, string>,
    {
      isStream,
      signal,
      apiUrl
    }: {
      isStream: boolean
      signal?: AbortSignal
      apiUrl?: string
    } = { isStream: true }
  ): Promise<unknown> {
    if (!this.axiosClient) {
      throw new Error('Axios client is not configured')
    }

    const requestOptions: AxiosRequestConfig = {
      method: 'POST',
      url: apiUrl || this.apiUrl,
      headers,
      data: requestData,
      signal,
      adapter: this.createFetchAdapter(isStream)
    }

    const axiosClient = typeof this.axiosClient === 'function' ? this.axiosClient() : this.axiosClient
    return await axiosClient.request(requestOptions)
  }

  // New API 兼容：有些网关 EOF 前不发 [DONE]，或者 finish_reason 固定是 unknown。
  // 这里基于本轮已经收到的内容，给上层输出统一的结束语义。
  private normalizeStreamFinishReason(
    finishReason: string | undefined,
    streamState: { hasContent: boolean; hasReasoningContent: boolean; hasToolCalls: boolean },
    signal?: AbortSignal
  ): NormalizedFinishReason | string {
    if (signal?.aborted || finishReason === 'aborted') {
      return 'aborted'
    }

    if (finishReason === 'error') {
      return 'error'
    }

    if (finishReason && finishReason !== 'unknown') {
      return finishReason
    }

    if (streamState.hasToolCalls) {
      return 'tool_calls'
    }

    if (streamState.hasContent || streamState.hasReasoningContent) {
      return 'stop'
    }

    return 'unknown'
  }

  // 避免流式 chunk 正好把 <think> / </think> 标签切断时，把半截标签当正文吐出去。
  private getSafeTextEnd(content: string, startIndex: number, tags: string[]) {
    const remaining = content.slice(startIndex).toLowerCase()
    let keepLength = 0

    tags.forEach((tag) => {
      for (let length = 1; length < tag.length && length <= remaining.length; length++) {
        if (tag.startsWith(remaining.slice(-length))) {
          keepLength = Math.max(keepLength, length)
        }
      }
    })

    return content.length - keepLength
  }

  // 部分 OpenAI-compatible 网关/模型会把思考过程包在普通 content 的 <think>...</think> 中。
  // 在 provider 层拆成 reasoning_content，复用现有深度思考 UI，并避免标签污染 JSON Patch。
  private parseThinkContent(content: string, thinkState: ThinkContentState): NormalizedDeltaSegment[] {
    const openTag = '<think>'
    const closeTag = '</think>'
    const segments: NormalizedDeltaSegment[] = []
    const source = thinkState.pendingContent + content
    const lowerSource = source.toLowerCase()
    let cursor = 0

    while (cursor < source.length) {
      if (thinkState.inThinking) {
        const closeIndex = lowerSource.indexOf(closeTag, cursor)
        if (closeIndex === -1) {
          const safeEnd = this.getSafeTextEnd(source, cursor, [closeTag])
          if (safeEnd > cursor) {
            segments.push({ reasoning_content: source.slice(cursor, safeEnd) })
          }
          thinkState.pendingContent = source.slice(safeEnd)
          return segments
        }

        if (closeIndex > cursor) {
          segments.push({ reasoning_content: source.slice(cursor, closeIndex) })
        }
        cursor = closeIndex + closeTag.length
        thinkState.inThinking = false
      } else {
        const openIndex = lowerSource.indexOf(openTag, cursor)
        if (openIndex === -1) {
          const safeEnd = this.getSafeTextEnd(source, cursor, [openTag])
          if (safeEnd > cursor) {
            segments.push({ content: source.slice(cursor, safeEnd) })
          }
          thinkState.pendingContent = source.slice(safeEnd)
          return segments
        }

        if (openIndex > cursor) {
          segments.push({ content: source.slice(cursor, openIndex) })
        }
        cursor = openIndex + openTag.length
        thinkState.inThinking = true
      }
    }

    thinkState.pendingContent = ''
    return segments
  }

  private flushThinkContent(thinkState: ThinkContentState): NormalizedDeltaSegment[] {
    if (!thinkState.pendingContent) {
      return []
    }

    const content = thinkState.pendingContent
    thinkState.pendingContent = ''
    return thinkState.inThinking ? [{ reasoning_content: content }] : [{ content }]
  }

  // 保留原始 chunk 的 id/model/finish_reason 等元信息，只替换第一个 choice 的 delta 内容。
  private createStreamDataWithDelta(data: any, deltaSegment: NormalizedDeltaSegment) {
    const choices = data.choices?.map((choice: any, index: number) => {
      if (index !== 0) {
        return choice
      }

      const delta = { ...choice.delta }
      delete delta.content
      delete delta.reasoning_content

      if (deltaSegment.content !== undefined) {
        delta.content = deltaSegment.content
      }
      if (deltaSegment.reasoning_content !== undefined) {
        delta.reasoning_content = deltaSegment.reasoning_content
      }

      return { ...choice, delta }
    })

    return { ...data, choices }
  }

  // 统一 provider 输出：补齐结束语义，并把非标准 <think> 内容转换为标准 reasoning_content。
  private createNormalizedStreamHandler(handler: StreamHandler, signal?: AbortSignal): StreamHandler {
    const streamState = {
      hasContent: false,
      hasReasoningContent: false,
      hasToolCalls: false
    }
    const thinkState: ThinkContentState = {
      inThinking: false,
      pendingContent: ''
    }

    const emitData = (data: any, deltaSegment?: NormalizedDeltaSegment) => {
      const nextData = deltaSegment ? this.createStreamDataWithDelta(data, deltaSegment) : data
      const choice = nextData?.choices?.[0]
      const delta = choice?.delta

      if (typeof delta?.content === 'string' && delta.content) {
        streamState.hasContent = true
      }

      if (typeof delta?.reasoning_content === 'string' && delta.reasoning_content) {
        streamState.hasReasoningContent = true
      }

      if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length) {
        streamState.hasToolCalls = true
      }

      if (choice?.finish_reason === 'tool_calls') {
        streamState.hasToolCalls = true
      }

      handler.onData(nextData)
    }

    return {
      onData: (data) => {
        const choice = data?.choices?.[0]
        const delta = choice?.delta

        if (typeof delta?.content === 'string') {
          const segments = this.parseThinkContent(delta?.content ?? '', thinkState)
          segments.forEach((segment) => emitData(data, segment))
          if (!segments.length && (delta?.tool_calls?.length || choice?.finish_reason)) {
            emitData(this.createStreamDataWithDelta(data, {}))
          }
          return
        }

        emitData(data)
      },
      onError: (error) => handler.onError(error),
      onDone: (finishReason) => {
        this.flushThinkContent(thinkState).forEach((segment) => {
          emitData({ choices: [{ delta: {} }] }, segment)
        })
        handler.onDone(this.normalizeStreamFinishReason(finishReason, streamState, signal))
      }
    }
  }

  // 本地 SSE 解析器：兼容标准 [DONE]、finish_reason 后直接 EOF、以及 CRLF 分隔。
  private async handleSSEStream(response: Response, handler: StreamHandler, signal?: AbortSignal): Promise<void> {
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Response body is null')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let latestFinishReason: string | undefined
    let doneHandled = false

    const emitDone = (finishReason?: string) => {
      if (doneHandled) {
        return
      }
      doneHandled = true
      handler.onDone(finishReason)
    }

    // 返回 false 表示本轮 SSE 已进入终态，外层读取循环需要停止，避免 EOF 再补一次 stop。
    const processEvent = (event: string) => {
      const trimmedEvent = event.trim()
      if (!trimmedEvent) {
        return true
      }

      const dataLines = trimmedEvent
        .split(/\r?\n/)
        .filter((line) => line.trimStart().startsWith('data:'))
        .map((line) => line.replace(/^\s*data:\s?/, ''))

      if (!dataLines.length) {
        return true
      }

      const dataText = dataLines.join('\n').trim()

      if (dataText === '[DONE]') {
        emitDone(latestFinishReason)
        return false
      }

      try {
        const data = JSON.parse(dataText)
        handler.onData(data)
        latestFinishReason = data.choices?.[0]?.finish_reason || latestFinishReason
        return true
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Error parsing SSE message:', error, event)
        // SSE data 帧已经损坏时要进入 error 终态，避免 EOF 再被归一成 stop。
        handler.onError(error)
        emitDone('error')
        return false
      }
    }

    signal?.addEventListener(
      'abort',
      () => {
        reader.cancel().catch((error) => console.error('Error cancelling reader:', error))
      },
      { once: true }
    )

    try {
      let shouldContinue = true
      while (shouldContinue) {
        if (signal?.aborted) {
          await reader.cancel()
          emitDone('aborted')
          break
        }

        const { done, value } = await reader.read()
        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() || ''
        for (const event of events) {
          if (!processEvent(event)) {
            shouldContinue = false
            break
          }
        }
      }

      const remaining = `${buffer}${decoder.decode()}`
      if (shouldContinue && remaining.trim()) {
        processEvent(remaining)
      }

      if (signal?.aborted) {
        emitDone('aborted')
      } else {
        // 如果服务端没有发 [DONE]，正常 EOF 也要把最后记录到的 finish_reason 传给上层。
        emitDone(latestFinishReason)
      }
    } catch (error) {
      if (signal?.aborted) {
        emitDone('aborted')
        return
      }
      throw error
    }
  }

  /**
   * 发送聊天请求并获取响应
   * @param request 聊天请求参数
   * @returns 聊天响应
   */
  async chat(
    request: Omit<ChatCompletionRequest, 'options'> & ChatCompletionRequestOptions
  ): Promise<ChatCompletionResponse> {
    const { signal, apiUrl } = request.options || {}
    try {
      // 准备请求数据
      const requestData = await this.prepareRequestData(request, false)
      const headers = this.buildHeaders(false)

      if (this.httpClientType === 'axios' && this.axiosClient) {
        // 使用 axios 发送请求
        const response = await this.sendAxiosRequest(requestData, headers, {
          isStream: false,
          apiUrl,
          signal
        })
        return (response as { data: ChatCompletionResponse }).data || response
      } else {
        // 使用 fetch 发送请求
        const response = await this.sendFetchRequest(requestData, headers, { apiUrl, signal })
        return await response.json()
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Error in chat request: ${errorMessage}`)
    }
  }

  /**
   * 发送流式聊天请求并通过处理器处理响应
   * @param request 聊天请求参数
   * @param handler 流式响应处理器
   */
  async chatStream(
    request: Omit<ChatCompletionRequest, 'options'> & ChatCompletionRequestOptions,
    handler: StreamHandler
  ): Promise<void> {
    const { signal, apiUrl } = request.options || {}
    const streamHandler = this.createNormalizedStreamHandler(handler, signal)

    try {
      // 准备请求数据
      const requestData = await this.prepareRequestData(request, true)
      const headers = this.buildHeaders(true)

      if (this.httpClientType === 'axios' && this.axiosClient) {
        // 使用 axios 发送流式请求
        const response = await this.sendAxiosRequest(requestData, headers, { isStream: true, signal, apiUrl })
        const fetchResponse = (
          (response as { data: { response: Response } }).data || (response as { response: Response })
        ).response
        await this.handleSSEStream(fetchResponse, streamHandler, signal)
      } else {
        // 使用 fetch 发送流式请求
        const response = await this.sendFetchRequest(requestData, headers, { signal, apiUrl })
        await this.handleSSEStream(response, streamHandler, signal)
      }
    } catch (error: unknown) {
      // 如果是用户主动取消，不报错
      if (signal?.aborted) {
        return
      }
      throw error
    }
  }

  setConfig(providerConfig: ProviderConfig): void {
    const { beforeRequest, httpClientType, axiosClient, ...config } = providerConfig

    // 更新基础配置
    super.updateConfig(config as AIModelConfig)

    if (config.apiUrl) {
      this.apiUrl = config.apiUrl
    }

    // apikey允许为空
    if (typeof config.apiKey === 'string') {
      this.apiKey = config.apiKey
    }

    if (config.defaultModel) {
      this.defaultModel = config.defaultModel
    }

    if (beforeRequest) {
      this.beforeRequest = beforeRequest
    }

    if (httpClientType === 'axios' && axiosClient) {
      this.httpClientType = 'axios'
      this.axiosClient = axiosClient
    } else if (httpClientType) {
      this.httpClientType = 'fetch'
    }

    // 验证配置
    if (this.httpClientType === 'axios' && !this.axiosClient) {
      throw new Error('axiosClient is required when httpClientType is axios')
    }
  }

  getBaseConfig(): ProviderConfig {
    return {
      apiKey: this.apiKey,
      apiUrl: this.apiUrl,
      defaultModel: this.defaultModel,
      httpClientType: this.httpClientType
    }
  }

  /**
   * 更新配置
   * @param config 新的AI模型配置
   */
  updateConfig(config: ProviderConfig): void {
    this.setConfig(config)
  }
}
