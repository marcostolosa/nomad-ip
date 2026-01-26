<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import Dropdown from "primevue/dropdown";
import Tag from "primevue/tag";
import { computed } from "vue";

import { useSDK } from "@/plugins/sdk";
import { filterValidDomains } from "@/utils/domain";

type Scope = {
  id: string;
  name: string;
};

type DropdownOption = Scope | { id: "__manage_scopes__"; name: string };

const MANAGE_SCOPES_ID = "__manage_scopes__";

const props = defineProps<{
  selectedScopeId: string | undefined;
  selectedScopeDomains: string[];
  selectedRegions: string[];
  availableScopes: Scope[];
  availableRegions: string[];
  disabled: boolean;
  canSave: boolean;
  loading: boolean;
}>();

const emit = defineEmits<{
  "update:selectedScopeId": [id: string | undefined];
  "update:selectedRegions": [regions: string[]];
  "update:selectedScopeDomains": [domains: string[]];
  refreshScopes: [];
  toggle: [];
}>();

const sdk = useSDK();

const dropdownOptions = computed<DropdownOption[]>(() => {
  return [
    ...props.availableScopes,
    { id: MANAGE_SCOPES_ID, name: "Manage Scopes..." },
  ];
});

const loadScopeData = (scopeId: string) => {
  const scopes = sdk.scopes.getScopes();
  const scope = scopes.find((s) => s.id === scopeId);

  if (scope === undefined) {
    emit("update:selectedScopeDomains", []);
    return;
  }

  const { validDomains, skippedWildcards, skippedIPs } = filterValidDomains(
    scope.allowlist,
  );

  emit("update:selectedScopeDomains", validDomains);

  const warnings = [];
  if (skippedWildcards.length > 0) {
    warnings.push("wildcard patterns");
  }
  if (skippedIPs.length > 0) {
    warnings.push("IP addresses (not supported by AWS API Gateway)");
  }

  if (warnings.length > 0) {
    sdk.window.showToast(`Excluded ${warnings.join(" and ")} from scope`, {
      variant: "warning",
    });
  }
};

const handleScopeChange = (value: string | undefined) => {
  if (value === MANAGE_SCOPES_ID) {
    sdk.navigation.goTo("/scope");
    return;
  }

  emit("update:selectedScopeId", value);

  if (value === undefined || value === "") {
    emit("update:selectedScopeDomains", []);
    return;
  }

  loadScopeData(value);
};

const toggleRegion = (region: string) => {
  const regions = [...props.selectedRegions];
  const index = regions.indexOf(region);
  if (index >= 0) {
    regions.splice(index, 1);
  } else {
    regions.push(region);
  }
  emit("update:selectedRegions", regions);
};

const selectAllRegions = () => {
  emit("update:selectedRegions", [...props.availableRegions]);
};

const clearAllRegions = () => {
  emit("update:selectedRegions", []);
};
</script>
<template>
  <div class="flex flex-1 flex-col gap-4">
    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-base font-medium">
          <i class="fas fa-crosshairs text-primary-400"></i>
          <span>Scope & Regions</span>
        </div>
        <Button
          label="Save"
          size="small"
          :loading="loading"
          :disabled="!canSave"
          @click="emit('toggle')"
        />
      </div>
      <span class="text-surface-400 text-sm">
        Select the target scope and choose geographic regions for gateway
        deployment
      </span>
    </div>

    <div class="flex flex-col gap-2">
      <label class="text-sm text-surface-400">Caido Scope</label>
      <Dropdown
        :model-value="selectedScopeId"
        :options="dropdownOptions"
        option-label="name"
        option-value="id"
        placeholder="Select a scope"
        :disabled="disabled"
        class="w-full"
        @update:model-value="handleScopeChange"
        @show="emit('refreshScopes')"
      />
    </div>

    <div v-if="selectedScopeDomains.length > 0" class="flex flex-col gap-2">
      <label class="text-sm text-surface-400">
        Target Domains ({{ selectedScopeDomains.length }})
      </label>
      <div class="flex flex-wrap gap-2">
        <Tag
          v-for="domain in selectedScopeDomains"
          :key="domain"
          :value="domain"
          severity="secondary"
        />
      </div>
    </div>

    <div class="flex items-center justify-between">
      <label class="text-surface-400 text-sm">AWS Regions</label>
      <div class="flex gap-2">
        <Button
          label="Select All"
          size="small"
          severity="secondary"
          text
          :disabled="disabled"
          @click="selectAllRegions"
        />
        <Button
          label="Clear"
          size="small"
          severity="secondary"
          text
          :disabled="disabled"
          @click="clearAllRegions"
        />
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
      <div
        v-for="region in availableRegions"
        :key="region"
        class="flex items-center gap-2"
      >
        <Checkbox
          :model-value="selectedRegions.includes(region)"
          :input-id="region"
          binary
          :disabled="disabled"
          @update:model-value="toggleRegion(region)"
        />
        <label :for="region" class="text-surface-400 text-sm cursor-pointer">
          {{ region }}
        </label>
      </div>
    </div>

    <p class="text-surface-500 text-sm">
      Selected: {{ selectedRegions.length }} regions
    </p>
  </div>
</template>
