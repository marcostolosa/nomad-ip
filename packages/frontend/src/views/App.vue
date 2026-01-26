<script setup lang="ts">
import Card from "primevue/card";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import ConfigurationCard from "@/components/ConfigurationCard.vue";
import CredentialsCard from "@/components/CredentialsCard.vue";
import EndpointsCard from "@/components/EndpointsCard.vue";
import StatusCard from "@/components/StatusCard.vue";
import { useFrontendStorage } from "@/composables/useFrontendStorage";
import { useUpstreamPlugin } from "@/composables/useUpstreamPlugin";
import { useSDK } from "@/plugins/sdk";
import { useConfigStore } from "@/stores/config";
import { filterValidDomains, missingDomainRegion } from "@/utils/domain";

const sdk = useSDK();
const configStore = useConfigStore();
const upstreamPlugin = useUpstreamPlugin();
const frontendStorage = useFrontendStorage();

const hasCredentials = ref(false);
const maskedAccessKeyId = ref<string | undefined>(undefined);

// Use storage-backed refs for user selections
const { selectedRegions, selectedScopeId, selectedScopeDomains } =
  frontendStorage;
const availableRegions = ref<string[]>([]);
const availableScopes = ref<Array<{ id: string; name: string }>>([]);

watch(
  availableRegions,
  (newVal) => {
    sdk.log.info("[Nomad IP] availableRegions changed:", newVal.length, newVal);
  },
  { immediate: true },
);

const endpoints = computed(() => configStore.endpoints);

const activeEndpoints = computed(() => {
  if (upstreamPlugin.allowlist.value.length === 0) {
    return [];
  }
  return endpoints.value.filter(
    (endpoint) =>
      upstreamPlugin.allowlist.value.includes(endpoint.target) &&
      selectedRegions.value.includes(endpoint.region),
  );
});

const loading = ref(false);
const deletingEndpoints = ref(new Set<string>());
const statusMessage = ref("");

let isMounted = true;

const canSave = computed(() => {
  if (
    !hasCredentials.value ||
    selectedRegions.value.length === 0 ||
    selectedScopeId.value === undefined ||
    selectedScopeDomains.value.length === 0
  ) {
    return false;
  }

  const requiredCombinations = new Set<string>();
  for (const domain of selectedScopeDomains.value) {
    for (const region of selectedRegions.value) {
      requiredCombinations.add(`${domain}:${region}`);
    }
  }

  const existingCombinations = new Set<string>();
  for (const endpoint of endpoints.value) {
    existingCombinations.add(`${endpoint.target}:${endpoint.region}`);
  }

  for (const required of requiredCombinations) {
    if (!existingCombinations.has(required)) {
      return true;
    }
  }

  return false;
});

const handleActivate = async () => {
  loading.value = true;
  statusMessage.value = "Activating upstream proxies...";

  try {
    if (selectedScopeDomains.value.length === 0) {
      sdk.window.showToast("No domains selected for upstream proxy", {
        variant: "error",
      });
      return;
    }

    if (endpoints.value.length === 0) {
      sdk.window.showToast("No API Gateway endpoints available to activate", {
        variant: "error",
      });
      return;
    }

    // Ensure config is saved before activating
    if (selectedScopeId.value !== undefined) {
      const configResult = await sdk.backend.saveScopeConfig(
        selectedScopeId.value,
        selectedRegions.value,
      );
      if (configResult.kind === "Error") {
        sdk.window.showToast(configResult.error, { variant: "error" });
        return;
      }
    }

    await upstreamPlugin.register(selectedScopeDomains.value);

    sdk.window.showToast(
      "Upstream proxies activated - traffic will now route through Nomad IP gateways",
      {
        variant: "success",
      },
    );

    if (isMounted) {
      await loadStatus();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.window.showToast(`Failed to activate: ${message}`, {
      variant: "error",
    });
    if (isMounted) {
      await loadStatus();
    }
  } finally {
    if (isMounted) {
      loading.value = false;
      statusMessage.value = "";
    }
  }
};

const handleDeactivate = async () => {
  loading.value = true;
  statusMessage.value = "Deactivating upstream proxies...";

  try {
    await upstreamPlugin.unregister();

    sdk.window.showToast(
      "Upstream proxies deactivated - traffic will no longer route through Nomad IP gateways",
      {
        variant: "success",
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.window.showToast(`Failed to deactivate: ${message}`, {
      variant: "error",
    });
  } finally {
    if (isMounted) {
      loading.value = false;
      statusMessage.value = "";
    }
  }
};

const loadScopeDomainsFromId = (scopeId: string) => {
  const scopes = sdk.scopes.getScopes();
  const scope = scopes.find((s) => s.id === scopeId);
  if (scope === undefined) {
    return;
  }

  const { validDomains } = filterValidDomains(scope.allowlist);
  selectedScopeDomains.value = validDomains;
};

const loadStatus = async () => {
  const status = await sdk.backend.getStatus();

  // Only use backend values if frontend storage doesn't have values
  // This allows frontend storage to take precedence
  if (selectedRegions.value.length === 0 && status.regions.length > 0) {
    selectedRegions.value = status.regions;
  }

  if (selectedScopeId.value === undefined && status.scopeId !== undefined) {
    selectedScopeId.value = status.scopeId;
  }

  if (selectedScopeDomains.value.length === 0) {
    if (status.domains.length > 0) {
      selectedScopeDomains.value = status.domains;
    } else if (selectedScopeId.value !== undefined) {
      // Load domains from scope if not saved in status
      loadScopeDomainsFromId(selectedScopeId.value);
    }
  }

  if (status.endpoints.length > 0) {
    configStore.endpoints.splice(
      0,
      configStore.endpoints.length,
      ...status.endpoints,
    );
  }
};

const loadCredentials = async () => {
  const creds = await sdk.backend.loadCredentials();
  hasCredentials.value = creds.hasCredentials;
  if (creds.accessKeyId !== undefined) {
    maskedAccessKeyId.value = creds.accessKeyId;
  }
};

const loadRegions = async () => {
  try {
    sdk.log.info("[Nomad IP] Loading available regions...");
    const regions = await sdk.backend.getAvailableRegions();
    sdk.log.info(`[Nomad IP] Loaded ${regions.length} regions:`, regions);
    sdk.log.info(
      "[Nomad IP] Type of regions:",
      typeof regions,
      Array.isArray(regions),
    );
    availableRegions.value = regions;
    sdk.log.info(
      "[Nomad IP] After assignment, availableRegions.value:",
      availableRegions.value,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load regions";
    sdk.log.error("[Nomad IP] Failed to load regions:", error);
    sdk.window.showToast(message, { variant: "error" });
  }
};

const loadScopes = () => {
  const scopes = sdk.scopes.getScopes();
  availableScopes.value = scopes.map((s) => ({
    id: s.id,
    name: s.name,
  }));
};

onMounted(async () => {
  isMounted = true;

  // Load stored frontend config first (synchronous)
  frontendStorage.load();

  // Then load other data from backend
  // eslint-disable-next-line compat/compat
  await Promise.all([
    loadStatus(),
    loadCredentials(),
    loadRegions(),
    loadScopes(),
    upstreamPlugin.loadStatus(),
  ]);

  // Set up auto-save after initial load to avoid saving during initialization
  frontendStorage.setupAutoSave();
});

onUnmounted(() => {
  isMounted = false;
});

const handleSaveCredentials = async (
  accessKeyId: string,
  secretAccessKey: string,
) => {
  loading.value = true;
  statusMessage.value = "Saving credentials and fetching gateways from AWS...";

  try {
    const result = await configStore.saveCredentials(
      accessKeyId,
      secretAccessKey,
    );

    if (result.kind === "Error") {
      sdk.window.showToast(result.error, { variant: "error" });
    }

    sdk.window.showToast("Credentials saved", { variant: "success" });
    await loadCredentials();
  } finally {
    loading.value = false;
    statusMessage.value = "";
  }
};

const handleRefreshFromAWS = async () => {
  loading.value = true;
  statusMessage.value = "Fetching gateways from AWS...";

  try {
    const result = await configStore.reconcile();
    if (result.kind === "Error") {
      sdk.window.showToast(result.error, { variant: "error" });
    } else {
      sdk.window.showToast(`Found ${result.value.length} gateways`, {
        variant: "success",
      });
    }
  } finally {
    loading.value = false;
    statusMessage.value = "";
  }
};

const saveScopeConfig = async () => {
  if (selectedScopeId.value === undefined) {
    return;
  }

  const result = await sdk.backend.saveScopeConfig(
    selectedScopeId.value,
    selectedRegions.value,
  );

  if (result.kind === "Error") {
    sdk.window.showToast(result.error, { variant: "error" });
    return;
  }

  sdk.window.showToast("Configuration saved", { variant: "success" });
};

const handleToggleEnabled = async () => {
  try {
    if (upstreamPlugin.enabled.value) {
      loading.value = true;
      statusMessage.value = "Disabling...";
      const result = await sdk.backend.disable();
      if (result.kind === "Error") {
        sdk.window.showToast(result.error, { variant: "error" });
      }
    } else {
      await saveScopeConfig();
      const { missingDomains, missingRegions } = missingDomainRegion(
        selectedRegions.value,
        selectedScopeDomains.value,
        endpoints.value,
      );
      if (missingDomains.length === 0 && missingRegions.length === 0) {
        sdk.window.showToast("All required gateways already exist", {
          variant: "info",
        });
        return;
      }

      loading.value = true;
      statusMessage.value = "Creating gateways...";

      const result = await configStore.registerMissing(
        Array.from(missingDomains),
        Array.from(missingRegions),
      );

      if (result.kind === "Error") {
        sdk.window.showToast(result.error, { variant: "error" });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.window.showToast(message, { variant: "error" });
  }

  await loadStatus();
  loading.value = false;
  statusMessage.value = "";
};

const handleDeleteEndpoint = async (apiId: string) => {
  deletingEndpoints.value.add(apiId);
  statusMessage.value = "Deleting endpoint...";

  try {
    const result = await sdk.backend.deleteEndpoint(apiId);
    if (result.kind === "Error") {
      sdk.window.showToast(result.error, { variant: "error" });
    } else {
      configStore.removeEndpoint(apiId);
      sdk.window.showToast("Endpoint deleted", { variant: "success" });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.window.showToast(message, { variant: "error" });
  }

  deletingEndpoints.value.delete(apiId);
  statusMessage.value = "";
};

const handleDeleteAllEndpoints = async () => {
  loading.value = true;
  statusMessage.value = "Deleting all endpoints...";

  try {
    const result = await sdk.backend.deleteAllEndpoints();
    if (result.kind === "Error") {
      sdk.window.showToast(result.error, { variant: "error" });
    } else {
      const { remainingEndpoints, deletedCount, errors } = result.value;

      configStore.endpoints.splice(
        0,
        configStore.endpoints.length,
        ...remainingEndpoints,
      );

      if (remainingEndpoints.length === 0) {
        await upstreamPlugin.unregister();
      }

      if (errors.length > 0) {
        sdk.window.showToast(
          `Deleted ${deletedCount} endpoints, ${errors.length} failed`,
          { variant: "warning" },
        );
      } else {
        sdk.window.showToast(`Deleted ${deletedCount} endpoints`, {
          variant: "success",
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.window.showToast(message, { variant: "error" });
  }

  loading.value = false;
  statusMessage.value = "";
};
</script>

<template>
  <div class="h-full px-1 overflow-auto">
    <div class="flex flex-col gap-2 w-full h-full mx-auto">
      <!-- Status Card -->
      <Card>
        <template #content>
          <StatusCard
            :enabled="upstreamPlugin.enabled.value"
            :loading="loading"
            :endpoint-count="activeEndpoints.length"
            :can-enable="hasCredentials && endpoints.length > 0"
            :status-message="statusMessage"
            :has-credentials="hasCredentials"
            :has-endpoints="endpoints.length > 0"
            @activate="handleActivate"
            @deactivate="handleDeactivate"
          />
        </template>
      </Card>

      <!-- Two-column layout -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 flex-1">
        <!-- Left Column: Credentials + Configuration -->
        <div class="flex flex-1 flex-col gap-2">
          <!-- Credentials Card -->
          <Card class="flex flex-1">
            <template #content>
              <CredentialsCard
                :has-credentials="hasCredentials"
                :masked-access-key-id="maskedAccessKeyId"
                :disabled="upstreamPlugin.enabled.value"
                @save="handleSaveCredentials"
              />
            </template>
          </Card>

          <!-- Configuration Card -->
          <Card class="flex flex-1">
            <template #content>
              <ConfigurationCard
                v-model:selected-scope-id="selectedScopeId"
                v-model:selected-regions="selectedRegions"
                v-model:selected-scope-domains="selectedScopeDomains"
                :available-scopes="availableScopes"
                :available-regions="availableRegions"
                :disabled="upstreamPlugin.enabled.value"
                :can-save="canSave"
                :loading="loading"
                @refresh-scopes="loadScopes"
                @toggle="handleToggleEnabled"
              />
            </template>
          </Card>
        </div>

        <!-- Right Column: Endpoints -->
        <Card>
          <template #content>
            <EndpointsCard
              :endpoints="endpoints"
              :active-endpoints="activeEndpoints"
              :loading="loading"
              :deleting-endpoints="deletingEndpoints"
              @delete="handleDeleteEndpoint"
              @delete-all="handleDeleteAllEndpoints"
              @refresh="handleRefreshFromAWS"
            />
          </template>
        </Card>
      </div>
    </div>
  </div>
</template>
