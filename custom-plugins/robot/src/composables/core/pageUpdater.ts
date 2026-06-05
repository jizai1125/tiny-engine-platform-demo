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

const setSchema = (schema: object) => {
  const { importSchema, setSaved } = useCanvas()
  importSchema(schema)
  setSaved(false)
}

type UpdateResult =
  | undefined
  | { isError: false; schema: object; error?: undefined }
  | { isError: true; schema?: undefined; error: unknown }

type BeforeApply = () => boolean

const _updatePageSchema = (
  streamContent: string,
  currentPageSchema: object,
  isFinal: boolean = false,
  beforeApply?: BeforeApply
): UpdateResult => {
  const { getSelectedModelInfo } = useModelConfig()
  if (getSelectedModelInfo().config?.chatMode !== ChatMode.Agent) {
    return
  }

  // 解析流式返回的schema patch
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

  // 生成新schema
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

  // 更新Schema
  // 流式调用方可在 setSchema 前做写入检查，阻止过期任务写画布；最终更新不需要这层检查。
  if (beforeApply && !beforeApply()) {
    return { isError: true, error: 'skip stale stream schema update.' }
  }
  setSchema(newSchema)
  if (isFinal) {
    useHistory().addHistory()
  }

  return { schema: newSchema, isError: false }
}

const updatePageSchemaThrottled = useThrottleFn(_updatePageSchema, 200, true)

export const updatePageSchema = (
  streamContent: string,
  currentPageSchema: object,
  isFinal: boolean = false,
  beforeApply?: BeforeApply
): UpdateResult | Promise<UpdateResult> => {
  if (isFinal) {
    return _updatePageSchema(streamContent, currentPageSchema, true)
  }

  return updatePageSchemaThrottled(streamContent, currentPageSchema, false, beforeApply)
}
