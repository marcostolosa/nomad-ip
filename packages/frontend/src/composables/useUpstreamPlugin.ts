import { computed, ref } from "vue";

import { useSDK } from "@/plugins/sdk";

/**
 * Composable for managing Caido upstream plugin registration.
 * Handles creating, deleting, and tracking upstream plugins for request routing.
 * All operations are delegated to the backend.
 */
export function useUpstreamPlugin() {
  const sdk = useSDK();

  const enabled = ref(false);
  const allowlist = ref<readonly string[]>([]);
  const pluginId = ref<string | undefined>(undefined);

  const isEnabled = computed(() => enabled.value);

  /**
   * Loads the current upstream plugin status from the backend.
   */
  const loadStatus = async (): Promise<void> => {
    const status = await sdk.backend.getUpstreamStatus();
    enabled.value = status.enabled;
    allowlist.value = status.allowlist;
    pluginId.value = status.pluginId;
  };

  /**
   * Registers a new upstream plugin with the specified allowlist.
   * Cleans up existing plugins first to ensure only one is active.
   *
   * @param domains - List of domains to include in the allowlist
   */
  const register = async (domains: readonly string[]): Promise<void> => {
    const result = await sdk.backend.registerUpstream(domains);
    if (result.kind === "Error") {
      throw new Error(result.error);
    }
    await loadStatus();
  };

  /**
   * Unregisters the current upstream plugin if one exists.
   */
  const unregister = async (): Promise<void> => {
    const result = await sdk.backend.unregisterUpstream();
    if (result.kind === "Error") {
      throw new Error(result.error);
    }
    await loadStatus();
  };

  return {
    pluginId,
    allowlist,
    enabled,
    isEnabled,
    loadStatus,
    register,
    unregister,
  };
}
