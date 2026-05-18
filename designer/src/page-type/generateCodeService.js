import { generateApp, genSFCWithDefaultPlugin, parseRequiredBlocks } from '@opentiny/tiny-engine-dsl-vue'
import { getMergeMeta } from '@opentiny/tiny-engine-meta-register'
import { prepareAppSchemaForCodegen, preparePageSchemaForSfc } from './resolve.js'
import { withPageRootHooks } from './sfcHooks.js'

const defaultOptions = {
  pluginConfig: {
    template: {},
    block: {},
    page: {},
    dataSource: {},
    dependencies: {},
    globalState: {},
    i18n: {},
    router: {},
    utils: {},
    formatCode: {},
    parseSchema: {}
  }
}

const getPageSfcConfig = (pageConfig = {}) => {
  return {
    ...pageConfig,
    sfcConfig: withPageRootHooks(pageConfig.sfcConfig || {})
  }
}

const generateAppCode = async (appSchema, options = {}) => {
  const enableTailwindCSS = getMergeMeta('engine.config')?.enableTailwindCSS
  const normalizedSchema = prepareAppSchemaForCodegen(appSchema)
  const pluginConfig = options.pluginConfig || {}

  const instance = generateApp({
    ...defaultOptions,
    ...options,
    pluginConfig: {
      ...defaultOptions.pluginConfig,
      ...pluginConfig,
      template: {
        ...defaultOptions.pluginConfig.template,
        ...pluginConfig.template,
        enableTailwindCSS
      },
      page: getPageSfcConfig(pluginConfig.page || {})
    }
  })

  return instance.generate(normalizedSchema)
}

const generatePageCode = (pageSchema, componentsMap, config = {}, nextPage) => {
  const normalizedPageSchema = preparePageSchemaForSfc(pageSchema)
  const nextConfig = withPageRootHooks(config)

  return genSFCWithDefaultPlugin(normalizedPageSchema, componentsMap, nextConfig, nextPage)
}

const getAllNestedBlocksSchema = async (pageSchema, fetchBlockSchemaApi, blockSet = new Set()) => {
  const res = []
  const blockNames = parseRequiredBlocks(pageSchema)
  const promiseList = blockNames
    .filter((name) => {
      if (blockSet.has(name)) {
        return false
      }

      blockSet.add(name)

      return true
    })
    .map((name) => fetchBlockSchemaApi(name))

  const schemaList = await Promise.allSettled(promiseList)
  const extraList = []

  schemaList.forEach((item) => {
    if (item.status !== 'fulfilled') {
      return
    }

    const blockItem = item.value?.[0]

    if (!blockItem) {
      return
    }

    const historyId = blockItem?.current_history
    const historySchema = blockItem?.histories?.find?.((historyItem) => historyItem?.id === historyId)
    const schemaContent = historyId && historySchema?.content ? historySchema.content : blockItem?.content

    if (!schemaContent) {
      return
    }

    schemaContent.version = historyId || ''
    schemaContent.subBlockDeps = blockNames

    res.push(schemaContent)
    extraList.push(getAllNestedBlocksSchema(schemaContent, fetchBlockSchemaApi, blockSet))
  })

  ;(await Promise.allSettled(extraList)).forEach((item) => {
    if (item.status === 'fulfilled' && item.value) {
      res.push(...item.value)
    }
  })

  return res
}

export const GenerateCodeService = {
  id: 'engine.service.generateCode',
  type: 'MetaService',
  options: {},
  apis: {
    parseRequiredBlocks,
    getAllNestedBlocksSchema,
    generatePageCode,
    generateAppCode
  }
}
