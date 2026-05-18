import { getMergeMeta, getOptions } from '@opentiny/tiny-engine-meta-register'

const DEFAULT_PAGE_TYPE = 'form'
const DEFAULT_ROOT_COMPONENT = 'div'
const DEFAULT_ROOT_COMPONENT_MAP = {
  form: { componentName: 'form', props: {} },
  flow: { componentName: 'div', props: {} },
  dashboard: { componentName: 'div', props: {} }
}

const getPagePluginOptions = () => getOptions('engine.plugins.appmanage') || {}

export const getRootComponentMap = () => ({
  ...DEFAULT_ROOT_COMPONENT_MAP,
  ...(getMergeMeta('engine.config')?.rootComponentMap || {})
})

export const resolvePageType = (pageContent = {}) => {
  return pageContent?.pageType || getPagePluginOptions().defaultPageType || DEFAULT_PAGE_TYPE
}

export const resolveRootComponent = (pageContent = {}) => {
  const pageType = resolvePageType(pageContent)
  const componentMap = getRootComponentMap()
  const rootComponent = componentMap[pageType] || {}

  return {
    pageType,
    componentName: rootComponent.componentName || DEFAULT_ROOT_COMPONENT,
    props: rootComponent.props || {},
    package: rootComponent.package,
    exportName: rootComponent.exportName,
    destructuring: rootComponent.destructuring,
    version: rootComponent.version
  }
}

export const isNativeHtmlTag = (componentName = '') => /^[a-z][\w-]*$/.test(componentName)

export const preparePageSchemaForSfc = (pageSchema = {}) => {
  const rootComponent = resolveRootComponent(pageSchema)

  return {
    ...pageSchema,
    props: {
      ...(pageSchema.props || {}),
      ...(rootComponent.props || {})
    },
    pageType: rootComponent.pageType,
    __pageRootComponentName: rootComponent.componentName,
    __pageRootImport:
      rootComponent.package || rootComponent.exportName
        ? {
            package: rootComponent.package,
            exportName: rootComponent.exportName,
            destructuring: rootComponent.destructuring,
            version: rootComponent.version
          }
        : null
  }
}

export const prepareAppSchemaForCodegen = (appSchema = {}) => {
  return {
    ...appSchema,
    pageSchema: (appSchema.pageSchema || []).map((pageSchema) => preparePageSchemaForSfc(pageSchema))
  }
}
