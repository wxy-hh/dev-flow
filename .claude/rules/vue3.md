---
paths:
  - "src/**/*.vue"
---

# Vue 3 + TypeScript 规范

## 技术栈版本

- Vue 3.5 + `<script setup lang="ts">`
- Element Plus 2.x（自动导入）
- Vue Router 5
- Pinia 3（状态管理）
- TypeScript 6
- Vite 8

## 组件编写

只用 `<script setup lang="ts">` 语法：

```vue
<script setup lang="ts">
const count = ref(0)
const double = computed(() => count.value * 2)

onMounted(() => {
  console.log('mounted')
})
</script>

<template>
  <div>{{ double }}</div>
</template>
```

- **禁止使用 Options API**（`data()`, `methods`, `computed` 等）
- **禁止使用 `defineComponent`**
- 不要从 `vue` 显式导入 `ref`/`computed`/`watch` 等 — 已通过 `unplugin-auto-import` 自动导入
- `defineProps`/`defineEmits` 不需要导入，编译器宏自动可用

### 组件命名

- **`.vue` 文件**：PascalCase 多单词命名（如 `EnhancedTable.vue`）
- **模板中使用**：PascalCase（如 `<EnhancedTable />`）
- **组件目录**：每个组件独立目录，`index.vue` 作为入口

### 自动导入

项目通过 `unplugin-auto-import` 和 `unplugin-vue-components` 实现自动导入：
- Vue/Vue Router/Pinia API — 直接使用，无需 import
- `src/components/` 中的组件 — 直接使用，无需 import
- Element Plus 组件 — 直接使用，无需 import

## 样式

- 使用 `<style scoped lang="scss">` 避免样式污染
- CSS 变量定义在 `src/assets/style/index.scss`
- Element Plus 主题定制通过 CSS 变量覆盖
- 不在组件中使用 `::v-deep`（Vue 2 语法），使用 `:deep()`：

```vue
<style scoped lang="scss">
.container {
  :deep(.el-button) {
    padding: 8px 16px;
  }
}
</style>
```

## API 请求

使用 `src/utils/request.ts` 中统一的 request 封装，保持请求、响应、token 注入和 loading 逻辑集中管理。

```typescript
import { request } from '@/utils/request'

// GET 请求
const res = await request.get('/<service-prefix>/users', { params: { page: 1 } })

// POST 请求
const res = await request.post('/<service-prefix>/users', { name: 'test' })
```

- 请求路径以当前项目 API 模块和开发服务器代理配置为准，不默认假设 `/api` 前缀。
- 自定义 headers: `Cmp-Menu: 14`, `Cmp-Portal: 1`
- token 从 sessionStorage 读取并自动注入（Bearer Token）
- 请求/响应拦截器已配置，全屏 loading 动画
- 统一的中文 HTTP 错误提示
- 响应自动解包 `res.data`（当 `res.code` 为 `'0'` 或 `200` 时）

## 禁止事项

- 不要使用 Options API
- 不要使用 `defineComponent`
- 不要显式导入 Vue/Vue Router/Pinia API — 已自动导入
- 不要显式导入 `src/components/` 中的组件 — 已自动导入
- 不要使用 `::v-deep` — 使用 `:deep()`
- 不要使用 `$listeners` — Vue 3 中已移除
- 不要使用 `this.$refs` — 使用 `ref` + `Template Refs`
- 不要编辑 `auto-imports.d.ts` 和 `components.d.ts` — 生成文件

## 性能优化

### Vue 3 渲染优化

- 列表渲染使用 `:key`（唯一且稳定）
- 大列表使用虚拟滚动方案（如 `vue-virtual-scroller`）
- 路由级组件开启 `keep-alive` 缓存
- 避免模板中复杂计算，使用 `computed` 缓存
- 使用 `v-memo` 优化大列表中的静态部分
- 非首屏组件使用 `defineAsyncComponent` 异步加载

### 网络请求

- 使用 `src/utils/request.ts` 中的统一 request 封装
- 利用请求/响应拦截器统一处理 loading 和错误
- API 路径集中管理，避免重复拼接

### 图片优化

- 图标使用 SVG（`src/assets/img/svg/`）
- 大图使用 WebP 格式
- 非首屏图片使用懒加载
