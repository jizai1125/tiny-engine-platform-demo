import { defineService, META_SERVICE, getMergeMeta, getMetaApi } from '@opentiny/tiny-engine-meta-register'
import axios from 'axios'
import { useBroadcastChannel } from '@vueuse/core'
import { constants } from '@opentiny/tiny-engine-utils'

let http = null
let interceptorsInstalled = false
let customInterceptorsInstalled = false

const { BROADCAST_CHANNEL } = constants
const { post: globalNotify } = useBroadcastChannel({ name: BROADCAST_CHANNEL.Notify })
let isUnauthorized = false
let requestCount = 0
const abortControllers = new Map()
const whiteList = [
  '/platform-center/api/user/login',
  '/platform-center/api/user/register',
  '/platform-center/api/user/forgot-password',
  '/platform-center/api/user/me',
  '/platform-center/api/user/tenant'
]
const notAuthList = []
const loginErrorCode = ['CM004', 'CM005', 'CM006', 'CM007', 'CM336', 'CM339']

const getDefaultAxiosConfig = (env = import.meta.env) => {
  const baseURL = env.VITE_ORIGIN
  const dev = env.MODE?.includes('dev')
  const getTenant = () => new URLSearchParams(location.search).get('tenant')

  return {
    baseURL,
    withCredentials: dev,
    headers: {
      ...(dev && { 'x-lowcode-mode': 'develop' }),
      'x-lowcode-org': getTenant()
    }
  }
}

const registerInterceptor = (handler, interceptor) => {
  if (typeof interceptor === 'function') {
    handler.use(interceptor)
  } else if (Array.isArray(interceptor)) {
    handler.use(interceptor[0], interceptor[1])
  }
}

const registerInterceptors = (handler, config) => {
  if (!config) {
    return
  }

  if (typeof config === 'function') {
    handler.use(config)
    return
  }

  if (Array.isArray(config)) {
    const isTuple = config.length <= 2 && typeof config[0] === 'function' && typeof config[1] !== 'object'

    if (isTuple) {
      handler.use(config[0], config[1])
    } else {
      config.forEach((item) => item && registerInterceptor(handler, item))
    }
  }
}

const resetAuthState = () => {
  isUnauthorized = false
  abortControllers.clear()
}

const createAbortController = (config) => {
  const controller = new AbortController()
  config.signal = controller.signal

  return controller
}

const abortAllRequests = (message = '用户未登录，请求已取消') => {
  abortControllers.forEach((controller) => {
    controller.abort(message)
  })
  abortControllers.clear()
}

const showError = (url, message) => {
  if (axios.isCancel(message) || (message && message.name === 'AbortError') || message?.name === 'CanceledError') {
    return
  }

  globalNotify({
    type: 'error',
    title: '接口报错',
    message: `报错接口: ${url} \n报错信息: ${message ?? ''}`
  })
}

const toLogin = () => {
  const { setNeedToLogin } = getMetaApi(META_SERVICE.GlobalService)
  isUnauthorized = true

  abortAllRequests('认证失败，需要重新登录')
  setNeedToLogin(true)
  localStorage.removeItem('engineToken')
}

const requestHandler = (config) => {
  requestCount++

  const controller = createAbortController(config)
  const requestKey = `${config.method}_${config.url}_${requestCount}`
  abortControllers.set(requestKey, controller)

  const isWhiteList = whiteList.some((url) => config.url.includes(url))
  if (isUnauthorized && !isWhiteList) {
    controller.abort('用户未登录，请求已取消')
    return new Promise(() => {})
  }

  const isDevelopEnv = import.meta.env.MODE?.includes('dev')
  if (isDevelopEnv && config.url.match(/\/generate\//)) {
    config.baseURL = ''
  }

  if (window.vscodeBridge) {
    config.baseURL = ''
  }

  const token = localStorage.getItem('engineToken')
  if (!token) {
    const { setNeedToLogin, getLoginStatus } = getMetaApi(META_SERVICE.GlobalService)

    if (!isWhiteList) {
      isUnauthorized = true
      controller.abort('用户未登录，请求已取消')
      abortAllRequests('用户未登录，所有请求已取消')

      const isLoginModalShown = getLoginStatus?.() || false
      if (!isLoginModalShown) {
        setNeedToLogin(true)
      }

      return new Promise(() => {})
    }
  } else {
    if (isUnauthorized) {
      resetAuthState()
    }

    if (!notAuthList.some((url) => config.url.includes(url))) {
      config.headers = config.headers || {}
      config.headers.Authorization = `Bearer ${token}`
    }
  }

  config.cleanupAbortController = () => {
    abortControllers.delete(requestKey)
  }

  return config
}

const responseSuccessHandler = (res) => {
  if (res.config?.cleanupAbortController) {
    res.config.cleanupAbortController()
  }

  if (res.data?.error) {
    showError(res.config?.url, res?.data?.error?.message)
    const error = res.data?.error

    if (error.code && loginErrorCode.includes(error.code)) {
      toLogin()

      return Promise.reject({
        type: 'AUTH_ERROR',
        code: error.code,
        message: error.message || '认证失败，请重新登录',
        skipShowError: true
      })
    }

    return Promise.reject(res.data.error)
  }

  return res.data?.data || res.data
}

const responseErrorHandler = (error) => {
  if (error.config?.cleanupAbortController) {
    error.config.cleanupAbortController()
  }

  if (axios.isCancel(error) || error?.name === 'AbortError' || error?.name === 'CanceledError') {
    return Promise.reject(error)
  }

  if (error.type === 'NO_TOKEN') {
    return Promise.reject(error)
  }

  const { response } = error
  if (response) {
    const { data } = response

    if (data?.code && loginErrorCode.includes(data.code)) {
      toLogin()

      return Promise.reject({
        type: 'AUTH_ERROR',
        code: data.code,
        message: data.message || '认证失败，请重新登录',
        skipShowError: true
      })
    }
  }

  if (!error.skipShowError) {
    showError(error.config?.url, error?.message)
  }

  return response?.data?.error ? Promise.reject(response.data.error) : Promise.reject(error.message)
}

const createHttp = (axiosConfig = {}) => {
  const defaultConfig = getDefaultAxiosConfig()

  return axios.create({
    ...defaultConfig,
    ...axiosConfig,
    headers: {
      ...(defaultConfig.headers || {}),
      ...(axiosConfig.headers || {})
    }
  })
}

const ensureHttp = ({ axiosConfig = {}, interceptors = {} } = {}) => {
  if (!http) {
    http = createHttp(axiosConfig)
  }

  const enableLogin = getMergeMeta('engine.config')?.enableLogin
  if (enableLogin) {
    if (!interceptorsInstalled) {
      http.interceptors.request.use(requestHandler)
      http.interceptors.response.use(responseSuccessHandler, responseErrorHandler)
      interceptorsInstalled = true
    }
  } else if (!customInterceptorsInstalled) {
    const { request, response } = interceptors
    registerInterceptors(http.interceptors.request, request)
    registerInterceptors(http.interceptors.response, response)
    customInterceptorsInstalled = true
  }

  return http
}

export default defineService({
  id: META_SERVICE.Http,
  type: 'MetaService',
  initialState: {},
  options: {
    axiosConfig: {
      baseURL: '',
      withCredentials: false,
      headers: {}
    },
    interceptors: {
      request: [],
      response: []
    }
  },
  init: ({ options = {} }) => {
    const { axiosConfig = {}, interceptors = {} } = options
    const instance = ensureHttp({ axiosConfig, interceptors })
    const defaultConfig = getDefaultAxiosConfig()

    if (instance) {
      instance.defaults.baseURL = axiosConfig.baseURL ?? defaultConfig.baseURL
      instance.defaults.withCredentials = axiosConfig.withCredentials ?? defaultConfig.withCredentials
      instance.defaults.headers = {
        ...defaultConfig.headers,
        ...(axiosConfig.headers || {})
      }
    }
  },
  apis: () => ({
    getHttp: () => ensureHttp(),
    get: (url, config) => ensureHttp().get(url, config),
    post: (url, data, config) => ensureHttp().post(url, data, config),
    request: (config) => ensureHttp().request(config),
    put: (url, data, config) => ensureHttp().put(url, data, config),
    delete: (url, config) => ensureHttp().delete(url, config),
    stream: (config) => {
      const streamConfig = {
        responseType: 'stream',
        ...config
      }

      return ensureHttp().request(streamConfig)
    }
  })
})
