import officialPagePlugin from '@opentiny/tiny-engine-plugin-page'
import PageGeneral from './src/PageGeneral.vue'

const pageTypeOptions = [
  { text: '表单页面', value: 'form' },
  { text: '流程页面', value: 'flow' },
  { text: '大屏页面', value: 'dashboard' }
]

export default {
  ...officialPagePlugin,
  options: {
    ...officialPagePlugin.options,
    defaultPageType: 'form',
    pageTypes: pageTypeOptions
  },
  components: {
    ...(officialPagePlugin.components || {}),
    PageGeneral
  }
}
