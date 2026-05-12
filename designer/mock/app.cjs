const Koa = require('koa')
const koaBody = require('koa-body')
const serve = require('koa-static2')
const path = require('path')

const { env, port } = require('@opentiny/tiny-engine-mock/dist/config/config')
const errorRoutesCatch = require('@opentiny/tiny-engine-mock/dist/middleware/ErrorRoutesCatch')
const errorRoutes = require('@opentiny/tiny-engine-mock/dist/routes/error-routes')
const mainRoutesModule = require('@opentiny/tiny-engine-mock/dist/routes/main-routes')
const { getResponseData } = require('@opentiny/tiny-engine-mock/dist/tool/Common')

const mainRoutes = mainRoutesModule.default
const { mockService } = mainRoutesModule
const mockDistDir = path.dirname(require.resolve('@opentiny/tiny-engine-mock/dist/app.js'))

const parsePageContent = (item) => {
  if (item && item.page_content && typeof item.page_content === 'string') {
    try {
      item.page_content = JSON.parse(item.page_content)
    } catch (error) {
      // keep original value when stored content is not valid JSON
    }
  }

  return item
}

const stringifyPageContent = (item = {}) => {
  const pageData = { ...item }

  if (pageData.page_content && typeof pageData.page_content === 'object') {
    pageData.page_content = JSON.stringify(pageData.page_content)
  }

  return pageData
}

const pageService = mockService.pageService

pageService.create = async function create(params) {
  const model = params.isPage ? this.pageModel : this.folderModel
  const pageData = stringifyPageContent({ ...model, ...params })

  if (!pageData.route) {
    pageData.route = pageData.name || 'Untitled'
  }

  const result = await this.db.insertAsync(pageData)
  const { _id } = result

  await this.db.updateAsync({ _id }, { $set: { id: _id } })
  result.id = result._id

  return getResponseData(parsePageContent(result))
}

pageService.update = async function update(id, params) {
  const updateData = stringifyPageContent(params)

  await this.db.updateAsync({ _id: id }, { $set: updateData })

  const result = await this.db.findOneAsync({ _id: id })

  return getResponseData(parsePageContent(result))
}

pageService.list = async function list(appId) {
  const result = await this.db.findAsync({ app: appId.toString() })

  if (Array.isArray(result)) {
    result.forEach(parsePageContent)
  }

  return getResponseData(result)
}

pageService.detail = async function detail(pageId) {
  const result = await this.db.findOneAsync({ _id: pageId })

  return getResponseData(parsePageContent(result))
}

pageService.delete = async function remove(pageId) {
  const result = await this.db.findOneAsync({ _id: pageId })

  await this.db.removeAsync({ _id: pageId })

  return getResponseData(parsePageContent(result))
}

const app = new Koa()

app
  .use((ctx, next) => {
    ctx.set('Access-Control-Allow-Origin', '*')
    ctx.set('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    ctx.set('Access-Control-Allow-Methods', 'PUT, POST, GET, DELETE, OPTIONS')
    ctx.set('Access-Control-Allow-Credentials', true)

    return next()
  })
  .use(errorRoutesCatch())
  .use(serve('assets', path.resolve(mockDistDir, './assets')))
  .use(
    koaBody({
      multipart: true,
      parsedMethods: ['POST', 'PUT', 'PATCH', 'GET', 'HEAD', 'DELETE'],
      formidable: {
        uploadDir: path.join(mockDistDir, './assets/uploads/tmp')
      },
      jsonLimit: '50mb',
      formLimit: '50mb',
      textLimit: '50mb'
    })
  )
  .use(mainRoutes.routes())
  .use(mainRoutes.allowedMethods())
  .use(errorRoutes())

if (env === 'development') {
  app.use((ctx, next) => {
    const start = new Date()

    return next().then(() => {
      const elapsedMs = new Date() - start
      return elapsedMs
    })
  })
}

app.listen(port)
