import { ref, watch } from "vue";

import { useSDK } from "@/plugins/sdk";

/**
 * Stored frontend configuration for Nomad IP.
 * This is persisted in Caido's frontend storage.
 */
type StoredFrontendConfig = {
  selectedScopeId: string | undefined;
  selectedRegions: string[];
  selectedScopeDomains: string[];
};

const STORAGE_VERSION = 1;

type StorageData = {
  version: number;
  config: StoredFrontendConfig;
};

function isStorageData(value: unknown): value is StorageData {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["version"] === "number" &&
    typeof obj["config"] === "object" &&
    obj["config"] !== null
  );
}

function isStoredFrontendConfig(value: unknown): value is StoredFrontendConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    (obj["selectedScopeId"] === undefined ||
      typeof obj["selectedScopeId"] === "string") &&
    Array.isArray(obj["selectedRegions"]) &&
    Array.isArray(obj["selectedScopeDomains"])
  );
}

/**
 * Composable for managing frontend configuration storage.
 * Persists user selections (scope, regions, domains) across sessions.
 */
export function useFrontendStorage() {
  const sdk = useSDK();

  const selectedScopeId = ref<string | undefined>(undefined);
  const selectedRegions = ref<string[]>([]);
  const selectedScopeDomains = ref<string[]>([]);

  const isLoaded = ref(false);

  /**
   * Loads the stored configuration from frontend storage.
   */
  const load = (): void => {
    const stored = sdk.storage.get();

    if (!isStorageData(stored)) {
      isLoaded.value = true;
      return;
    }

    // Handle version migrations if needed in the future
    if (stored.version !== STORAGE_VERSION) {
      isLoaded.value = true;
      return;
    }

    if (!isStoredFrontendConfig(stored.config)) {
      isLoaded.value = true;
      return;
    }

    selectedScopeId.value = stored.config.selectedScopeId;
    selectedRegions.value = stored.config.selectedRegions;
    selectedScopeDomains.value = stored.config.selectedScopeDomains;

    isLoaded.value = true;
  };

  /**
   * Saves the current configuration to frontend storage.
   */
  const save = async (): Promise<void> => {
    const data: StorageData = {
      version: STORAGE_VERSION,
      config: {
        selectedScopeId: selectedScopeId.value,
        selectedRegions: selectedRegions.value,
        selectedScopeDomains: selectedScopeDomains.value,
      },
    };

    await sdk.storage.set(data);
  };

  /**
   * Sets up watchers to auto-save when config changes.
   * Should be called after load() to avoid saving initial values.
   */
  const setupAutoSave = (): void => {
    watch(
      [selectedScopeId, selectedRegions, selectedScopeDomains],
      async () => {
        if (isLoaded.value) {
          await save();
        }
      },
      { deep: true },
    );
  };

  return {
    selectedScopeId,
    selectedRegions,
    selectedScopeDomains,
    isLoaded,
    load,
    save,
    setupAutoSave,
  };
}
