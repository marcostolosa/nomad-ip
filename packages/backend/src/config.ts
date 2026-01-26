import { MAX_DOMAIN_INDEX_ENTRIES } from "./constants";
import type {
  AWSCredentials,
  DomainGatewayMap,
  GatewayConfig,
  GatewayEndpoint,
  PluginState,
} from "./types";

type UpstreamPluginState = {
  pluginId: string | undefined;
  allowlist: readonly string[];
};

type FullPluginState = PluginState & {
  upstreamPlugin: UpstreamPluginState;
};

let state: FullPluginState = {
  credentials: undefined,
  config: undefined,
  endpoints: [],
  domainGatewayMap: new Map(),
  currentIndexPerDomain: new Map(),
  requestCount: 0,
  upstreamPlugin: {
    pluginId: undefined,
    allowlist: [],
  },
};

export function setCredentials(credentials: AWSCredentials): void {
  state = { ...state, credentials };
}

export function getCredentials(): AWSCredentials | undefined {
  return state.credentials;
}

export function setConfig(config: GatewayConfig): void {
  state = { ...state, config };
}

export function getConfig(): GatewayConfig | undefined {
  return state.config;
}

export function setEndpoints(endpoints: GatewayEndpoint[]): void {
  state = { ...state, endpoints };
}

/**
 * Sets the active routing map based on selected domains and regions.
 * Only endpoints matching both criteria will be used for routing.
 *
 * @param domains - List of domains to route through gateways
 * @param regions - List of regions to use for routing
 */
export function setActiveRouting(domains: string[], regions: string[]): void {
  const domainGatewayMap: DomainGatewayMap = new Map();
  const domainSet = new Set(domains);
  const regionSet = new Set(regions);

  for (const endpoint of state.endpoints) {
    if (domainSet.has(endpoint.target) && regionSet.has(endpoint.region)) {
      const existing = domainGatewayMap.get(endpoint.target) ?? [];
      existing.push(endpoint);
      domainGatewayMap.set(endpoint.target, existing);
    }
  }

  state = { ...state, domainGatewayMap };
}

/**
 * Clears the active routing map.
 */
export function clearActiveRouting(): void {
  state = {
    ...state,
    domainGatewayMap: new Map(),
    currentIndexPerDomain: new Map(),
  };
}

export function getEndpoints(): GatewayEndpoint[] {
  return state.endpoints;
}

/**
 * Gets the next endpoint for a domain using round-robin selection.
 * Automatically cleans up stale index entries to prevent memory leaks.
 *
 * @param domain - The target domain to get an endpoint for
 * @returns The next endpoint in the rotation, or undefined if none configured
 */
export function getNextEndpointForDomain(
  domain: string,
): GatewayEndpoint | undefined {
  const gateways = state.domainGatewayMap.get(domain);
  if (gateways === undefined || gateways.length === 0) {
    return undefined;
  }

  const currentIndex = state.currentIndexPerDomain.get(domain) ?? 0;
  const endpoint = gateways[currentIndex];

  const nextIndex = (currentIndex + 1) % gateways.length;
  state.currentIndexPerDomain.set(domain, nextIndex);
  state.requestCount++;

  // Cleanup stale entries to prevent memory leak
  // Only keep entries for domains that have configured gateways
  if (state.currentIndexPerDomain.size > MAX_DOMAIN_INDEX_ENTRIES) {
    cleanupStaleIndexEntries();
  }

  return endpoint;
}

/**
 * Removes index entries for domains that no longer have configured gateways.
 */
function cleanupStaleIndexEntries(): void {
  const domainsToRemove: string[] = [];

  for (const domain of state.currentIndexPerDomain.keys()) {
    if (!state.domainGatewayMap.has(domain)) {
      domainsToRemove.push(domain);
    }
  }

  for (const domain of domainsToRemove) {
    state.currentIndexPerDomain.delete(domain);
  }
}

export function hasEndpoints(): boolean {
  return state.endpoints.length > 0;
}

// Upstream plugin state management
export function getUpstreamPluginId(): string | undefined {
  return state.upstreamPlugin.pluginId;
}

export function setUpstreamPluginId(id: string | undefined): void {
  state = {
    ...state,
    upstreamPlugin: { ...state.upstreamPlugin, pluginId: id },
  };
}

export function getUpstreamAllowlist(): readonly string[] {
  return state.upstreamPlugin.allowlist;
}

export function setUpstreamAllowlist(domains: readonly string[]): void {
  state = {
    ...state,
    upstreamPlugin: { ...state.upstreamPlugin, allowlist: domains },
  };
}

export function isUpstreamEnabled(): boolean {
  return state.upstreamPlugin.pluginId !== undefined;
}
