import { Blob, fetch } from "caido:http";
import type { DefineAPI, SDK } from "caido:plugin";

import {
  createGatewaysForScope,
  deleteAllGateways,
  deleteGateway,
  listAllGateways,
  type Logger,
} from "./aws/gateway";
import {
  clearActiveRouting,
  getConfig,
  getCredentials,
  getEndpoints,
  getNextEndpointForDomain,
  getUpstreamAllowlist,
  getUpstreamPluginId,
  hasEndpoints,
  isUpstreamEnabled,
  setActiveRouting,
  setConfig,
  setCredentials,
  setEndpoints,
  setUpstreamAllowlist,
  setUpstreamPluginId,
} from "./config";
import { LOG_PREFIX } from "./constants";
import { filterValidDomains } from "./domain";
import {
  clearRegisteredConfig,
  initStorage,
  loadRegisteredConfig,
  loadStoredConfig,
  loadStoredCredentials,
  type RegisteredConfig,
  saveRegisteredConfig,
  saveStoredConfig,
  saveStoredCredentials,
} from "./storage";
import type { AWSRegion, GatewayEndpoint, Result } from "./types";
import { AWS_REGIONS } from "./types";
import { handleRequest } from "./upstream";

// Manifest ID must match the plugin package ID
const PLUGIN_MANIFEST_ID = "nomad-ip";

// GraphQL queries/mutations for upstream plugin management
const UPSTREAMS_QUERY = `
  query {
    upstreamPlugins {
      id
      plugin { manifestId }
    }
  }
`;

const CREATE_UPSTREAM_PLUGIN_MUTATION = `
  mutation CreateUpstreamPlugin($input: CreateUpstreamPluginInput!) {
    createUpstreamPlugin(input: $input) {
      upstream { id }
    }
  }
`;

const DELETE_UPSTREAM_PLUGIN_MUTATION = `
  mutation DeleteUpstreamPlugin($id: ID!) {
    deleteUpstreamPlugin(id: $id) {
      deletedId
    }
  }
`;

// GraphQL response types
type UpstreamPlugin = {
  id: string;
  plugin: { manifestId: string };
};

type UpstreamsResponse = {
  upstreamPlugins: UpstreamPlugin[];
};

type CreateUpstreamPluginResponse = {
  createUpstreamPlugin: {
    upstream: { id: string } | undefined;
  };
};

type UpstreamStatusResponse = {
  enabled: boolean;
  allowlist: readonly string[];
  pluginId: string | undefined;
};

type StatusResponse = {
  endpoints: GatewayEndpoint[];
  regions: string[];
  scopeId: string | undefined;
  scopeName: string | undefined;
  domains: string[];
  registeredConfig: RegisteredConfig | undefined;
};

type CredentialsResponse = {
  hasCredentials: boolean;
  accessKeyId: string | undefined;
};

type ReconcileResponse = {
  endpoints: GatewayEndpoint[];
};

async function reconcileGateways(
  sdk: SDK,
  logger: Logger,
): Promise<Result<ReconcileResponse>> {
  const credentials = getCredentials();
  if (credentials === undefined) {
    return { kind: "Error", error: "No credentials configured" };
  }

  logger.log(`${LOG_PREFIX} Starting gateway reconciliation...`);

  const result = await listAllGateways(credentials, [...AWS_REGIONS], logger);

  if (result.kind === "Error") {
    logger.log(`${LOG_PREFIX} Reconciliation failed: ${result.error}`);
    return result;
  }

  const endpoints = result.value;
  logger.log(`${LOG_PREFIX} Found ${endpoints.length} existing gateways`);

  if (endpoints.length > 0) {
    setEndpoints(endpoints);

    for (const endpoint of endpoints) {
      const targetSuffix =
        endpoint.target !== "" ? ` -> ${endpoint.target}` : "";
      logger.log(
        `${LOG_PREFIX} Active gateway: ${endpoint.region} - ${endpoint.hostname}${targetSuffix}`,
      );
    }
  } else {
    setEndpoints([]);
    logger.log(`${LOG_PREFIX} No active gateways found`);
  }

  return {
    kind: "Ok",
    value: {
      endpoints,
    },
  };
}

async function saveCredentials(
  sdk: SDK,
  accessKeyId: string,
  secretAccessKey: string,
): Promise<Result<ReconcileResponse>> {
  if (accessKeyId.length === 0 || secretAccessKey.length === 0) {
    return {
      kind: "Error",
      error: "Access Key ID and Secret Access Key are required",
    };
  }

  const credentials = { accessKeyId, secretAccessKey };
  setCredentials(credentials);
  await saveStoredCredentials(credentials);
  sdk.console.log(`${LOG_PREFIX} AWS credentials saved`);

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };
  const reconcileResult = await reconcileGateways(sdk, logger);

  if (reconcileResult.kind === "Error") {
    sdk.console.log(
      `${LOG_PREFIX} Reconciliation after credential save failed: ${reconcileResult.error}`,
    );
    return { kind: "Ok", value: { endpoints: [] } };
  }

  return reconcileResult;
}

function loadCredentials(): CredentialsResponse {
  const credentials = getCredentials();

  if (credentials === undefined) {
    return { hasCredentials: false, accessKeyId: undefined };
  }

  const masked = `${credentials.accessKeyId.slice(0, 4)}****${credentials.accessKeyId.slice(-4)}`;

  return { hasCredentials: true, accessKeyId: masked };
}

async function saveScopeConfig(
  sdk: SDK,
  scopeId: string,
  regions: string[],
): Promise<Result<void>> {
  const validRegions = regions.filter((r): r is AWSRegion =>
    AWS_REGIONS.includes(r as AWSRegion),
  );

  if (validRegions.length === 0) {
    return {
      kind: "Error",
      error: "At least one valid AWS region is required",
    };
  }

  const scopes = await sdk.scope.getAll();
  const scope = scopes.find((s) => s.id === scopeId);

  if (scope === undefined) {
    return { kind: "Error", error: "Scope not found" };
  }

  const { validDomains, skippedWildcards, skippedIPs } = filterValidDomains(
    scope.allowlist,
  );

  if (validDomains.length === 0) {
    const reasons = [];
    if (skippedWildcards.length > 0) {
      reasons.push("wildcards not supported");
    }
    if (skippedIPs.length > 0) {
      reasons.push("IP addresses not supported by AWS API Gateway");
    }

    return {
      kind: "Error",
      error: `Scope has no valid domains in allowlist (${reasons.join(", ")})`,
    };
  }

  // Log warnings for skipped entries
  if (skippedWildcards.length > 0) {
    sdk.console.log(
      `${LOG_PREFIX} Skipped ${skippedWildcards.length} wildcard pattern(s): ${skippedWildcards.join(", ")}`,
    );
  }
  if (skippedIPs.length > 0) {
    sdk.console.log(
      `${LOG_PREFIX} Skipped ${skippedIPs.length} IP address(es): ${skippedIPs.join(", ")} (AWS API Gateway does not support IP addresses)`,
    );
  }

  const config = {
    regions: validRegions,
    scopeId: scope.id,
    scopeName: scope.name,
    domains: validDomains,
  };

  setConfig(config);
  await saveStoredConfig(config);
  sdk.console.log(
    `${LOG_PREFIX} Scope configuration saved: ${validRegions.length} regions, ${validDomains.length} domains from scope "${scope.name}"`,
  );

  return { kind: "Ok", value: undefined };
}

/**
 * Registers only the missing gateway combinations for specified domains and regions.
 * Validates regions against AWS_REGIONS before creating gateways.
 *
 * @param sdk - Caido SDK instance
 * @param domains - List of domains to create gateways for
 * @param regions - List of AWS regions to create gateways in
 * @returns Result containing updated status with all endpoints
 */
async function registerMissingGateways(
  sdk: SDK,
  domains: string[],
  regions: string[],
): Promise<Result<StatusResponse>> {
  const credentials = getCredentials();
  if (credentials === undefined) {
    return { kind: "Error", error: "AWS credentials not configured" };
  }

  const config = getConfig();
  if (config === undefined) {
    return { kind: "Error", error: "Configuration not set" };
  }

  // Validate regions
  const validRegions = regions.filter((r): r is AWSRegion =>
    AWS_REGIONS.includes(r as AWSRegion),
  );

  if (validRegions.length === 0) {
    return { kind: "Error", error: "No valid AWS regions provided" };
  }

  if (validRegions.length !== regions.length) {
    sdk.console.log(
      `${LOG_PREFIX} Warning: ${regions.length - validRegions.length} invalid region(s) were skipped`,
    );
  }

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };

  sdk.console.log(
    `${LOG_PREFIX} Creating missing API Gateways for ${domains.length} domains in ${validRegions.length} regions...`,
  );

  // Get current endpoints
  const existingEndpoints = getEndpoints();

  // Create only missing gateways
  const result = await createGatewaysForScope(
    credentials,
    validRegions,
    domains,
    existingEndpoints,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  const newEndpoints = result.value;

  // Merge with existing endpoints (preserve others)
  const allEndpoints = [
    ...newEndpoints,
    ...existingEndpoints.filter(
      (e) =>
        !domains.includes(e.target) ||
        !validRegions.includes(e.region as AWSRegion),
    ),
  ];

  setEndpoints(allEndpoints);

  // Save the updated configuration (preserve existing config)
  const registeredConfig: RegisteredConfig = {
    regions: config.regions,
    domains: config.domains,
  };
  await saveRegisteredConfig(registeredConfig);

  // Activate routing for the selected domains and regions
  setActiveRouting(config.domains, config.regions);

  sdk.console.log(
    `${LOG_PREFIX} Created ${newEndpoints.length} missing gateways, total ${allEndpoints.length} gateways ready`,
  );
  sdk.console.log(
    `${LOG_PREFIX} Active routing set for ${config.domains.length} domains in ${config.regions.length} regions`,
  );

  return {
    kind: "Ok",
    value: {
      endpoints: allEndpoints,
      regions: config.regions,
      scopeId: config.scopeId,
      scopeName: config.scopeName,
      domains: config.domains,
      registeredConfig,
    },
  };
}

async function register(sdk: SDK): Promise<Result<StatusResponse>> {
  const credentials = getCredentials();
  if (credentials === undefined) {
    return { kind: "Error", error: "AWS credentials not configured" };
  }

  const config = getConfig();
  if (config === undefined) {
    return { kind: "Error", error: "Configuration not set" };
  }

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };

  sdk.console.log(
    `${LOG_PREFIX} Creating API Gateways for ${config.domains.length} domains in ${config.regions.length} regions...`,
  );
  sdk.console.log(
    `${LOG_PREFIX} Total gateways to create/verify: ${config.domains.length * config.regions.length}`,
  );

  // Use existing in-memory endpoints (populated from AWS via reconciliation)
  const existingEndpoints = getEndpoints();

  const result = await createGatewaysForScope(
    credentials,
    config.regions as AWSRegion[],
    config.domains,
    existingEndpoints,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  const newEndpoints = result.value;

  // Preserve existing endpoints for domains not in the current configuration
  const existingNonConfigEndpoints = existingEndpoints.filter(
    (e) => !config.domains.includes(e.target),
  );

  // Merge new endpoints with preserved endpoints for other domains
  const allEndpoints = [...newEndpoints, ...existingNonConfigEndpoints];
  setEndpoints(allEndpoints);

  // Save the registered configuration
  const registeredConfig: RegisteredConfig = {
    regions: config.regions,
    domains: config.domains,
  };
  await saveRegisteredConfig(registeredConfig);

  sdk.console.log(`${LOG_PREFIX} All ${allEndpoints.length} gateways ready`);

  return {
    kind: "Ok",
    value: {
      endpoints: allEndpoints,
      regions: config.regions,
      scopeId: config.scopeId,
      scopeName: config.scopeName,
      domains: config.domains,
      registeredConfig,
    },
  };
}

async function disable(sdk: SDK): Promise<Result<void>> {
  if (!hasEndpoints()) {
    return { kind: "Error", error: "No endpoints to disable" };
  }

  // Clear the registered configuration and active routing
  await clearRegisteredConfig();
  clearActiveRouting();

  sdk.console.log(`${LOG_PREFIX} Disabled (endpoints preserved)`);

  return { kind: "Ok", value: undefined };
}

async function deleteEndpoint(
  sdk: SDK,
  apiId: string,
): Promise<Result<StatusResponse>> {
  const credentials = getCredentials();
  if (credentials === undefined) {
    return { kind: "Error", error: "AWS credentials not configured" };
  }

  const endpoints = getEndpoints();
  const endpoint = endpoints.find((e) => e.apiId === apiId);

  if (endpoint === undefined) {
    return { kind: "Error", error: "Endpoint not found" };
  }

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };

  sdk.console.log(
    `${LOG_PREFIX} Deleting API Gateway ${apiId} in ${endpoint.region}...`,
  );

  const result = await deleteGateway(
    credentials,
    endpoint.region as AWSRegion,
    apiId,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  const remainingEndpoints = endpoints.filter((e) => e.apiId !== apiId);
  setEndpoints(remainingEndpoints);

  sdk.console.log(`${LOG_PREFIX} Deleted endpoint ${apiId}`);

  const config = getConfig();
  const registeredConfig = await loadRegisteredConfig();
  return {
    kind: "Ok",
    value: {
      endpoints: remainingEndpoints,
      regions: config?.regions ?? [],
      scopeId: config?.scopeId,
      scopeName: config?.scopeName,
      domains: config?.domains ?? [],
      registeredConfig,
    },
  };
}

type DeleteAllEndpointsResponse = {
  remainingEndpoints: GatewayEndpoint[];
  deletedCount: number;
  errors: string[];
};

async function deleteAllEndpoints(
  sdk: SDK,
): Promise<Result<DeleteAllEndpointsResponse>> {
  const credentials = getCredentials();
  if (credentials === undefined) {
    return { kind: "Error", error: "AWS credentials not configured" };
  }

  const endpoints = getEndpoints();

  if (endpoints.length === 0) {
    return {
      kind: "Ok",
      value: { remainingEndpoints: [], deletedCount: 0, errors: [] },
    };
  }

  sdk.console.log(`${LOG_PREFIX} Deleting ${endpoints.length} API Gateways...`);

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };

  const result = await deleteAllGateways(credentials, endpoints, logger);

  if (result.kind === "Error") {
    return result;
  }

  const { deletedApiIds, errors } = result.value;

  // Remove successfully deleted endpoints from the list
  const remainingEndpoints = endpoints.filter(
    (e) => !deletedApiIds.includes(e.apiId),
  );
  setEndpoints(remainingEndpoints);

  if (errors.length > 0) {
    sdk.console.log(
      `${LOG_PREFIX} Warning: Some gateways could not be deleted: ${errors.join("; ")}`,
    );
  }

  sdk.console.log(
    `${LOG_PREFIX} Deleted ${deletedApiIds.length} endpoints, ${remainingEndpoints.length} remaining`,
  );

  return {
    kind: "Ok",
    value: {
      remainingEndpoints,
      deletedCount: deletedApiIds.length,
      errors,
    },
  };
}

async function getStatus(): Promise<StatusResponse> {
  const config = getConfig();
  const registeredConfig = await loadRegisteredConfig();

  return {
    endpoints: getEndpoints(),
    regions: config?.regions ?? [],
    scopeId: config?.scopeId,
    scopeName: config?.scopeName,
    domains: config?.domains ?? [],
    registeredConfig,
  };
}

function getAvailableRegions(sdk: SDK): string[] {
  const regions = [...AWS_REGIONS];
  sdk.console.log(
    `${LOG_PREFIX} getAvailableRegions called, returning ${regions.length} regions`,
  );
  return regions;
}

async function reconcile(sdk: SDK): Promise<Result<ReconcileResponse>> {
  const logger: Logger = { log: (msg) => sdk.console.log(msg) };
  return reconcileGateways(sdk, logger);
}

/**
 * Proxies a request through an AWS API Gateway endpoint.
 * This is an alternative to the upstream handler for direct API usage.
 *
 * @param sdk - Caido SDK instance
 * @param method - HTTP method (GET, POST, etc.)
 * @param url - Full URL to proxy (must be valid URL format)
 * @param headers - Request headers to include
 * @param body - Optional request body
 * @returns Result containing response status, headers, and body
 */
async function proxyRequest(
  sdk: SDK,
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | undefined,
): Promise<
  Result<{ status: number; headers: Record<string, string>; body: string }>
> {
  const config = getConfig();

  if (config === undefined) {
    return { kind: "Error", error: "Target not configured" };
  }

  // Validate and parse URL
  let urlObj: URL;
  try {
    // eslint-disable-next-line compat/compat
    urlObj = new URL(url);
  } catch {
    return { kind: "Error", error: "Invalid URL format" };
  }

  const domain = urlObj.hostname;

  const endpoint = getNextEndpointForDomain(domain);

  if (endpoint === undefined) {
    return {
      kind: "Error",
      error: `No endpoints available for domain ${domain}`,
    };
  }

  try {
    // Construct the full URL to the gateway endpoint
    // Always use HTTPS for API Gateway endpoints
    const gatewayUrl = `https://${endpoint.hostname}/${endpoint.stageName}${url}`;

    sdk.console.log(`${LOG_PREFIX} Proxying request to: ${gatewayUrl}`);

    // Use the Caido HTTP client to make the request
    // When using upstream proxy, preserve the original Host header
    const response = await fetch(gatewayUrl, {
      method,
      headers: {
        ...headers,
        "X-Forwarded-Host": headers["Host"] ?? "",
      },
      body:
        body !== undefined
          ? new Blob([body], { type: "application/octet-stream" })
          : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });

    const responseBody = await response.text();

    return {
      kind: "Ok",
      value: {
        status: response.status,
        headers: responseHeaders,
        body: responseBody,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "Error", error: `Proxy request failed: ${message}` };
  }
}

/**
 * Cleans up any existing upstream plugins registered by this plugin.
 */
async function cleanupUpstreamPlugins(sdk: SDK): Promise<void> {
  const result = await sdk.graphql.execute<UpstreamsResponse>(UPSTREAMS_QUERY);

  const matchingPlugins =
    result.data?.upstreamPlugins?.filter(
      (p) => p.plugin.manifestId === PLUGIN_MANIFEST_ID,
    ) ?? [];

  for (const plugin of matchingPlugins) {
    await sdk.graphql.execute(DELETE_UPSTREAM_PLUGIN_MUTATION, {
      id: plugin.id,
    });
  }

  setUpstreamPluginId(undefined);
  setUpstreamAllowlist([]);
}

/**
 * Registers a new upstream plugin with the specified allowlist.
 * Cleans up existing plugins first to ensure only one is active.
 * Also sets up active routing for the domains using the configured regions.
 *
 * @param sdk - Caido SDK instance
 * @param domains - List of domains to include in the allowlist
 * @returns Result containing the upstream plugin ID
 */
async function registerUpstream(
  sdk: SDK,
  domains: readonly string[],
): Promise<Result<{ id: string }>> {
  const config = getConfig();
  if (config === undefined) {
    return {
      kind: "Error",
      error: "Configuration not set - please configure scope and regions first",
    };
  }

  // Clean up existing plugins first
  await cleanupUpstreamPlugins(sdk);

  const result = await sdk.graphql.execute<CreateUpstreamPluginResponse>(
    CREATE_UPSTREAM_PLUGIN_MUTATION,
    {
      input: {
        pluginId: sdk.meta.id(),
        enabled: true,
        allowlist: domains,
        denylist: [],
      },
    },
  );

  if (result.errors !== undefined && result.errors.length > 0) {
    const firstError = result.errors[0];
    return {
      kind: "Error",
      error: firstError?.message ?? "Unknown GraphQL error",
    };
  }

  const id = result.data?.createUpstreamPlugin?.upstream?.id;
  if (id === undefined) {
    return { kind: "Error", error: "Failed to create upstream plugin" };
  }

  setUpstreamPluginId(id);
  setUpstreamAllowlist(domains);

  // Set up active routing for the domains using config regions
  setActiveRouting([...domains], config.regions);

  sdk.console.log(
    `${LOG_PREFIX} Registered upstream plugin ${id} with ${domains.length} domains in ${config.regions.length} regions`,
  );

  return { kind: "Ok", value: { id } };
}

/**
 * Unregisters the current upstream plugin if one exists.
 * Also clears the active routing.
 *
 * @param sdk - Caido SDK instance
 * @returns Result indicating success or failure
 */
async function unregisterUpstream(sdk: SDK): Promise<Result<void>> {
  const id = getUpstreamPluginId();
  if (id === undefined) {
    return { kind: "Ok", value: undefined };
  }

  await sdk.graphql.execute(DELETE_UPSTREAM_PLUGIN_MUTATION, { id });

  setUpstreamPluginId(undefined);
  setUpstreamAllowlist([]);
  clearActiveRouting();

  sdk.console.log(`${LOG_PREFIX} Unregistered upstream plugin ${id}`);

  return { kind: "Ok", value: undefined };
}

/**
 * Gets the current upstream plugin status.
 *
 * @returns Status object with enabled state, allowlist, and plugin ID
 */
function getUpstreamStatus(): UpstreamStatusResponse {
  return {
    enabled: isUpstreamEnabled(),
    allowlist: getUpstreamAllowlist(),
    pluginId: getUpstreamPluginId(),
  };
}

export type API = DefineAPI<{
  saveCredentials: typeof saveCredentials;
  loadCredentials: typeof loadCredentials;
  saveScopeConfig: typeof saveScopeConfig;
  register: typeof register;
  registerMissing: typeof registerMissingGateways;
  disable: typeof disable;
  deleteEndpoint: typeof deleteEndpoint;
  deleteAllEndpoints: typeof deleteAllEndpoints;
  getStatus: typeof getStatus;
  getAvailableRegions: typeof getAvailableRegions;
  reconcile: typeof reconcile;
  proxyRequest: typeof proxyRequest;
  registerUpstream: typeof registerUpstream;
  unregisterUpstream: typeof unregisterUpstream;
  getUpstreamStatus: typeof getUpstreamStatus;
}>;

export async function init(sdk: SDK<API>) {
  sdk.console.log(`${LOG_PREFIX} === PLUGIN INITIALIZATION STARTED ===`);

  // Initialize storage and load saved data
  const database = await sdk.meta.db();
  await initStorage(database);

  const storedCredentials = await loadStoredCredentials();
  if (storedCredentials !== undefined) {
    setCredentials(storedCredentials);
    sdk.console.log(`${LOG_PREFIX} Loaded saved AWS credentials`);
  }

  const storedConfig = await loadStoredConfig();
  if (storedConfig !== undefined) {
    setConfig(storedConfig);
    sdk.console.log(
      `${LOG_PREFIX} Loaded saved config: ${storedConfig.regions.length} regions, ${storedConfig.domains.length} domains`,
    );
  }

  sdk.api.register("saveCredentials", saveCredentials);
  sdk.api.register("loadCredentials", loadCredentials);
  sdk.api.register("saveScopeConfig", saveScopeConfig);
  sdk.api.register("register", register);
  sdk.api.register("disable", disable);
  sdk.api.register("deleteEndpoint", deleteEndpoint);
  sdk.api.register("deleteAllEndpoints", deleteAllEndpoints);
  sdk.api.register("getStatus", getStatus);
  sdk.api.register("getAvailableRegions", getAvailableRegions);
  sdk.api.register("reconcile", reconcile);
  sdk.api.register("registerMissing", registerMissingGateways);
  sdk.api.register("proxyRequest", proxyRequest);
  sdk.api.register("registerUpstream", registerUpstream);
  sdk.api.register("unregisterUpstream", unregisterUpstream);
  sdk.api.register("getUpstreamStatus", getUpstreamStatus);

  const logger: Logger = { log: (msg) => sdk.console.log(msg) };

  if (storedCredentials !== undefined) {
    sdk.console.log(`${LOG_PREFIX} Reconciling gateways with AWS...`);
    const reconcileResult = await reconcileGateways(sdk, logger);
    if (reconcileResult.kind === "Ok") {
      sdk.console.log(
        `${LOG_PREFIX} Reconciliation complete: ${reconcileResult.value.endpoints.length} gateways found`,
      );

      // Restore active routing if there's a registered config
      const registeredConfig = await loadRegisteredConfig();
      if (registeredConfig !== undefined) {
        setActiveRouting(registeredConfig.domains, registeredConfig.regions);
        sdk.console.log(
          `${LOG_PREFIX} Restored active routing: ${registeredConfig.domains.length} domains, ${registeredConfig.regions.length} regions`,
        );
      }
    } else {
      sdk.console.log(
        `${LOG_PREFIX} Reconciliation failed: ${reconcileResult.error}`,
      );
    }
  }

  // Register upstream handler using the correct pattern
  try {
    sdk.events.onUpstream((sdk, info) => {
      return handleRequest(sdk, info);
    });
    sdk.console.log(
      `${LOG_PREFIX} Upstream event handler registered successfully`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sdk.console.log(
      `${LOG_PREFIX} Failed to register upstream event handler: ${message}`,
    );
  }

  // Log current state for debugging
  const status = await getStatus();
  sdk.console.log(
    `${LOG_PREFIX} Plugin initialized - endpoints: ${status.endpoints.length}`,
  );
  sdk.console.log(
    `${LOG_PREFIX} Regions: ${status.regions.length > 0 ? status.regions.join(", ") : "none"}`,
  );
  for (let i = 0; i < status.endpoints.length; i++) {
    const endpoint = status.endpoints[i];
    if (endpoint !== undefined) {
      sdk.console.log(`${LOG_PREFIX} Endpoint ${i + 1}: ${endpoint.hostname}`);
    }
  }

  sdk.console.log(`${LOG_PREFIX} Plugin initialized`);
}

// Export types for frontend use
export type {
  AWSCredentials,
  GatewayConfig,
  GatewayEndpoint,
  Result,
} from "./types";
