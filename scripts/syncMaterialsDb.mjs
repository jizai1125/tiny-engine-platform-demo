import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const componentsDir = path.join(rootDir, 'materials', 'components')

const listComponentFiles = async () => {
  try {
    const entries = await fs.readdir(componentsDir, { withFileTypes: true })

    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(componentsDir, entry.name))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

const readComponents = async () => {
  const files = await listComponentFiles()

  if (!files.length) {
    console.warn('[syncMaterialsDb] no material component files found, please execute `pnpm split:materials` first.')
    process.exitCode = 1
    return { materials: [], failed: 0 }
  }

  const result = {
    materials: [],
    failed: 0
  }

  for (const file of files) {
    try {
      const component = JSON.parse(await fs.readFile(file, 'utf8'))

      if (!component?.component) {
        console.error(`[syncMaterialsDb] missing required field: component at ${path.relative(rootDir, file)}.`)
        result.failed++
        continue
      }

      result.materials.push({ file, component })
    } catch (error) {
      console.error(`[syncMaterialsDb] incorrect file format at ${path.relative(rootDir, file)}: ${error}.`)
      result.failed++
    }
  }

  return result
}

const syncMaterialsDb = async () => {
  const { materials, failed } = await readComponents()

  if (!materials.length) {
    if (failed) {
      console.info(`[syncMaterialsDb] summary: inserted 0, updated 0, skipped 0, failed ${failed}.`)
      process.exitCode = 1
    }

    return
  }

  const { default: MysqlConnection } = await import('./connection.mjs')
  const connection = new MysqlConnection()
  const summary = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed
  }

  try {
    await connection.connect()
    await connection.initUserComponentsTable()

    for (const { file, component } of materials) {
      try {
        const existingComponent = await connection.getComponentByName(component.component)

        if (!existingComponent) {
          await connection.insertComponent(component, file)
          console.info(`[syncMaterialsDb] ${component.component} inserted.`)
          summary.inserted++
          continue
        }

        const changes = connection.getComponentChanges(component, existingComponent)

        if (!changes.length) {
          console.info(`[syncMaterialsDb] ${component.component} skipped.`)
          summary.skipped++
          continue
        }

        await connection.updateComponent(component, file)
        console.info(`[syncMaterialsDb] ${component.component} updated.`)
        summary.updated++
      } catch (error) {
        summary.failed++
        console.error(`[syncMaterialsDb] failed to sync ${component.component}: ${error}.`)
      }
    }
  } catch (error) {
    summary.failed++
    console.error(`[syncMaterialsDb] failed to sync materials database: ${error}.`)
  } finally {
    if (connection.connected) {
      try {
        await connection.close()
      } catch (error) {
        console.warn(`[syncMaterialsDb] failed to close database connection: ${error}.`)
      }
    }

    console.info(
      `[syncMaterialsDb] summary: inserted ${summary.inserted}, updated ${summary.updated}, skipped ${summary.skipped}, failed ${summary.failed}.`
    )

    if (summary.failed) {
      process.exitCode = 1
    }
  }
}

syncMaterialsDb()
