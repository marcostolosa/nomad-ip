<script setup lang="ts">
import Button from "primevue/button";
import Column from "primevue/column";
import DataTable from "primevue/datatable";
import Tag from "primevue/tag";

type Endpoint = {
  region: string;
  hostname: string;
  apiId: string;
  target: string;
};

const props = defineProps<{
  endpoints: Endpoint[];
  activeEndpoints: Endpoint[];
  loading: boolean;
  deletingEndpoints: Set<string>;
}>();

const emit = defineEmits<{
  delete: [apiId: string];
  deleteAll: [];
  refresh: [];
}>();

const isActive = (endpoint: Endpoint) => {
  return props.activeEndpoints.some((e) => e.apiId === endpoint.apiId);
};

const getRowClass = (data: Endpoint) => {
  return isActive(data) ? "bg-green-900/10" : "";
};
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-base font-medium">
          <i class="fas fa-network-wired text-primary-400"></i>
          <span>Endpoints</span>
          <span class="text-surface-400 text-sm font-normal">
            ({{ endpoints.length }} total, {{ activeEndpoints.length }} active)
          </span>
        </div>
        <div class="flex gap-2">
          <Button
            icon="fas fa-sync"
            label="Refresh"
            severity="contrast"
            size="small"
            :loading="loading"
            :disabled="deletingEndpoints.size > 0"
            @click="emit('refresh')"
          />
          <Button
            v-if="endpoints.length > 0"
            label="Delete All"
            severity="danger"
            size="small"
            :loading="loading"
            :disabled="deletingEndpoints.size > 0"
            @click="emit('deleteAll')"
          />
        </div>
      </div>
      <span class="text-surface-400 text-sm">
        Manage active gateways and retrieve their public invocation URLs
      </span>
    </div>

    <DataTable
      v-if="endpoints.length > 0"
      :value="endpoints"
      striped-rows
      scrollable
      scroll-height="flex"
      class="select-text flex-1"
      :row-class="getRowClass"
    >
      <Column field="target" header="Domain">
        <template #body="slotProps">
          <div class="flex items-center gap-2">
            <span>{{ slotProps.data.target }}</span>
            <Tag
              v-if="isActive(slotProps.data)"
              value="active"
              severity="success"
              class="text-xs"
            />
          </div>
        </template>
      </Column>
      <Column field="region" header="Region" />
      <Column field="hostname" header="Gateway URL">
        <template #body="slotProps">
          <code class="text-xs text-surface-400">
            {{ slotProps.data.hostname }}
          </code>
        </template>
      </Column>
      <Column header="" style="width: 60px">
        <template #body="slotProps">
          <Button
            icon="fas fa-trash"
            severity="danger"
            size="small"
            text
            :loading="deletingEndpoints.has(slotProps.data.apiId)"
            :disabled="deletingEndpoints.size > 0"
            @click="emit('delete', slotProps.data.apiId)"
          />
        </template>
      </Column>
    </DataTable>

    <div v-else class="text-center py-8 text-surface-500">
      <i class="fas fa-network-wired text-4xl mb-3 opacity-30"></i>
      <p>No endpoints configured</p>
      <p class="text-sm mt-1">Configure regions and save to create gateways</p>
    </div>
  </div>
</template>
