import { jsonrepair } from 'jsonrepair'
import * as jsonpatch from 'fast-json-patch'
import { utils } from '@opentiny/tiny-engine-utils'
import { useCanvas, useHistory } from '@opentiny/tiny-engine-meta-register'
import { useThrottleFn } from '@vueuse/core'
import useModelConfig from './useConfig'
import { ChatMode } from '../../types/mode.types'
import {
  fixMethods,
  schemaAutoFix,
  getJsonObjectString,
  isValidFastJsonPatch,
  jsonPatchAutoFix
} from '../../utils'

const { deepClone } = utils

const logger = console

// 统一提交页面 schema，普通最终更新和流式成功兜底都需要保持画布与历史记录一致。
export const applyPageSchema = (schema: object, shouldAddHistory = false) => {
  const { importSchema, setSaved } = useCanvas()
  importSchema(schema)
  setSaved(false)
  if (shouldAddHistory) {
    useHistory().addHistory()
  }
}

type UpdateResult =
  | undefined
  | { isError: false; schema: object; error?: undefined }
  | { isError: true; schema?: undefined; error: unknown }

type BeforeApply = (schema: object) => boolean

export const resolvePageSchema = (
  streamContent: string,
  currentPageSchema: object,
  isFinal: boolean = false
): UpdateResult => {
  const { getSelectedModelInfo } = useModelConfig()
  if (getSelectedModelInfo().config?.chatMode !== ChatMode.Agent) {
    return
  }

  // 只计算 patch 应用后的 schema，不写画布；最终收尾会先用它比较结果再决定提交哪个 schema。
  let content = isFinal ? getJsonObjectString(streamContent) : streamContent
  let jsonPatches = []
  try {
    if (!isFinal) {
      content = jsonrepair(content)
    }
    jsonPatches = JSON.parse(content)
  } catch (error) {
    if (isFinal) {
      logger.error('parse json patch error:', error)
    }
    return { isError: true, error }
  }

  // 过滤有效的json patch
  if (!isFinal && !isValidFastJsonPatch(jsonPatches)) {
    return { isError: true, error: 'format error: not a valid json patch.' }
  }

  const validJsonPatches = jsonPatchAutoFix(jsonPatches, isFinal)
  if (!validJsonPatches.length) {
    return { isError: true, error: 'format error: no valid json patch.' }
  }

  // 始终基于调用方传入的 schema 生成新 schema，调用方负责决定这个基底是初始页面还是流式成功页面。
  const originSchema = deepClone(currentPageSchema)
  let appliedPatchCount = 0
  const newSchema = validJsonPatches.reduce((acc: object, patch: any) => {
    try {
      const nextSchema = jsonpatch.applyPatch(acc, [patch], false, false).newDocument
      appliedPatchCount++
      return nextSchema
    } catch (error) {
      if (isFinal) {
        logger.error('apply patch error:', error, patch)
      }
      return acc
    }
  }, originSchema)

  if (!appliedPatchCount) {
    return { isError: true, error: 'apply patch error: no patch applied.' }
  }

  // schema纠错
  fixMethods(newSchema.methods)
  schemaAutoFix(newSchema.children)

  return { schema: newSchema, isError: false }
}

const _updatePageSchema = (
  streamContent: string,
  currentPageSchema: object,
  isFinal: boolean = false,
  beforeApply?: BeforeApply
): UpdateResult => {
  const result = resolvePageSchema(streamContent, currentPageSchema, isFinal)
  if (!result?.schema || result.isError) {
    return result
  }

  // 更新Schema
  // 调用方可在写入画布前检查待写入 schema，阻止过期流式任务或不完整最终结果覆盖当前页面。
  const allowApply = !beforeApply || beforeApply(result.schema)
  if (!allowApply) {
    return { isError: true, error: 'skip page schema update.' }
  }
  applyPageSchema(result.schema, isFinal)

  return result
}

const updatePageSchemaThrottled = useThrottleFn(_updatePageSchema, 200, true)

export const updatePageSchema = (
  streamContent: string,
  currentPageSchema: object,
  isFinal: boolean = false,
  beforeApply?: BeforeApply
): UpdateResult | Promise<UpdateResult> => {
  if (isFinal) {
    return _updatePageSchema(streamContent, currentPageSchema, true, beforeApply)
  }

  return updatePageSchemaThrottled(streamContent, currentPageSchema, false, beforeApply)
}
