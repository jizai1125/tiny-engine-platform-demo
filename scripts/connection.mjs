import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import mysql from 'mysql'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const componentsTableName = 't_component'
const materialHistoryId = 1
const componentUpdateFields = [
  'version',
  'name',
  'name_en',
  'icon',
  'description',
  'docUrl',
  'screenshot',
  'tags',
  'keywords',
  'devMode',
  'npm',
  'group',
  'category',
  'priority',
  'snippets',
  'schema',
  'configure',
  'public',
  'framework',
  'isOfficial',
  'isDefault',
  'tiny_reserved',
  'tenant',
  'createBy',
  'updatedBy'
]
const jsonCompareFields = ['name', 'npm', 'snippets', 'schema', 'configure', 'component_metadata']

dotenv.config({ path: path.join(rootDir, '.env'), quiet: true })
dotenv.config({ path: path.join(rootDir, '.env.local'), override: true, quiet: true })
dotenv.config({ path: path.join(rootDir, 'designer', 'env', '.env.development'), quiet: true })

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

class MysqlConnection {
  constructor(config) {
    const { SQL_HOST, SQL_PORT, SQL_USER, SQL_PASSWORD, SQL_DATABASE } = process.env

    this.config = config || {
      host: SQL_HOST,
      port: SQL_PORT,
      user: SQL_USER,
      password: SQL_PASSWORD,
      database: SQL_DATABASE
    }
    this.connected = false
    this.connection = mysql.createConnection(this.config)
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.connection.connect((error) => {
        if (error) {
          reject(error)
        } else {
          this.connected = true
          resolve()
        }
      })
    })
  }

  close() {
    return new Promise((resolve, reject) => {
      this.connection.end((error) => {
        this.connected = false

        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  query(sql, values) {
    return new Promise((resolve, reject) => {
      this.connection.query(sql, values, (error, result) => {
        if (error) {
          reject(error)
        } else {
          resolve(result)
        }
      })
    })
  }

  fieldTransform(field) {
    const fieldMap = {
      docUrl: 'doc_url',
      devMode: 'dev_mode',
      schema: 'schema_fragment'
    }

    return fieldMap[field] || field
  }

  getComponentUpdateEntries(component) {
    return componentUpdateFields
      .filter((key) => Object.prototype.hasOwnProperty.call(component, key))
      .map((key) => ({
        key,
        field: this.fieldTransform(key),
        value: component[key]
      }))
      .filter(({ field, value }) => !['id', 'component'].includes(field) && value !== void 0)
  }

  normalizeCompareValue(value, key) {
    if (value === void 0) {
      return void 0
    }

    if (value === null) {
      return null
    }

    if (jsonCompareFields.includes(key)) {
      if (typeof value === 'string') {
        try {
          return stableStringify(JSON.parse(value))
        } catch {
          return value
        }
      }

      return stableStringify(value)
    }

    return String(value)
  }

  getComponentChanges(component, row) {
    return this.getComponentUpdateEntries(component)
      .filter(({ key, field, value }) => {
        const expected = this.normalizeCompareValue(value, key)
        const current = this.normalizeCompareValue(row[field], key)

        return expected !== current
      })
      .map(({ field }) => field)
  }

  getComponentByName(componentName) {
    return this.query(`SELECT * FROM ${this.config.database}.${componentsTableName} WHERE name_en = ?`, [
      componentName
    ]).then((result) => result[0])
  }

  isValid(component, file) {
    const longTextFields = ['name', 'npm', 'snippets', 'schema', 'schema_fragment', 'configure', 'component_metadata']

    return Object.entries(component).every(([key, value]) => {
      if (longTextFields.includes(key) && value !== null && typeof value !== 'object') {
        console.error(`[materialsDb] the value of "${key}" is not valid JSON at ${file}.`)

        return false
      }

      return true
    })
  }

  formatValue(value) {
    if (typeof value === 'string') {
      return value
    }

    if (value === null || value === void 0 || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }

    return JSON.stringify(value)
  }

  updateComponent(component, file) {
    if (!this.isValid(component, file)) {
      return Promise.resolve(false)
    }

    const entries = this.getComponentUpdateEntries(component)

    if (!entries.length) {
      return Promise.resolve(false)
    }

    const setSql = entries.map(({ field }) => `\`${field}\` = ?`).join(', ')
    const values = entries.map(({ value }) => this.formatValue(value))

    return this.query(`UPDATE ${componentsTableName} SET ${setSql} WHERE name_en = ?`, [
      ...values,
      component.component
    ]).then(() => true)
  }

  relationMaterialHistory(id) {
    return this.query(
      'SELECT * FROM `r_material_history_component` WHERE `material_history_id` = ? AND `component_id` = ?',
      [materialHistoryId, id]
    ).then((result) => {
      if (result.length) {
        return null
      }

      return this.query(
        'INSERT INTO `r_material_history_component` (`material_history_id`, `component_id`) VALUES (?, ?)',
        [materialHistoryId, id]
      )
    })
  }

  insertComponent(component, file) {
    if (!this.isValid(component, file)) {
      return Promise.resolve(false)
    }

    const defaultName = {
      zh_CN: component.component
    }
    const defaultNpm = {
      package: '',
      exportName: '',
      version: '1.0.0',
      destructuring: true
    }
    const defaultConfigure = {
      loop: true,
      condition: true,
      styles: true,
      isContainer: true,
      isModal: false,
      nestingRule: {
        childWhiteList: '',
        parentWhiteList: '',
        descendantBlacklist: '',
        ancestorWhitelist: ''
      },
      isNullNode: false,
      isLayout: false,
      rootSelector: '',
      shortcuts: {
        properties: ['value', 'disabled']
      },
      contextMenu: {
        actions: ['create symbol'],
        disable: ['copy', 'remove']
      }
    }
    const {
      version = '1.0.0',
      name = defaultName,
      component: componentName,
      icon,
      description,
      docUrl,
      screenshot,
      tags,
      keywords,
      devMode = 'proCode',
      npm = defaultNpm,
      group,
      category = 'general',
      priority = 1,
      snippets = [{}],
      schema = {},
      configure = defaultConfigure,
      public: publicRight = 0,
      framework = 'vue',
      isOfficial = 0,
      isDefault = 0,
      tiny_reserved = 0,
      component_metadata = null,
      library_id = 1,
      tenant_id = 1,
      renter_id = 1,
      site_id = 1,
      created_by = 1,
      last_updated_by = 1
    } = component
    const fields = [
      'version',
      'name',
      'name_en',
      'icon',
      'description',
      'doc_url',
      'screenshot',
      'tags',
      'keywords',
      'dev_mode',
      '`group`',
      '`category`',
      'priority',
      'npm',
      'snippets',
      'schema_fragment',
      'configure',
      '`public`',
      'framework',
      'is_official',
      'is_default',
      'tiny_reserved',
      'component_metadata',
      'library_id',
      'tenant_id',
      'renter_id',
      'site_id',
      'created_by',
      'last_updated_by'
    ]
    const values = [
      version,
      JSON.stringify(name),
      componentName,
      icon,
      description,
      docUrl,
      screenshot,
      tags,
      keywords,
      devMode,
      group,
      category,
      priority,
      JSON.stringify(npm),
      JSON.stringify(snippets),
      JSON.stringify(schema),
      JSON.stringify(configure),
      publicRight,
      framework,
      isOfficial,
      isDefault,
      tiny_reserved,
      component_metadata,
      library_id,
      tenant_id,
      renter_id,
      site_id,
      created_by,
      last_updated_by
    ]
    const placeholders = values.map(() => '?').join(', ')

    return this.query(`INSERT INTO ${componentsTableName} (${fields.join(', ')}) VALUES (${placeholders})`, values).then(
      (result) => this.relationMaterialHistory(result.insertId).then(() => true)
    )
  }

  createUserComponentsTable() {
    const sqlContent = `
      CREATE TABLE ${componentsTableName} (
        id int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
        version varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        name longtext CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        name_en varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        icon varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        description varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        doc_url varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        screenshot varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        tags varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        keywords varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        dev_mode varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        npm longtext CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        \`group\` varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        category varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NULL DEFAULT NULL,
        priority int(11) NULL DEFAULT NULL,
        snippets longtext CHARACTER SET utf8 COLLATE utf8_general_ci NULL,
        schema_fragment longtext CHARACTER SET utf8 COLLATE utf8_general_ci NULL,
        configure longtext CHARACTER SET utf8 COLLATE utf8_general_ci NULL,
        created_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NULL DEFAULT CURRENT_TIMESTAMP,
        \`public\` int(11) NULL DEFAULT NULL,
        framework varchar(255) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
        is_official tinyint(1) NULL DEFAULT NULL,
        is_default tinyint(1) NULL DEFAULT NULL,
        tiny_reserved tinyint(1) NULL DEFAULT NULL,
        component_metadata longtext CHARACTER SET utf8 COLLATE utf8_general_ci NULL,
        library_id int(11) NULL DEFAULT NULL,
        tenant_id int(11) NULL DEFAULT NULL,
        renter_id int(11) NULL DEFAULT NULL,
        site_id int(11) NULL DEFAULT NULL,
        created_by int(11) NULL DEFAULT NULL,
        last_updated_by int(11) NULL DEFAULT NULL,
        PRIMARY KEY (id) USING BTREE,
        UNIQUE INDEX unique_component(name_en, framework, version) USING BTREE
      ) ENGINE = InnoDB CHARACTER SET = utf8 COLLATE = utf8_general_ci ROW_FORMAT = DYNAMIC;
    `.replace(/\n/g, '')

    return this.query(sqlContent)
  }

  initUserComponentsTable() {
    return this.query(`SHOW TABLES LIKE '${componentsTableName}'`).then((result) => {
      if (result.length) {
        return null
      }

      return this.createUserComponentsTable()
    })
  }
}

export default MysqlConnection
