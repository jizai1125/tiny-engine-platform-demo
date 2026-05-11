import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const sourceBundlePath = path.join(rootDir, 'materials', 'source', 'bundle.json')
const componentsDir = path.join(rootDir, 'materials', 'components')
const distBundlePath = path.join(rootDir, 'materials', 'dist', 'bundle.json')
const publicBundlePath = path.join(rootDir, 'designer', 'public', 'materials', 'bundle.json')

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'))

const writeJson = async (filePath, content) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(content, null, 2))
}

const listComponentFiles = async () => {
  try {
    const entries = await fs.readdir(componentsDir, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name)
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

const mergeComponentSchemas = async (bundle) => {
  const componentFiles = await listComponentFiles()

  if (!componentFiles.length) {
    return bundle
  }

  const nextBundle = structuredClone(bundle)
  const componentMap = new Map(
    (nextBundle.data?.materials?.components || []).map((component) => [component.component, component])
  )

  for (const fileName of componentFiles) {
    const component = await readJson(path.join(componentsDir, fileName))

    if (!component?.component) {
      continue
    }

    componentMap.set(component.component, component)
  }

  nextBundle.data.materials.components = Array.from(componentMap.values())

  return nextBundle
}

const sourceBundle = await readJson(sourceBundlePath)
const mergedBundle = await mergeComponentSchemas(sourceBundle)

await writeJson(distBundlePath, mergedBundle)
await writeJson(publicBundlePath, mergedBundle)

console.log(`materials bundle built: ${path.relative(rootDir, distBundlePath)}`)
console.log(`designer bundle synced: ${path.relative(rootDir, publicBundlePath)}`)
