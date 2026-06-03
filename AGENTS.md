# TinyEngine Platform Demo 仓库说明

## 适用范围

这是一份给 `D:\myspace\tiny-engine-platform-demo` 这个生成项目用的仓库约定，不是上游源码仓 `D:\myspace\tiny-engine` 的说明。

- 默认作用于整个仓库，除非子目录还有更近的 `AGENTS.md`
- 优先使用这个生成项目自己的扩展点，不要先去改上游源码仓
- 这里的 `@opentiny/tiny-engine` 及相关包都按依赖看待，不要假设上游源码目录结构在这里也存在

## 仓库现状

- 包管理器：`pnpm`
- 主应用：`designer/`
- 本地自定义插件：`custom-plugins/*`
- 本地物料：`materials/`
- 本地脚本：`scripts/`
- 依赖补丁：`patches/`，通过 `pnpm-workspace.yaml` 挂载

## 工作方式

- 先从这个生成项目当前真实生效的入口和扩展点开始看
- 优先改这些位置：
  - `designer/registry.js`
  - `designer/src/**`
  - `designer/env/**`
  - `custom-plugins/**`
  - `materials/**`
  - `scripts/**`
  - `patches/**`
- 不要直接改 `node_modules`
- 如果问题属于上游依赖包，但这个生成项目必须承接修复，就用 `patches/**` + `pnpm-workspace.yaml`
- 改动保持收敛，不要把上游源码仓的大改动整包同步过来，除非用户明确要求

## 当前真实扩展点

- 设计器注册表覆盖入口在 `designer/registry.js`
- 当前本地服务覆盖有：
  - `META_SERVICE.Http` -> `designer/src/composable/http`
  - `META_SERVICE.GenerateCode` -> `designer/src/page-type/index.js`
- 当前本地插件覆盖有：
  - `META_APP.AppManage` -> `@demo/tiny-engine-plugin-page`
  - `META_APP.Robot` -> `@demo/tiny-engine-plugin-robot`
- 如果要覆盖内置插件，优先在 `designer/registry.js` 里用同一个 `META_APP` 槽位注册本地插件，不要先改上游包

## 登录和后端联调约定

- 本地开发目前走 `designer/env/.env.development`
- 当前开发态联调后端地址是：`VITE_ORIGIN=http://localhost:9090`
- 当前开发态开启登录：`VITE_AUTH=true`
- 如果前端请求出现没带 token、登录态不生效、AI 接口 401/未登录这类问题，优先检查：
  - `designer/src/composable/http/index.js`
- 不要私自把 AI 聊天链路改回“开发态免登录”，除非用户明确要求

## 依赖补丁规则

- 如果修复点属于上游依赖包，但这个生成项目必须落地，就在 `patches/` 新增或更新 patch
- 每新增一个 patch，都必须同步更新 `pnpm-workspace.yaml`
- 改完 `patches/` 或 `pnpm-workspace.yaml` 后，必须运行 `pnpm install`
- 要确认 patch 真正命中了实际运行的依赖实例，不能只看 lock 文件
- 回答里要说明 patch 影响的是哪个运行包，不要含糊说“补了个依赖 patch”

## 常用命令

### 安装和启动

```sh
pnpm install
pnpm dev
pnpm dev:designer
```

### 定向构建

```sh
pnpm build:materials
pnpm build:plugins
pnpm --filter @demo/tiny-engine-plugin-page build
pnpm --filter @demo/tiny-engine-plugin-robot build
pnpm --filter designer build
```

### 本地脚本

```sh
node scripts/buildMaterials.mjs
node scripts/splitMaterials.mjs
node scripts/probeModelCapabilities.mjs
```

## 验证规则

按改动范围跑最小必要验证。

1. 改 `custom-plugins/robot/**`
   跑 `pnpm --filter @demo/tiny-engine-plugin-robot build`

2. 改 `custom-plugins/page/**`
   跑 `pnpm --filter @demo/tiny-engine-plugin-page build`

3. 改 `designer/src/**`、`designer/registry.js`、`designer/env/**`
   优先跑 `pnpm --filter designer build`
   如果构建被环境问题挡住，至少跑语法检查或最近的局部构建，并明确说明没验证到哪里

4. 改 `materials/**` 或 `scripts/buildMaterials.mjs`
   跑 `pnpm build:materials`

5. 改 `patches/**` 或 `pnpm-workspace.yaml`
   跑 `pnpm install`
   然后确认实际生效的依赖文件已经带上补丁，不只看 `pnpm-lock.yaml`

## 这个仓库的偏好

- AI 插件相关工作，优先改 `custom-plugins/robot`
- 页面生成、预览、代码生成链路，优先改 `designer/src/page-type/**`
- HTTP、登录、token、请求头链路，优先改 `designer/src/composable/http/index.js`
- `designer/tmp/` 下的文件默认按临时产物或调试产物看待，除非任务明确提到它

## 不要做的事

- 不要把这个生成项目按上游源码仓方式重构
- 不要直接改 `node_modules` 里的文件
- 不要把真实密钥、真实 token、真实接口凭据写进仓库
- 不要默认认为 `D:\myspace\tiny-engine` 的命令、路径、构建入口可以原样套用到这里
