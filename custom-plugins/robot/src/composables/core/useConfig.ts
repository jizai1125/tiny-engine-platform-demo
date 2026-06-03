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

/* metaService: engine.plugins.robot.useRobot */
import { reactive, readonly } from 'vue'
import { formatComponents, getAgentSystemPrompt, getJsonFixPrompt } from '../../constants/prompts'
import {
  isValidJsonPatchObjectString,
  getRobotServiceOptions,
  addSystemPrompt,
  jsonPatchAutoFix,
  isValidFastJsonPatch,
  getJsonObjectString,
  fixMethods,
  schemaAutoFix
} from '../../utils'
import { ChatMode } from '../../types/mode.types'
import type { ModelConfig, ModelSelection, ModelService, RobotSettings, SelectedModelInfo } from '../../types/setting.types'
import apiService from '../../services/api'
import { updatePageSchema } from '../core/pageUpdater'

const PREFERENCE_STORAGE_KEY = 'tiny-engine-robot-preferences'
const PREFERENCE_VERSION = 1

type RobotPreferences = {
  version: number
  chatMode: string
  enableThinking: boolean
}

const createEmptySelection = (): ModelSelection => ({
  serviceKey: '',
  modelName: ''
})

const robotSettingState = reactive<RobotSettings>({
  defaultModel: createEmptySelection(),
  quickModel: createEmptySelection(),
  services: [],
  chatMode: ChatMode.Agent,
  enableThinking: false
})

let initPromise: Promise<void> | null = null

const createDefaultPreferences = (): RobotPreferences => ({
  version: PREFERENCE_VERSION,
  chatMode: ChatMode.Agent,
  enableThinking: false
})

const loadPreferences = (): RobotPreferences => {
  const cache = localStorage.getItem(PREFERENCE_STORAGE_KEY)
  if (!cache) {
    return createDefaultPreferences()
  }

  try {
    return { ...createDefaultPreferences(), ...JSON.parse(cache) }
  } catch {
    return createDefaultPreferences()
  }
}

const savePreferences = (state: Partial<RobotPreferences>) => {
  const current = { ...loadPreferences(), ...state, version: PREFERENCE_VERSION }
  localStorage.setItem(PREFERENCE_STORAGE_KEY, JSON.stringify(current))
}

const normalizeService = (service: any): ModelService => ({
  id: Number(service.id),
  serviceKey: service.serviceKey,
  provider: service.provider,
  label: service.label,
  baseUrl: service.baseUrl,
  hasApiKey: Boolean(service.hasApiKey),
  allowEmptyApiKey: Boolean(service.allowEmptyApiKey),
  scopeType: service.scopeType,
  editable: Boolean(service.editable),
  enabled: service.enabled !== false,
  deprecated: Boolean(service.deprecated),
  isBuiltIn: Boolean(service.isBuiltIn),
  models: Array.isArray(service.models) ? service.models : []
})

// 初始化默认配置
const getAvailableServices = () =>
  robotSettingState.services.filter((service) => service.enabled && !service.deprecated && service.models.length)

const getServiceByKey = (serviceKey: string) => {
  return robotSettingState.services.find((service) => service.serviceKey === serviceKey)
}

const isCompactModel = (model?: ModelConfig) => Boolean(model?.capabilities?.compact)

const buildFallbackSelection = (preferCompact = false): ModelSelection => {
  const services = getAvailableServices()
  const builtInServices = services.filter((service) => service.isBuiltIn)

  for (const service of builtInServices) {
    const model =
      (preferCompact ? service.models.find((item) => isCompactModel(item)) : undefined) ||
      service.models[0]
    if (model) {
      return {
        serviceKey: service.serviceKey,
        modelName: model.name
      }
    }
  }

  return createEmptySelection()
}

const isSelectionValid = (selection?: Partial<ModelSelection> | null, options: { compactOnly?: boolean } = {}) => {
  if (!selection?.serviceKey || !selection?.modelName) {
    return false
  }

  const service = getServiceByKey(selection.serviceKey)
  if (!service || !service.enabled || service.deprecated) {
    return false
  }

  const model = service.models.find((item) => item.name === selection.modelName)
  if (!model) {
    return false
  }

  if (options.compactOnly && !isCompactModel(model)) {
    return false
  }

  return true
}

const normalizeSelection = (
  selection?: Partial<ModelSelection> | null,
  options: { compactOnly?: boolean; allowEmpty?: boolean } = {}
): ModelSelection => {
  const { compactOnly = false, allowEmpty = false } = options
  if (allowEmpty && !selection?.serviceKey && !selection?.modelName) {
    return createEmptySelection()
  }

  if (isSelectionValid(selection, { compactOnly })) {
    return {
      serviceKey: selection!.serviceKey!,
      modelName: selection!.modelName!
    }
  }

  return buildFallbackSelection(compactOnly)
}

const applyRemoteState = (services: ModelService[], settings?: Partial<RobotSettings>) => {
  robotSettingState.services = services
  robotSettingState.defaultModel = normalizeSelection(settings?.defaultModel, { allowEmpty: false })
  robotSettingState.quickModel = normalizeSelection(settings?.quickModel, { compactOnly: true, allowEmpty: true })
}

const refreshRemoteState = async () => {
  const [services, settings] = await Promise.all([apiService.getAIServices(), apiService.getAISettings()])
  applyRemoteState(services.map(normalizeService), settings)
}

const initConfig = async (force = false) => {
  if (initPromise && !force) {
    return initPromise
  }

  initPromise = (async () => {
    const preferences = loadPreferences()
    robotSettingState.chatMode = preferences.chatMode
    robotSettingState.enableThinking = preferences.enableThinking
    await refreshRemoteState()
  })()

  try {
    await initPromise
  } finally {
    if (force) {
      initPromise = null
    }
  }
}

export const init = () => initConfig()

// 根据serviceKey和modelName获取模型能力
const getModelCapabilities = (serviceKey: string, modelName: string) => {
  if (!serviceKey || !modelName) {
    return null
  }

  return getServiceByKey(serviceKey)?.models.find((item) => item.name === modelName)?.capabilities || null
}

// 获取所有可用模型（扁平化）
const getAllAvailableModels = () => {
  return getAvailableServices().flatMap((service) =>
    service.models.map((model) => ({
      serviceKey: service.serviceKey,
      serviceName: service.label,
      modelName: model.name,
      modelLabel: model.label,
      capabilities: model.capabilities || {},
      displayLabel: `${service.label} - ${model.label}`,
      value: `${service.serviceKey}::${model.name}`
    }))
  )
}

// 获取快速模型列表
const getCompactModels = () => {
  return getAllAvailableModels().filter((model) => model.capabilities?.compact)
}

const updateThinkingState = (value: boolean) => {
  robotSettingState.enableThinking = value
  savePreferences({ enableThinking: value })
}

const updateChatModeState = (value: string) => {
  robotSettingState.chatMode = value
  savePreferences({ chatMode: value })
}

const saveUserSettings = async (selection: Partial<Pick<RobotSettings, 'defaultModel' | 'quickModel'>>) => {
  const payload = {
    defaultModel: selection.defaultModel || robotSettingState.defaultModel,
    quickModel: selection.quickModel || robotSettingState.quickModel
  }
  const savedSettings = await apiService.saveAISettings(payload)
  applyRemoteState(robotSettingState.services, savedSettings)
}

// 服务管理方法
const addCustomService = async (service: Omit<ModelService, 'id' | 'serviceKey' | 'hasApiKey' | 'scopeType' | 'editable' | 'enabled' | 'deprecated' | 'isBuiltIn'> & { apiKey?: string }) => {
  await apiService.createAIService({
    provider: service.provider,
    label: service.label,
    baseUrl: service.baseUrl,
    apiKey: service.apiKey || '',
    allowEmptyApiKey: service.allowEmptyApiKey,
    models: service.models
  })
  await refreshRemoteState()
}

const updateService = async (
  id: number,
  service: Partial<ModelService> & { apiKey?: string }
) => {
  const current = robotSettingState.services.find((item) => item.id === id)
  if (!current || current.isBuiltIn) {
    return
  }

  await apiService.updateAIService(id, {
    provider: service.provider || current.provider,
    label: service.label || current.label,
    baseUrl: service.baseUrl || current.baseUrl,
    ...(service.apiKey !== undefined ? { apiKey: service.apiKey } : {}),
    allowEmptyApiKey: service.allowEmptyApiKey ?? current.allowEmptyApiKey,
    models: service.models || current.models
  })
  await refreshRemoteState()
}

const deleteService = async (serviceId: number) => {
  const current = robotSettingState.services.find((item) => item.id === serviceId)
  if (!current || current.isBuiltIn) {
    return
  }

  await apiService.deleteAIService(serviceId)
  await refreshRemoteState()
}

const buildSelectedModelInfo = (selection: ModelSelection, extraConfig?: { chatMode?: string; enableThinking?: boolean }) => {
  const currentService = getServiceByKey(selection.serviceKey)
  const currentModel = currentService?.models.find((item) => item.name === selection.modelName)
  const { name = '', label = '', capabilities = {} } = currentModel || {}

  const { models, ...service } = currentService ?? ({} as Partial<ModelService>)

  return {
    // 模型
    name,
    label,
    capabilities,
    // 服务
    service: (currentService ? service : null) as ModelService | null,
    ...(extraConfig
      ? {
          // 配置
          config: {
            chatMode: extraConfig.chatMode || robotSettingState.chatMode,
            enableThinking: extraConfig.enableThinking ?? robotSettingState.enableThinking
          }
        }
      : {}),
    // 模型兼容字段
    model: selection.modelName,
    completeModel: selection.modelName,
    // 服务兼容字段
    baseUrl: currentService?.baseUrl || '',
    serviceKey: currentService?.serviceKey || ''
  } as SelectedModelInfo
}

// 获取当前选择的对话模型信息
const getSelectedModelInfo = (): SelectedModelInfo => {
  return buildSelectedModelInfo(robotSettingState.defaultModel, {
    chatMode: robotSettingState.chatMode,
    enableThinking: robotSettingState.enableThinking
  })
}

const getSelectedQuickModelInfo = (): SelectedModelInfo => {
  return buildSelectedModelInfo(robotSettingState.quickModel)
}

export default () => {
  return {
    // 配置状态
    robotSettingState: readonly(robotSettingState),
    initConfig,

    // 状态更新与数据持久化
    updateThinkingState,
    updateChatModeState,
    saveUserSettings,

    // 模型相关
    getModelCapabilities,
    getAllAvailableModels,
    getCompactModels,
    getSelectedModelInfo,
    getSelectedQuickModelInfo,

    // 服务管理
    addCustomService,
    updateService,
    deleteService,
    getServiceByKey,

    // 公共方法
    formatComponents,
    getAgentSystemPrompt,
    getJsonFixPrompt,
    isValidJsonPatchObjectString,
    getRobotServiceOptions,
    addSystemPrompt,
    jsonPatchAutoFix,
    isValidFastJsonPatch,
    getJsonObjectString,
    fixMethods,
    schemaAutoFix,
    updatePageSchema
  }
}
