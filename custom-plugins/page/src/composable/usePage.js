import { PageService as OfficialPageService } from '@opentiny/tiny-engine-plugin-page'
import { getOptions } from '@opentiny/tiny-engine-meta-register'

const FALLBACK_PAGE_TYPE = 'form'
const FALLBACK_PAGE_TYPES = [
  { text: '表单页面', value: 'form' },
  { text: '流程页面', value: 'flow' },
  { text: '大屏页面', value: 'dashboard' }
]

const ensurePageType = (pageSchema, defaultPageType) => {
  if (!pageSchema || typeof pageSchema !== 'object') {
    return pageSchema
  }

  const pageContent = pageSchema.page_content || {}

  return {
    ...pageSchema,
    page_content: {
      ...pageContent,
      pageType: pageContent.pageType || defaultPageType
    }
  }
}

export default () => {
  const officialApis = OfficialPageService.apis

  const getPagePluginOptions = () => getOptions('engine.plugins.appmanage') || {}
  const getPageTypeOptions = () => getPagePluginOptions().pageTypes || FALLBACK_PAGE_TYPES
  const getDefaultPageType = () => getPagePluginOptions().defaultPageType || getPageTypeOptions()[0]?.value || FALLBACK_PAGE_TYPE
  const getDefaultPage = () => ensurePageType(officialApis.getDefaultPage(), getDefaultPageType())
  const initCurrentPageData = (pageData) => officialApis.initCurrentPageData(ensurePageType(pageData, getDefaultPageType()))
  const getPageList = async (...args) => {
    const pageList = await officialApis.getPageList(...args)

    if (!Array.isArray(pageList)) {
      return pageList
    }

    pageList.forEach((group) => {
      if (!Array.isArray(group?.data)) {
        return
      }

      const normalizeNodes = (nodes) =>
        nodes.map((node) => {
          const normalizedNode = ensurePageType(node, getDefaultPageType())

          if (Array.isArray(node?.children)) {
            normalizedNode.children = normalizeNodes(node.children)
          }

          return normalizedNode
        })

      group.data = normalizeNodes(group.data)
    })

    return pageList
  }

  return {
    ...officialApis,
    getDefaultPageType,
    getPageTypeOptions,
    getDefaultPage,
    initCurrentPageData,
    getPageList
  }
}
