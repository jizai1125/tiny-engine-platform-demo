import { useCanvas, useMaterial } from '@opentiny/tiny-engine-meta-register'

const INSTALL_FLAG = '__demoComponentNameNumberingInstalled'
let installTimer = null

const escapeRegExp = (value = '') => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const walkSchema = (nodes, visitor) => {
  if (!Array.isArray(nodes)) {
    return
  }

  nodes.forEach((node) => {
    visitor(node)
    walkSchema(node.children, visitor)
  })
}

const getMaterialDisplayName = (componentName) => {
  const material = useMaterial().getMaterial(componentName)

  return material?.name?.zh_CN || componentName
}

const getNextComponentDisplayName = (data) => {
  const componentName = data?.componentName

  if (!componentName) {
    return ''
  }

  const prefix = getMaterialDisplayName(componentName)
  const namePattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`)
  let maxIndex = 0

  walkSchema(useCanvas().pageState.pageSchema?.children, (node) => {
    if (node?.componentName !== componentName) {
      return
    }

    const matched = String(node.props?.componentName || '').match(namePattern)

    if (matched) {
      maxIndex = Math.max(maxIndex, Number(matched[1]))
    }
  })

  return `${prefix}${maxIndex + 1}`
}

const patchComponentDisplayName = (data) => {
  if (!data || data.id || data.props?.componentName) {
    return data
  }

  const componentName = getNextComponentDisplayName(data)

  if (componentName) {
    data.props = {
      ...data.props,
      componentName
    }
  }

  return data
}

const installCanvasApiWrapper = (api) => {
  if (!api || api[INSTALL_FLAG] || !api.dragStart || !api.addComponent || !api.insertNode) {
    return
  }

  const { dragStart, addComponent, insertNode } = api

  api.dragStart = (data, ...args) => dragStart(patchComponentDisplayName(data), ...args)
  api.addComponent = (data, ...args) => addComponent(patchComponentDisplayName(data), ...args)
  api.insertNode = (node, ...args) => {
    if (node?.data) {
      patchComponentDisplayName(node.data)
    }

    return insertNode(node, ...args)
  }

  Object.defineProperty(api, INSTALL_FLAG, {
    value: true,
    configurable: true
  })
}

export const installComponentNameNumbering = () => {
  if (installTimer) {
    return
  }

  const tryInstall = () => {
    const canvas = useCanvas()
    const api = canvas?.canvasApi?.value

    installCanvasApiWrapper(api)

    if (api?.[INSTALL_FLAG]) {
      clearInterval(installTimer)
      installTimer = null
      return true
    }

    return false
  }

  if (!tryInstall()) {
    installTimer = setInterval(tryInstall, 50)
  }
}
