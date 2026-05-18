import { isNativeHtmlTag } from './resolve.js'

const addImportFromComponentsMap = (componentName, globalHooks, config = {}) => {
  const componentMap = (config.componentsMap || []).find((item) => item.componentName === componentName)

  if (!componentMap?.package) {
    return
  }

  globalHooks.addImport(componentMap.package, {
    destructuring: componentMap.destructuring !== false,
    exportName: componentMap.exportName || componentName,
    componentName,
    package: componentMap.package,
    version: componentMap.version
  })
}

const addExplicitImport = (componentName, importConfig, globalHooks) => {
  if (!importConfig?.package) {
    return
  }

  globalHooks.addImport(importConfig.package, {
    destructuring: importConfig.destructuring !== false,
    exportName: importConfig.exportName || componentName,
    componentName,
    package: importConfig.package,
    version: importConfig.version
  })
}

export const handlePageRootHook = (optionData, globalHooks, config) => {
  const rootComponentName = optionData.schema?.__pageRootComponentName

  if (!rootComponentName) {
    return
  }

  optionData.componentName = rootComponentName

  if (isNativeHtmlTag(rootComponentName)) {
    return
  }

  addExplicitImport(rootComponentName, optionData.schema?.__pageRootImport, globalHooks)
  addImportFromComponentsMap(rootComponentName, globalHooks, config)
}

export const withPageRootHooks = (config = {}) => {
  const hooks = config.hooks || {}

  return {
    ...config,
    hooks: {
      ...hooks,
      genTemplate: [handlePageRootHook, ...(hooks.genTemplate || [])]
    }
  }
}
