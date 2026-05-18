import { materialSources } from '@demo/tiny-engine-materials'

export default {
  id: 'engine.config',
  theme: 'light',
  material: materialSources,
  rootComponentMap: {
    form: { componentName: 'form', props: {} },
    flow: { componentName: 'div', props: {} },
    dashboard: { componentName: 'div', props: {} }
  },
  scripts: [],
  styles: [],
  enableTailwindCSS: true
}
