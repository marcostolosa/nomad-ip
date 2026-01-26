<script setup lang="ts">
import Tag from "primevue/tag";
import ToggleSwitch from "primevue/toggleswitch";
import { computed } from "vue";

const props = defineProps<{
  enabled: boolean;
  loading: boolean;
  endpointCount: number;
  canEnable: boolean;
  statusMessage: string;
  hasCredentials: boolean;
  hasEndpoints: boolean;
}>();

const emit = defineEmits<{
  activate: [];
  deactivate: [];
}>();

const toggleEnabled = computed({
  get: () => props.enabled,
  set: (value: boolean) => {
    if (value) {
      emit("activate");
    } else {
      emit("deactivate");
    }
  },
});
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <i
          class="fas fa-circle text-sm"
          :class="enabled ? 'text-green-500' : 'text-surface-500'"
        ></i>
        <span class="text-lg font-medium">
          {{ enabled ? "IP Rotation Active" : "IP Rotation Inactive" }}
        </span>
        <Tag
          :value="enabled ? 'Enabled' : 'Disabled'"
          :severity="enabled ? 'success' : 'secondary'"
        />
      </div>
      <ToggleSwitch
        v-model="toggleEnabled"
        :disabled="loading || (!canEnable && !enabled)"
      />
    </div>

    <p class="text-surface-400">
      Route traffic through AWS API Gateway endpoints to rotate your source IP
      address on each request. Useful for bypassing IP-based rate limiting, WAF
      blocks, and brute-force protections.
    </p>

    <div v-if="statusMessage" class="text-surface-400">
      <i class="fas fa-spinner fa-spin mr-2"></i>
      {{ statusMessage }}
    </div>

    <div v-else-if="enabled" class="text-surface-400">
      <i class="fas fa-check-circle text-green-500 mr-2"></i>
      {{ endpointCount }} endpoints routing traffic
    </div>

    <div v-else class="flex flex-col gap-1">
      <div v-if="!hasCredentials" class="text-yellow-500">
        <i class="fas fa-exclamation-triangle mr-2"></i>
        AWS credentials not configured
      </div>
      <div v-else-if="!hasEndpoints" class="text-yellow-500">
        <i class="fas fa-exclamation-triangle mr-2"></i>
        No API Gateway endpoints available
      </div>
      <div v-else class="text-green-500">
        <i class="fas fa-check-circle mr-2"></i>
        Ready to activate
      </div>
    </div>
  </div>
</template>
