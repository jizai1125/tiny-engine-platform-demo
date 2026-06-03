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
import { META_SERVICE, META_APP } from '@opentiny/tiny-engine-meta-register'
import customPagePlugin from '@demo/tiny-engine-plugin-page'
import customRobotPlugin from '@demo/tiny-engine-plugin-robot'
import engineConfig from './engine.config'
import { HttpService } from './src/composable'
import { GenerateCodeService } from './src/page-type/index.js'

const baseURL = import.meta.env.BASE_URL || '.'
const baseURLWithoutSlash = baseURL.replace(/\/$/, '')

export default {
  [META_SERVICE.Http]: HttpService,
  [META_SERVICE.GenerateCode]: GenerateCodeService,
  'engine.config': {
    ...engineConfig
  },
  [META_APP.AppManage]: customPagePlugin,
  [META_APP.Robot]: customRobotPlugin,
  [META_APP.Layout]: {
    options: {
      relativeLayoutConfig: {
        [META_APP.AppManage]: {
          insertBefore: META_APP.State
        },
        [META_APP.OutlineTree]: {
          insertAfter: META_APP.Materials
        },
        [META_APP.Schema]: {
          insertBefore: META_APP.Help
        },
        [META_APP.Save]: {
          insertAfter: META_APP.GenerateCode
        },
        [META_APP.Lang]: {
          insertAfter: META_APP.ViewSetting
        }
      }
    }
  },
  [META_APP.Preview]: {
    options: {
      previewUrl: ['prod', 'alpha'].includes(import.meta.env.MODE) ? `${baseURLWithoutSlash}/preview.html` : ''
    }
  }
}
