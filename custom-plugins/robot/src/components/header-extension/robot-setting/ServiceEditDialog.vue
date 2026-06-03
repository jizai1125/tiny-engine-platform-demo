<template>
  <tiny-dialog-box
    v-model:visible="dialogVisible"
    append-to-body
    :title="isEdit ? '编辑模型服务' : '添加自定义服务'"
    width="600px"
    @close="handleClose"
  >
    <tiny-form
      ref="formRef"
      validate-on-rule-change
      :model="formData"
      :rules="rules"
      class="model-form"
      label-position="top"
      validate-type="text"
    >
      <tiny-form-item prop="label" label="服务名称">
        <tiny-input v-model="formData.label" placeholder="例如：DeepSeek"></tiny-input>
      </tiny-form-item>

      <tiny-form-item prop="baseUrl" label="Base URL">
        <tiny-input v-model="formData.baseUrl" placeholder="例如：https://api.deepseek.com/v1"></tiny-input>
      </tiny-form-item>

      <tiny-form-item prop="apiKey" label="API Key">
        <tiny-input
          type="password"
          v-model="formData.apiKey"
          :placeholder="isEdit && props.service?.hasApiKey ? '留空表示保留当前 API Key' : '请输入 API Key'"
          @input="state.apiKeyTouched = true"
        ></tiny-input>
      </tiny-form-item>

      <tiny-form-item>
        <tiny-checkbox v-model="formData.allowEmptyApiKey">允许服务端请求时不携带 API Key</tiny-checkbox>
      </tiny-form-item>

      <tiny-checkbox v-if="isEdit && props.service?.hasApiKey" v-model="state.clearApiKey">
        清空当前 API Key
      </tiny-checkbox>

      <tiny-divider>模型配置</tiny-divider>

      <div class="models-section">
        <div v-for="(model, index) in formData.models" :key="index" class="model-item">
          <div class="model-header">
            <span class="model-title">模型 {{ index + 1 }}</span>
            <tiny-button v-if="formData.models && formData.models.length > 1" type="text" @click="removeModel(index)">
              删除
            </tiny-button>
          </div>

          <tiny-form-item :prop="`models[${index}].name`" label="模型名称">
            <tiny-input v-model="model.name" placeholder="例如：deepseek-chat"></tiny-input>
          </tiny-form-item>

          <tiny-form-item :prop="`models[${index}].label`" label="显示名称">
            <tiny-input v-model="model.label" placeholder="例如：DeepSeek Chat"></tiny-input>
          </tiny-form-item>

          <tiny-form-item label="模型能力">
            <div class="capabilities-group">
              <tiny-checkbox v-model="model.capabilities!.toolCalling">工具调用</tiny-checkbox>
              <tiny-checkbox v-model="model.capabilities!.vision">视觉理解</tiny-checkbox>
              <tiny-checkbox v-model="model.capabilities!.compact">快速模型</tiny-checkbox>
            </div>
          </tiny-form-item>
        </div>

        <tiny-button type="text" @click="addModel" class="add-model-btn">+ 添加模型</tiny-button>
      </div>
    </tiny-form>

    <template #footer>
      <tiny-button @click="handleClose" style="margin: 0px 10px">取消</tiny-button>
      <tiny-button type="primary" @click="handleConfirm">确定</tiny-button>
    </template>
  </tiny-dialog-box>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import {
  TinyDialogBox,
  TinyForm,
  TinyFormItem,
  TinyInput,
  TinyButton,
  TinyDivider,
  TinyCheckbox
} from '@opentiny/vue'
import type { ModelService, ModelConfig } from '../../../types/setting.types'

const props = defineProps<{
  visible: boolean
  service?: ModelService
}>()

const emit = defineEmits<{
  (e: 'confirm', service: Partial<ModelService> & { apiKey?: string }): void
}>()

const dialogVisible = defineModel<boolean>('visible', {
  required: true
})

const formRef = ref<any>(null)
const isEdit = computed(() => Boolean(props.service))

const createEmptyModel = (): ModelConfig => ({
  name: '',
  label: '',
  capabilities: {
    toolCalling: false,
    vision: false,
    reasoning: false,
    compact: false
  }
})

const state = reactive({
  clearApiKey: false,
  apiKeyTouched: false
})

const formData = reactive({
  label: '',
  baseUrl: '',
  apiKey: '',
  provider: 'custom',
  allowEmptyApiKey: false,
  models: [createEmptyModel()] as ModelConfig[]
})

const baseRules = {
  label: [{ required: true, type: 'string', message: '请输入服务名称' }],
  baseUrl: [{ required: true, type: 'url', message: '请输入正确的模型服务 Base URL' }]
}

const rules = computed(() => {
  return formData.models.reduce((result: Record<string, any>, _model, index) => {
    result[`models[${index}].name`] = [{ required: true, type: 'string', message: '请输入模型名称' }]
    result[`models[${index}].label`] = [{ required: true, type: 'string', message: '请输入显示名称' }]
    return result
  }, { ...baseRules })
})

const resetForm = () => {
  formData.label = ''
  formData.baseUrl = ''
  formData.apiKey = ''
  formData.provider = 'custom'
  formData.allowEmptyApiKey = false
  formData.models = [createEmptyModel()]
  state.clearApiKey = false
  state.apiKeyTouched = false
  formRef.value?.clearValidate()
}

const updateForm = (service?: ModelService) => {
  // 先重置为初始状态
  resetForm()

  if (!service) {
    return
  }

  formData.label = service.label
  formData.baseUrl = service.baseUrl
  formData.provider = service.provider
  formData.allowEmptyApiKey = service.allowEmptyApiKey
  formData.models = JSON.parse(JSON.stringify(service.models))
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      updateForm(props.service)
    }
  }
)

const addModel = () => {
  formData.models.push(createEmptyModel())
}

const removeModel = (index: number) => {
  formData.models.splice(index, 1)
}

const handleClose = () => {
  dialogVisible.value = false
}

const handleConfirm = () => {
  formRef.value?.validate((valid: boolean) => {
    if (!valid) {
      return
    }

    const serviceData: Partial<ModelService> & { apiKey?: string } = {
      label: formData.label,
      baseUrl: formData.baseUrl,
      provider: formData.provider,
      allowEmptyApiKey: formData.allowEmptyApiKey,
      models: JSON.parse(JSON.stringify(formData.models))
    }

    // 内置服务只更新API Key
    if (state.clearApiKey) {
      serviceData.apiKey = ''
    } else if (formData.apiKey) {
      serviceData.apiKey = formData.apiKey
    } else if (!isEdit.value) {
      serviceData.apiKey = ''
    }

    if (isEdit.value && props.service) {
      serviceData.id = props.service.id
    }

    emit('confirm', serviceData)
    handleClose()
  })
}
</script>

<style lang="less" scoped>
.model-form {
  overflow-y: auto;
  max-height: calc(70vh);
}

.models-section {
  margin-top: 16px;
}

.model-item {
  padding: 16px;
  background: var(--te-base-color-bg-2, #f5f5f5);
  border-radius: 4px;
  margin-bottom: 12px;
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.model-title {
  font-weight: 600;
  font-size: 14px;
}

.capabilities-group {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.add-model-btn {
  width: 100%;
  margin-top: 8px;
}
</style>
