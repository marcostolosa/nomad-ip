import type {
  AWSCredentials,
  GatewayConfig,
  GatewayEndpoint,
  Result,
} from "backend";
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { useSDK } from "@/plugins/sdk";

type ReconcileCache = {
  endpoints: GatewayEndpoint[];
  timestamp: number;
};

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION_MS = 5 * 60 * 1000;

/**
 * Creates an error Result from an unknown error value.
 */
function createErrorResult(
  error: unknown,
  defaultMessage: string,
): Result<never> {
  return {
    kind: "Error",
    error: error instanceof Error ? error.message : defaultMessage,
  };
}

export const useConfigStore = defineStore("config", () => {
  const sdk = useSDK();

  // State
  const credentials = ref<AWSCredentials | undefined>(undefined);
  const config = ref<GatewayConfig>({
    regions: [],
    scopeId: "",
    scopeName: "",
    domains: [],
  });
  const enabled = ref(false);
  const endpoints = ref<GatewayEndpoint[]>([]);
  const loading = ref(false);

  // Cache for reconciliation data
  const reconcileCache = ref<ReconcileCache | undefined>(undefined);

  // Computed properties
  const hasCredentials = computed(() => credentials.value !== undefined);
  const maskedAccessKeyId = computed(() => {
    if (credentials.value === undefined) return "";
    return (
      credentials.value.accessKeyId.slice(0, 4) +
      "****" +
      credentials.value.accessKeyId.slice(-4)
    );
  });

  const isCacheValid = computed(() => {
    if (reconcileCache.value === undefined) return false;
    const now = Date.now();
    return now - reconcileCache.value.timestamp < CACHE_DURATION_MS;
  });

  // Actions

  /**
   * Loads credential status from the backend.
   * Does not store actual credentials, only tracks existence.
   */
  const loadCredentials = async (): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.loadCredentials();
      if (result.hasCredentials) {
        credentials.value = {
          accessKeyId: result.accessKeyId ?? "",
          secretAccessKey: "", // Never store the actual secret
        };
      } else {
        credentials.value = undefined;
      }
      return { kind: "Ok", value: undefined };
    } catch (error) {
      return createErrorResult(error, "Failed to load credentials");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Saves AWS credentials and reconciles gateways.
   * Updates local state and cache with reconciliation results.
   */
  const saveCredentials = async (
    accessKeyId: string,
    secretAccessKey: string,
  ): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.saveCredentials(
        accessKeyId,
        secretAccessKey,
      );
      if (result.kind === "Ok") {
        credentials.value = {
          accessKeyId,
          secretAccessKey: "", // Don't store the actual secret
        };
        endpoints.value = result.value.endpoints;
        reconcileCache.value = {
          endpoints: result.value.endpoints,
          timestamp: Date.now(),
        };
        return { kind: "Ok", value: undefined };
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to save credentials");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Fetches fresh data from AWS via reconciliation.
   * Updates the cache with the new data.
   */
  const reconcile = async (): Promise<Result<GatewayEndpoint[]>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.reconcile();
      if (result.kind === "Ok") {
        endpoints.value = result.value.endpoints;
        reconcileCache.value = {
          endpoints: result.value.endpoints,
          timestamp: Date.now(),
        };
        return { kind: "Ok", value: result.value.endpoints };
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to reconcile with AWS");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Loads config and endpoints.
   * Uses cached endpoints if available and valid, otherwise fetches fresh data.
   * @param forceRefresh - If true, bypasses cache and fetches from AWS
   */
  const loadConfig = async (forceRefresh = false): Promise<Result<void>> => {
    loading.value = true;
    try {
      const status = await sdk.backend.getStatus();

      if (status.regions.length > 0) {
        config.value.regions = status.regions;
      }

      // Use cache if valid and not forcing refresh
      if (
        !forceRefresh &&
        isCacheValid.value &&
        reconcileCache.value !== undefined
      ) {
        endpoints.value = reconcileCache.value.endpoints;
      } else if (status.endpoints.length > 0) {
        endpoints.value = status.endpoints;
        reconcileCache.value = {
          endpoints: status.endpoints,
          timestamp: Date.now(),
        };
      } else if (credentials.value !== undefined) {
        await reconcile();
      }
      return { kind: "Ok", value: undefined };
    } catch (error) {
      return createErrorResult(error, "Failed to load configuration");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Fetches available AWS regions from the backend.
   */
  const getAvailableRegions = async (): Promise<Result<string[]>> => {
    try {
      const regions = await sdk.backend.getAvailableRegions();
      return { kind: "Ok", value: regions };
    } catch (error) {
      return createErrorResult(error, "Failed to load available regions");
    }
  };

  /**
   * Saves scope configuration (scope ID and regions).
   * Reloads config to get updated domains after saving.
   */
  const saveScopeConfig = async (
    scopeId: string,
    regions: string[],
  ): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.saveScopeConfig(scopeId, regions);
      if (result.kind === "Ok") {
        await loadConfig();
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to save configuration");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Registers all gateways for the current configuration.
   * Creates gateways for all domain/region combinations.
   */
  const register = async (): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.register();
      if (result.kind === "Ok") {
        enabled.value = true;
        endpoints.value = result.value.endpoints;
        reconcileCache.value = {
          endpoints: result.value.endpoints,
          timestamp: Date.now(),
        };
        return { kind: "Ok", value: undefined };
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to register Nomad IP");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Registers only missing gateways for the given domains and regions.
   * Skips existing domain/region combinations.
   */
  const registerMissing = async (
    domains: string[],
    regions: string[],
  ): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.registerMissing(domains, regions);
      if (result.kind === "Ok") {
        endpoints.value = result.value.endpoints;
        reconcileCache.value = {
          endpoints: result.value.endpoints,
          timestamp: Date.now(),
        };
        return { kind: "Ok", value: undefined };
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to register missing gateways");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Disables Nomad IP (clears registered configuration but preserves endpoints).
   */
  const disable = async (): Promise<Result<void>> => {
    loading.value = true;
    try {
      const result = await sdk.backend.disable();
      if (result.kind === "Ok") {
        enabled.value = false;
      }
      return result;
    } catch (error) {
      return createErrorResult(error, "Failed to disable Nomad IP");
    } finally {
      loading.value = false;
    }
  };

  /**
   * Clears the reconciliation cache, forcing the next load to fetch fresh data.
   */
  const clearCache = () => {
    reconcileCache.value = undefined;
  };

  /**
   * Updates endpoints after a deletion without full reconciliation.
   */
  const removeEndpoint = (apiId: string) => {
    endpoints.value = endpoints.value.filter((e) => e.apiId !== apiId);
    if (reconcileCache.value !== undefined) {
      reconcileCache.value = {
        endpoints: endpoints.value,
        timestamp: reconcileCache.value.timestamp,
      };
    }
  };

  /**
   * Clears all endpoints (after delete all).
   */
  const clearEndpoints = () => {
    endpoints.value = [];
    reconcileCache.value = {
      endpoints: [],
      timestamp: Date.now(),
    };
  };

  return {
    // State
    credentials,
    config,
    enabled,
    endpoints,
    loading,

    // Computed
    hasCredentials,
    maskedAccessKeyId,
    isCacheValid,

    // Actions
    loadCredentials,
    saveCredentials,
    loadConfig,
    getAvailableRegions,
    saveScopeConfig,
    register,
    registerMissing,
    disable,
    reconcile,
    clearCache,
    removeEndpoint,
    clearEndpoints,

    // Expose SDK for toast messages in components
    sdk,
  };
});
