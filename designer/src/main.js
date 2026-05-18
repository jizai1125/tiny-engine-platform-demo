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
import { configurators } from './configurators/'
import { installPageTypeRenderer } from './page-type/index.js'
import 'virtual:svg-icons-register'

async function startApp() {
  const registry = await import('../registry')
  const { init } = await import('@opentiny/tiny-engine')

  init({
    registry: [registry.default],
    configurators,
    createAppSignal: ['global_service_init_finish'],
    lifeCycles: {
      beforeAppCreate: () => {
        installPageTypeRenderer()
      }
    }
  })
}

startApp()
