## AI 插件模型配置后端化最终方案

### 摘要
本方案按以下确定结论实施：

- 模型服务定义全部从后端读取，前端不再维护内置服务定义
- 内置服务与用户自定义服务统一为一套服务模型
- 默认模型与快速模型按用户保存，因此下拉同时包含内置服务和当前用户自己的自定义服务
- 聊天请求不再传模型服务 `Authorization`，只传 `serviceKey + model`
- `chatMode`、`enableThinking` 继续保存在前端本地
- `customCompatibleAIModels` 废弃
- 不做现有本地配置迁移

---

## 一、数据模型

### 1.1 `t_ai_model_service`
统一存放所有 AI 服务，内置服务和用户自定义服务都在这张表里。

| 字段名 | 类型建议 | 含义 | 备注 |
| --- | --- | --- | --- |
| `id` | bigint / varchar | 主键 | 数据库内部唯一标识 |
| `tenant_id` | varchar | 租户 id | 多租户隔离 |
| `platform_id` | bigint / int | 平台 id | 按设计器/平台隔离服务配置 |
| `scope_type` | varchar | 服务作用域 | `PLATFORM`=内置共享，`USER`=用户私有 |
| `owner_user_id` | varchar | 服务归属用户 | 内置服务为空；用户自定义服务为创建者 id |
| `service_key` | varchar | 服务稳定业务标识 | 如 `deepseek`、`qwen`、`custom_xxx` |
| `provider` | varchar | 提供商标识 | 如 `deepseek`、`qwen`、`openai-compatible` |
| `label` | varchar | 服务展示名称 | 仅用于 UI 展示，不作为稳定引用键 |
| `base_url` | varchar / text | 模型服务地址 | 后端聊天时实际使用 |
| `api_key` | varchar / text | 服务密钥 | 只保存加密后的 `EKEY_...` |
| `allow_empty_api_key` | boolean | 是否允许空 key | 内网代理等场景可用 |
| `models_json` | json / text | 模型列表 | 存 `name`、`label`、`capabilities` 等 |
| `is_built_in` | boolean | 是否内置服务 | `true`=内置，`false`=用户自定义 |
| `editable` | boolean | 是否允许前端编辑 | 内置固定 `false`，自定义固定 `true` |
| `enabled` | boolean | 是否启用 | 可临时停用而不删除 |
| `deprecated` | boolean | 是否废弃 | 主要用于内置服务升级后的兼容保留 |
| `seed_spec_hash` | varchar | 内置服务定义指纹 | 用于判断种子定义是否变化 |
| `seed_version` | varchar / int | 内置服务种子版本 | 用于标记该记录按哪版种子同步 |
| `sort` | int | 排序值 | 前端展示顺序 |

字段范围说明：
- 上表只列 AI 配置方案关心的业务字段。
- 在 `tiny-engine-backend-java` 实际落库时，还会叠加仓库统一的 `BaseEntity` 通用字段，例如：`created_by`、`last_updated_by`、`created_time`、`last_updated_time`、`tenant_id`、`renter_id`、`site_id`。
- 这些通用字段不是 AI 方案额外扩展出来的业务语义，只是沿用后端现有表设计规范。

约束：

| 约束 | 说明 |
| --- | --- |
| 唯一键 `(platform_id, scope_type, owner_user_id, service_key)` | 保证同一作用域下服务标识唯一 |

### 1.2 `t_ai_user_setting`
存用户自己的默认模型和快速模型设置。

| 字段名 | 类型建议 | 含义 | 备注 |
| --- | --- | --- | --- |
| `id` | bigint / varchar | 主键 | 数据库内部唯一标识 |
| `tenant_id` | varchar | 租户 id | 多租户隔离 |
| `platform_id` | bigint / int | 平台 id | 按平台隔离用户设置 |
| `user_id` | varchar | 用户 id | 当前设置归属人 |
| `default_service_key` | varchar | 默认模型所属服务 | 对应 `t_ai_model_service.service_key` |
| `default_model_name` | varchar | 默认模型名 | 对应 `models_json[].name` |
| `quick_service_key` | varchar | 快速模型所属服务 | 对应 `t_ai_model_service.service_key` |
| `quick_model_name` | varchar | 快速模型名 | 对应 `models_json[].name` |

字段范围说明：
- 上表同样只列 AI 用户设置的业务字段。
- 在 `tiny-engine-backend-java` 实际表结构中，也会带上统一的审计/租户字段，例如：`created_by`、`last_updated_by`、`created_time`、`last_updated_time`、`tenant_id`、`renter_id`、`site_id`。
- 因此如果对照数据库 DDL 看到字段比本文多，优先按“业务字段 + 通用基类字段”理解，而不是认为方案新增了额外业务列。

规则：

| 规则 | 说明 |
| --- | --- |
| 仅可保存当前用户可见服务 | 可见服务 = 所有内置服务 + 当前用户自己的自定义服务 |
| 被引用的自定义服务删除后自动回退 | 回退到第一个有效内置模型 |

### 1.3 `seed_spec_hash` / `seed_version` 说明
这两个字段只用于内置服务种子同步。

| 字段 | 作用 | 实际用法 |
| --- | --- | --- |
| `seed_spec_hash` | 标记当前内置服务定义内容的指纹 | 启动同步时对种子中的定义字段计算 hash，并与库中值比较；相同则跳过定义更新，不同则更新定义字段并刷新 hash |
| `seed_version` | 标记该记录是按哪版种子同步的 | 每次同步成功后写入当前种子版本，便于排查升级和环境差异 |

参与 hash 的定义字段固定为：
- `service_key`
- `provider`
- `label`
- `base_url`
- `allow_empty_api_key`
- `models`
- `sort`

不参与 hash 的字段固定为：
- `api_key`
- `enabled`
- 运行时状态

---

## 二、内置服务种子同步

### 2.1 来源
后端维护内置服务种子文件，例如：

- `resources/ai-services/builtin-services.json`

### 2.2 种子字段

| 字段名 | 含义 |
| --- | --- |
| `service_key` | 内置服务稳定标识 |
| `provider` | 提供商标识 |
| `label` | 展示名 |
| `base_url` | 请求地址 |
| `allow_empty_api_key` | 是否允许空 key |
| `models` | 模型列表 |
| `sort` | 排序值 |
| `seed_version` | 种子版本 |

### 2.3 同步策略
应用启动时执行 `syncBuiltinAiServices()`：

| 场景 | 行为 |
| --- | --- |
| 记录不存在 | 插入新内置服务，并写入 `seed_spec_hash`、`seed_version` |
| 记录存在且 hash 相同 | 跳过定义字段更新；补写 `seed_version` |
| 记录存在且 hash 不同 | 更新定义字段，并写入新的 `seed_spec_hash`、`seed_version` |

定义字段更新范围固定为：
- `provider`
- `label`
- `base_url`
- `allow_empty_api_key`
- `models_json`
- `sort`
- `seed_spec_hash`
- `seed_version`

运行字段始终保留：
- `api_key`
- `enabled`

如果某个旧内置服务已经不在新种子中：
- 不删除
- 标记 `deprecated = true`

---

## 三、接口与链路

### 3.1 服务配置查询接口
`GET /app-center/api/ai/services`

返回当前用户可见的全部服务：
- 所有内置服务
- 当前用户自己的自定义服务

返回 DTO：

| 字段名 | 含义 |
| --- | --- |
| `id` | 服务记录主键 |
| `serviceKey` | 稳定业务标识 |
| `provider` | 提供商标识 |
| `label` | 展示名 |
| `baseUrl` | 服务地址 |
| `models` | 可选模型列表 |
| `isBuiltIn` | 是否内置 |
| `scopeType` | `PLATFORM` 或 `USER` |
| `editable` | 当前前端是否允许编辑 |
| `enabled` | 是否启用 |
| `deprecated` | 是否废弃 |
| `hasApiKey` | 是否已配置密钥 |
| `allowEmptyApiKey` | 是否允许空 key |

接口规则：
- 不返回明文 `apiKey`

### 3.2 用户自定义服务管理接口
- `POST /app-center/api/ai/services`
- `POST /app-center/api/ai/services/{id}`
- `DELETE /app-center/api/ai/services/{id}`

规则：

| 规则 | 说明 |
| --- | --- |
| 仅允许操作 `scope_type = USER` | 内置服务不可通过这组接口编辑 |
| 仅允许操作自己的服务 | `owner_user_id = 当前用户` |
| `apiKey` 缺失 | 保留原值 |
| `apiKey` 非空 | 替换并加密 |
| `apiKey` 空字符串 | 清空 |

### 3.3 用户模型设置接口
- `GET /app-center/api/ai/settings`
- `POST /app-center/api/ai/settings`

返回 / 保存结构：

| 字段 | 子字段 | 含义 |
| --- | --- | --- |
| `defaultModel` | `serviceKey` | 默认模型所属服务 |
| `defaultModel` | `modelName` | 默认模型名称 |
| `quickModel` | `serviceKey` | 快速模型所属服务 |
| `quickModel` | `modelName` | 快速模型名称 |

保存校验：

| 校验项 | 说明 |
| --- | --- |
| 服务可见性 | 目标服务必须对当前用户可见 |
| 模型存在性 | 目标模型必须存在于该服务 `models_json` 中 |
| 服务状态 | 服务不能禁用或废弃 |

### 3.4 聊天接口与请求 DTO
后端聊天主链路使用 `ChatRequest` 作为请求 DTO，对应两个接口：

- `POST /app-center/api/ai/chat`
- `POST /app-center/api/chat/completions`

`ChatRequest` 位置：
- `base/src/main/java/com/tinyengine/it/model/dto/ChatRequest.java`

控制器入口：
- `base/src/main/java/com/tinyengine/it/controller/AiChatController.java`

两个接口最终都进入同一个后端实现：
- `AiChatV1ServiceImpl.chatCompletion()`

在 `ChatRequest` 上新增字段：

| 字段名 | 含义 |
| --- | --- |
| `serviceKey` | 本次聊天使用的服务标识 |
| `model` | 本次聊天使用的模型名 |

### 3.5 聊天链路改造总结
当前实现中，前端会把服务 `apiKey` 放进 `Authorization: Bearer ...`，后端两个聊天接口也强依赖这个请求头。
本方案改造后，聊天链路统一改为“前端只传服务标识，后端自行解析服务配置”。

改造后的链路：

| 步骤 | 行为 |
| --- | --- |
| 1 | 前端发送聊天请求到 `/app-center/api/ai/chat` 或 `/app-center/api/chat/completions` |
| 2 | 请求体使用 `ChatRequest`，携带 `serviceKey`、`model`、`messages` 等字段 |
| 3 | 前端不再传模型服务 `Authorization` |
| 4 | `AiChatController` 接收请求后，继续转给 `AiChatV1ServiceImpl.chatCompletion()` |
| 5 | 后端根据 `serviceKey` 查询 `t_ai_model_service` |
| 6 | 命中内置服务时，使用库里的 `base_url + api_key + models_json` |
| 7 | 命中用户自定义服务时，校验 `owner_user_id = 当前用户` 后再使用其配置 |
| 8 | 若服务不存在、无权限、禁用、废弃，直接报错 |
| 9 | 若服务要求 key 且未配置，直接报错 |
| 10 | 后端按查到的 `base_url + api_key` 去请求真实模型服务 |

改造结果：

| 改造点 | 结果 |
| --- | --- |
| 前端是否传 `Authorization` | 不再传 |
| 前端是否持有服务密钥 | 不再持有 |
| 服务配置唯一来源 | 后端数据库 |
| 内置 / 自定义服务解析方式 | 统一走 `serviceKey -> t_ai_model_service` |

---

## 四、前端改造点

### 4.1 `useConfig.ts`
本地不再保存这些主配置：

| 不再本地保存的字段 | 说明 |
| --- | --- |
| `services` | 服务列表改为后端获取 |
| `defaultModel` | 默认模型改为后端获取 |
| `quickModel` | 快速模型改为后端获取 |

初始化改为请求：

| 接口 | 用途 |
| --- | --- |
| `/app-center/api/ai/services` | 获取当前用户可见服务 |
| `/app-center/api/ai/settings` | 获取当前用户默认模型和快速模型 |

本地继续保留：

| 字段 | 说明 |
| --- | --- |
| `chatMode` | 对话模式偏好 |
| `enableThinking` | 是否开启思考偏好 |

### 4.2 设置面板行为

#### 模型选择页

| 控件 | 数据范围 |
| --- | --- |
| 默认模型下拉 | 当前用户可见的所有模型 |
| 快速模型下拉 | 当前用户可见的所有 `compact` 模型 |

因此都包含：
- 内置服务模型
- 当前用户自己的自定义服务模型

#### 模型服务页

| 服务类型 | 行为 |
| --- | --- |
| 内置服务 | 只读展示，不可编辑 |
| 用户自定义服务 | 可新增、可编辑、可删除 |

### 4.3 废弃项

| 废弃项 | 说明 |
| --- | --- |
| `customCompatibleAIModels` | 直接废弃 |
| `DEFAULT_LLM_MODELS` 作为主来源 | 不再作为服务主数据源 |
| 前端 Bearer Token 传模型密钥 | 不再使用 |

---

## 五、测试与验收

### 数据层

| 场景 | 验收点 |
| --- | --- |
| 内置服务首次同步 | 能正确写入 |
| 重复同步 | 不重复插入 |
| hash 未变化 | 不重复覆盖定义字段 |
| hash 已变化 | 更新定义字段并刷新 `seed_spec_hash` / `seed_version` |
| 种子移除旧服务 | 只标记 `deprecated`，不删除 |
| 已配置共享密钥 | 不会被种子覆盖 |

### 可见性与隔离

| 场景 | 验收点 |
| --- | --- |
| 用户查看服务列表 | 能看到所有内置服务 |
| 用户查看自定义服务 | 只能看到自己的 |
| 用户操作自定义服务 | 不能编辑或使用别人的服务 |

### 设置面板

| 场景 | 验收点 |
| --- | --- |
| 默认模型/快速模型下拉 | 同时包含内置和当前用户自定义服务 |
| 选择自定义服务为默认模型 | 可以成功保存 |
| 删除被引用的自定义服务 | 自动回退到有效内置模型 |

### 聊天链路

| 场景 | 验收点 |
| --- | --- |
| 不传 `Authorization` | 仍能正常请求 |
| 命中无权限服务 | 返回明确错误 |
| 命中未配置 key 的服务 | 返回明确错误 |
| 两个聊天接口 | 都能按 `serviceKey` 正常解析服务配置 |
