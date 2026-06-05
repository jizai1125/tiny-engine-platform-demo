/**
 * Copyright (c) 2023 - present TinyEngine Authors.
 * Copyright (c) 2023 - present Huawei Cloud Computing Technologies Co., Ltd.
 *
 * Use of this source code is governed by an MIT-style license.
 *
 * THE OPEN SOURCE SOFTWARE IN THIS PRODUCT IS DISTRIBUTED IN THE HOPE THAT IT WILL BE USEFUL,
 * BUT WITHOUT ANY WARRANTY, WITHOUT EVEN THE IMPLIED WARRANTY OF MERCHANTABILITY OR FITNESS FOR
 * A PARTICULAR PURPOSE. SEE THE APPLICABLE LICENSES FOR MORE DETAILS.
 *
 */

import { getMetaApi, META_SERVICE, useCanvas, useMaterial } from '@opentiny/tiny-engine-meta-register'
import { utils } from '@opentiny/tiny-engine-utils'
import {
  isValidJsonPatchObjectString,
  getJsonObjectString,
  getRobotServiceOptions,
  removeLoading,
  addSystemPrompt
} from '../../utils'
import { updatePageSchema } from '../core/pageUpdater'
import useModelConfig from '../core/useConfig'
import { formatComponents, getAgentSystemPrompt, getJsonFixPrompt } from '../../constants/prompts'
import { search, fetchAssets } from '../../services/agentServices'
import { client } from '../../services/aiClient'
import type { ModeHooks } from '../../types/mode.types'
import { ChatMode } from '../../types/mode.types'
import { STATUS, type MessageState } from '@opentiny/tiny-robot-kit'

const { deepClone } = utils
const logger = console

const updateToolCallRenderContent = (tool: Record<string, unknown>, renderContent: any[]) => {
  const currentToolCallContent = renderContent.find((item) => item.type === 'tool' && item.toolCallId === tool.id)
  if (currentToolCallContent) {
    currentToolCallContent.status = 'running'
    if (!currentToolCallContent.content) {
      currentToolCallContent.content = {}
    }
    currentToolCallContent.content.params = tool.parsedArgs || tool.function!.arguments || {}
  } else {
    renderContent.push({
      type: 'tool',
      name: tool.name || tool.function!.name,
      status: 'running',
      content: {
        params: tool.parsedArgs || tool.function!.arguments || {}
      },
      formatPretty: true,
      toolCallId: tool.id
    })
  }
}

const ensureLastRenderContent = (message: any, contentType: string, status?: string) => {
  if (!message.renderContent?.length) {
    message.renderContent = [{ type: contentType, content: message.content || '', status: status || '' }]
  }

  const lastRenderContent = message.renderContent.at(-1)
  if (status && lastRenderContent) {
    lastRenderContent.status = status
  }

  return lastRenderContent
}

const finishReasoningRenderContent = (message: any) => {
  message.renderContent?.forEach((item: any) => {
    if (item.contentType === 'reasoning' && item.status === 'reasoning') {
      item.status = 'finish'
    }
  })
}

const removePendingLoadingRenderContent = (message: any) => {
  if (!message.renderContent?.length) {
    return
  }

  message.renderContent = message.renderContent.filter((item: any) => !item.type?.includes('loading'))
}

// AgentRenderer 的 loading/success/failed 只看消息自身 renderContent.status。
// 收尾时必须清掉残留 loading，并补一个明确的 agent-content 结果项。
const ensureAgentResultRenderContent = (message: any, contentType: string, status: 'success' | 'failed') => {
  finishReasoningRenderContent(message)
  removePendingLoadingRenderContent(message)

  if (!message.renderContent?.length) {
    message.renderContent = [{ type: contentType, content: message.content || '', status }]
    return message.renderContent.at(-1)
  }

  let resultRenderContent = message.renderContent.findLast((item: any) => item.type === contentType)
  if (!resultRenderContent) {
    resultRenderContent = { type: contentType, content: message.content || '', status }
    message.renderContent.push(resultRenderContent)
  }

  resultRenderContent.status = status
  if (!resultRenderContent.content) {
    resultRenderContent.content = message.content || ''
  }

  return resultRenderContent
}

/**
 * Agent 模式实现
 * 特点：
 * - 使用 JSON Patch 更新页面 schema
 * - 支持 RAG 上下文和资源上下文
 * - 支持思考模式（thinking）
 * - 实时更新画布
 * - JSON 修复机制
 */
export default function useAgentMode(): ModeHooks {
  let pageSchema: object | null = null
  // 这两个状态只属于当前请求轮次，避免后一轮生成复用上一轮已经渲染过的 schema。
  let streamRunId = 0
  let lastStreamSuccessResult: { schema: object } | null = null
  const { getSelectedModelInfo } = useModelConfig()

  const resetPageGenerateState = () => {
    pageSchema = null
    lastStreamSuccessResult = null
  }

  const markStreamSchemaSuccess = (result: any, currentRunId: number) => {
    if (currentRunId !== streamRunId || !pageSchema || !result?.schema || result.isError) {
      return
    }

    // 流式阶段已成功渲染过页面时，最终修复失败也不能把气泡误判成 failed。
    lastStreamSuccessResult = { schema: result.schema }
  }

  const finishWithStreamSchemaFallback = (message: any, messageState: MessageState) => {
    if (!lastStreamSuccessResult?.schema) {
      return false
    }

    const lastRenderContent = ensureAgentResultRenderContent(message, getContentType(), 'success')
    lastRenderContent.schema = lastStreamSuccessResult.schema
    messageState.status = STATUS.FINISHED
    messageState.errorMsg = ''
    return true
  }

  // ========== 配置方法 ==========
  const getApiUrl = () => 'app-center/api/ai/chat'

  const getContentType = () => 'agent-content'

  const getLoadingType = () => 'agent-loading'

  // ========== 生命周期钩子 ==========
  const onConversationStart = (conversationState: any, messages: any[], apis: any) => {
    const conversation = conversationState.conversations.find((item: any) => item.id === conversationState.currentId)

    // 确保会话元数据中记录为 Agent 模式
    if (!conversation.metadata?.chatMode || conversation.metadata.chatMode !== ChatMode.Agent) {
      apis.updateMetadata(conversationState.currentId, { chatMode: ChatMode.Agent })
      apis.saveConversations()
    }

    // Agent 模式特殊处理：标记失败的 loading
    messages.at(-1)?.renderContent?.forEach((item: any) => {
      if (item.type.includes('loading') || item.status !== 'success') {
        item.status = 'failed'
      }
    })
  }

  const onMessageSent = () => {
    streamRunId++
    lastStreamSuccessResult = null
    pageSchema = deepClone(useCanvas().pageState.pageSchema)
  }

  const onBeforeRequest = async (requestParams: any) => {
    let referenceContext = ''
    let imageAssets: any[] = []

    // 添加系统提示词
    if (requestParams.messages[0]?.role !== 'system') {
      if (getRobotServiceOptions()?.enableRagContext) {
        referenceContext = await search(requestParams.messages?.at(-1)?.content)
      }
      if (getRobotServiceOptions()?.enableResourceContext !== false) {
        const appId = getMetaApi(META_SERVICE.GlobalService).getBaseInfo().id
        imageAssets = await fetchAssets(appId)
      }
      const { materialState, getComponentDetail } = useMaterial()
      const components = formatComponents(materialState.components, getComponentDetail)
      addSystemPrompt(
        requestParams.messages,
        getAgentSystemPrompt(components, pageSchema, referenceContext, imageAssets)
      )
    }

    const { serviceKey, model, config, capabilities } = getSelectedModelInfo()

    requestParams.serviceKey = serviceKey
    requestParams.model = model

    if (capabilities?.reasoning?.extraBody) {
      const extraBody = config?.enableThinking
        ? capabilities.reasoning.extraBody.enable
        : capabilities.reasoning.extraBody.disable
      if (extraBody) {
        Object.assign(requestParams, extraBody)
      }
    }

    // Agent 模式默认使用 JSON 对象格式
    if (capabilities?.jsonOutput?.extraBody?.enable) {
      Object.assign(requestParams, capabilities.jsonOutput.extraBody.enable)
    }

    return requestParams
  }

  const onStreamStart = (messages: any[]) => {
    removeLoading(messages)
  }

  const onStreamData = (data: object, content: string | object, _messages: any[]) => {
    if (!pageSchema) {
      return
    }

    const currentRunId = streamRunId
    Promise.resolve(updatePageSchema(content, pageSchema!))
      .then((result) => {
        markStreamSchemaSuccess(result, currentRunId)
      })
      .catch((error) => {
        logger.error('stream update page schema failed', error)
      })
  }

  const onRequestEnd = async (
    finishReason: string,
    content: string,
    messages: any[],
    extraData?: Record<string, unknown>
  ) => {
    if (finishReason === 'aborted' || finishReason === 'error') {
      const errorInfo = { content: extraData?.error || '请求失败', status: 'failed' }
      const lastMessage = messages.at(-1)
      const lastRenderContent = ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
      Object.assign(lastRenderContent, errorInfo)
    }
  }

  const onStreamTools = (tools: Record<string, unknown>[], { currentMessage }: { currentMessage: any }) => {
    tools.forEach((tool) => updateToolCallRenderContent(tool, currentMessage.renderContent))
  }

  const onBeforeCallTool = (tool: Record<string, unknown>, { currentMessage }: { currentMessage: any }) => {
    updateToolCallRenderContent(tool, currentMessage.renderContent)
  }

  const onPostCallTool = (
    tool: Record<string, unknown>,
    toolCallResult: object | string,
    toolCallStatus: string,
    { currentMessage }: { currentMessage: any }
  ) => {
    currentMessage.renderContent.at(-1)!.status = toolCallStatus
    currentMessage.renderContent.at(-1)!.content = {
      params: tool.parsedArgs,
      result: toolCallResult
    }
  }

  const onMessageProcessed = async (
    finishReason: string,
    content: string,
    messages: any[],
    {
      abortControllerMap,
      messageState
    }: { abortControllerMap: Record<string, AbortController>; messageState: MessageState }
  ) => {
    const lastMessage = messages.at(-1)

    if (finishReason === 'aborted' || finishReason === 'error') {
      ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
      resetPageGenerateState()
      return
    }

    if (!content?.trim() && !lastMessage?.content?.trim()) {
      if (finishWithStreamSchemaFallback(lastMessage, messageState)) {
        resetPageGenerateState()
        return
      }
      ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
      resetPageGenerateState()
      return
    }

    const jsonValidResult = isValidJsonPatchObjectString(content)
    // JSON 修复机制
    if (jsonValidResult.isError) {
      abortControllerMap.errorFix = new AbortController()
      try {
        const beforeRequest = (requestParams: any) => {
          const { capabilities, model, serviceKey } = getSelectedModelInfo()
          if (capabilities?.reasoning?.extraBody?.disable) {
            Object.assign(requestParams, capabilities.reasoning.extraBody.disable)
          }
          if (capabilities?.jsonOutput?.extraBody?.enable) {
            Object.assign(requestParams, capabilities.jsonOutput.extraBody.enable)
          }
          Object.assign(requestParams, {
            model,
            serviceKey
          })
          return requestParams
        }
        const apiUrl = 'app-center/api/chat/completions'
        ensureLastRenderContent(lastMessage, getContentType(), 'fix')
        const fixedResponse = await client.chat({
          messages: [{ role: 'user', content: getJsonFixPrompt(content, jsonValidResult.error) }],
          options: { signal: abortControllerMap.errorFix?.signal, beforeRequest: beforeRequest as any, apiUrl }
        })
        const fixedContent = fixedResponse.choices[0].message.content
        const fixedJsonValidResult = isValidJsonPatchObjectString(fixedContent)
        if (fixedJsonValidResult.isError) {
          // 修复接口也可能返回 <think> 或解释文本；仍非法时直接失败，避免继续把原文传给 updatePageSchema。
          if (finishWithStreamSchemaFallback(lastMessage, messageState)) {
            delete abortControllerMap.errorFix
            resetPageGenerateState()
            return
          }
          ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
          messageState.status = STATUS.ERROR
          messageState.errorMsg = `JSON 修复失败：${fixedJsonValidResult.error}`
          delete abortControllerMap.errorFix
          resetPageGenerateState()
          return
        }

        lastMessage.originContent = lastMessage.content
        // 后续页面更新只消费纯 JSON Patch，不再消费模型的解释文本。
        lastMessage.content = getJsonObjectString(fixedContent)
      } catch (error) {
        logger.error('json fix failed', error)
        if (error instanceof Error && error.message.includes('canceled')) {
          ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
          messageState.status = STATUS.ABORTED
        } else {
          if (!finishWithStreamSchemaFallback(lastMessage, messageState)) {
            ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
            messageState.status = STATUS.ERROR
            messageState.errorMsg = `JSON 修复失败：${error}`
          }
        }
        delete abortControllerMap.errorFix
        resetPageGenerateState()
        return
      }
      delete abortControllerMap.errorFix
    } else {
      // 主响应已经可解析时也统一落成纯 JSON Patch，避免最终解析被 <think>/说明文本污染。
      lastMessage.content = getJsonObjectString(content)
    }

    // 更新页面 schema
    try {
      const result = await updatePageSchema(lastMessage.content, pageSchema, true)
      const lastRenderContent = ensureAgentResultRenderContent(
        lastMessage,
        getContentType(),
        result?.schema || lastStreamSuccessResult?.schema ? 'success' : 'failed'
      )
      if (result?.schema) {
        lastRenderContent.schema = result.schema
      } else if (lastStreamSuccessResult?.schema) {
        lastRenderContent.schema = lastStreamSuccessResult.schema
      }
    } catch (error) {
      logger.error('update page schema failed', error)
      if (!finishWithStreamSchemaFallback(lastMessage, messageState)) {
        ensureAgentResultRenderContent(lastMessage, getContentType(), 'failed')
        messageState.status = STATUS.ERROR
        messageState.errorMsg = `页面更新失败：${error}`
      }
    }

    resetPageGenerateState()
  }

  const onPostCallTools = (toolsResult: Record<string, unknown>[], { currentMessage }: { currentMessage: any }) => {
    currentMessage.renderContent.push({ type: 'loading', content: '' })
  }

  const onConversationEnd = (_conversationId: string) => {
    // Agent 模式暂无特殊处理
    resetPageGenerateState()
  }

  return {
    // 配置方法
    getApiUrl,
    getContentType,
    getLoadingType,

    // 生命周期钩子
    onConversationStart,
    onMessageSent,
    onBeforeRequest,
    onStreamStart,
    onStreamData,
    onRequestEnd,
    onStreamTools,
    onBeforeCallTool,
    onPostCallTool,
    onPostCallTools,
    onMessageProcessed,
    onConversationEnd
  }
}
