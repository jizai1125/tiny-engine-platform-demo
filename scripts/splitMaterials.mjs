import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const sourceBundlePath = path.join(rootDir, 'materials', 'source', 'bundle.json')
const componentsDir = path.join(rootDir, 'materials', 'components')

const sanitizeName = (name) => name.replace(/[<>:"/\\|?*\s]+/g, '-')
const bundle = JSON.parse(await fs.readFile(sourceBundlePath, 'utf8'))
const components = bundle.data?.materials?.components || []

await fs.mkdir(componentsDir, { recursive: true })

for (const component of components) {
  const fileName = `${sanitizeName(component.component || component.name?.zh_CN || 'component')}.json`
  const targetPath = path.join(componentsDir, fileName)

  await fs.writeFile(targetPath, JSON.stringify(component, null, 2))
}

console.log(`split ${components.length} component schemas into materials/components`)
