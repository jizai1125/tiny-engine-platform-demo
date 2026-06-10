import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const sourceBundlePath = path.join(rootDir, 'materials', 'source', 'bundle.json')
const componentsDir = path.join(rootDir, 'materials', 'components')

const sanitizeName = (name) => name.replace(/[<>:"/\\|?*\s]+/g, '-')
const getSnippetKey = (snippet) => snippet?.snippetName || snippet?.schema?.componentName
const bundle = JSON.parse(await fs.readFile(sourceBundlePath, 'utf8'))
const components = bundle.data?.materials?.components || []
const snippets = bundle.data?.materials?.snippets || []

const snippetsMap = new Map()

for (const snippetGroup of snippets) {
  for (const snippet of snippetGroup.children || []) {
    const key = getSnippetKey(snippet)

    if (!key) {
      continue
    }

    if (!snippetsMap.has(key)) {
      snippetsMap.set(key, [])
    }

    snippetsMap.get(key).push({
      ...snippet,
      category: snippetGroup.group
    })
  }
}

await fs.mkdir(componentsDir, { recursive: true })

for (const component of components) {
  const matchedSnippets = snippetsMap.get(component.component)

  if (matchedSnippets?.length) {
    component.snippets = matchedSnippets
  }

  const fileName = `${sanitizeName(component.component || component.name?.zh_CN || 'component')}.json`
  const targetPath = path.join(componentsDir, fileName)

  await fs.writeFile(targetPath, JSON.stringify(component, null, 2))
}

console.log(`split ${components.length} component schemas into materials/components`)
