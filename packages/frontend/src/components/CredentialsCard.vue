<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Tag from "primevue/tag";
import { ref } from "vue";

defineProps<{
  hasCredentials: boolean;
  maskedAccessKeyId: string | undefined;
  disabled: boolean;
}>();

const emit = defineEmits<{
  save: [accessKeyId: string, secretAccessKey: string];
}>();

const accessKeyId = ref("");
const secretAccessKey = ref("");

const handleSave = () => {
  emit("save", accessKeyId.value, secretAccessKey.value);
  accessKeyId.value = "";
  secretAccessKey.value = "";
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <div class="flex items-center gap-2 text-base font-medium">
        <i class="fas fa-key text-primary-400"></i>
        <span> AWS Credentials </span>
      </div>
      <span class="text-surface-400 text-sm">
        Provide IAM credentials with API Gateway permissions
      </span>
    </div>

    <div v-if="hasCredentials" class="flex items-center gap-2">
      <Tag value="Configured" severity="success" />
      <span class="text-surface-400 text-sm">{{ maskedAccessKeyId }}</span>
    </div>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-surface-400 text-sm">Access Key ID</label>
        <InputText
          v-model="accessKeyId"
          placeholder="AKIAIOSFODNN7EXAMPLE"
          :disabled="disabled"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-surface-400 text-sm">Secret Access Key</label>
        <Password
          v-model="secretAccessKey"
          placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
          :feedback="false"
          toggle-mask
          :disabled="disabled"
        />
      </div>
      <Button
        label="Save Credentials"
        :disabled="
          disabled || accessKeyId.length === 0 || secretAccessKey.length === 0
        "
        @click="handleSave"
      />
    </div>
  </div>
</template>
