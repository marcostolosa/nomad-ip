/* eslint-disable compat/compat */
import { Blob, fetch } from "caido:http";

import {
  GATEWAY_NAME_PREFIX,
  LOG_PREFIX,
  MAX_RETRIES,
  RATE_LIMIT_DELAY_MS,
  RETRY_DELAY_MS,
  STAGE_NAME,
} from "../constants";
import type {
  AWSCredentials,
  AWSRegion,
  GatewayEndpoint,
  Result,
} from "../types";

import { createApiGatewayRequest } from "./signing";

/**
 * IMPORTANT: AWS API Gateway Limitation
 *
 * AWS API Gateway HTTP_PROXY integration requires a FIXED target host.
 * The current implementation uses httpbin.org as a fixed target for testing.
 *
 * For production use with arbitrary targets, you would need to:
 * 1. Create separate API Gateway instances for each target domain, OR
 * 2. Use a different approach like AWS Lambda with custom routing, OR
 * 3. Use a different service that supports dynamic routing
 *
 * The current approach with X-Forwarded-Host headers does NOT work with
 * AWS API Gateway's HTTP_PROXY integration type.
 */

type ResourceItem = { id?: string; path?: string };

type RestApiItem = {
  id?: string;
  name?: string;
  description?: string;
  createdDate?: string;
  tags?: Record<string, string>;
};

type ApiGatewayResponse = {
  id?: string;
  items?: ResourceItem[];
  item?: ResourceItem[] | RestApiItem[];
  _embedded?: { item?: ResourceItem[] | RestApiItem[] };
  message?: string;
  tags?: Record<string, string>;
};

export type Logger = {
  log: (message: string) => void;
};

async function apiGatewayRequest(
  credentials: AWSCredentials,
  region: string,
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
  logger: Logger,
): Promise<Result<ApiGatewayResponse>> {
  try {
    logger.log(`${LOG_PREFIX} Signing request: ${method} ${path}`);

    const signed = createApiGatewayRequest(
      credentials,
      region,
      method,
      path,
      body,
    );

    logger.log(`${LOG_PREFIX} Signed URL: ${signed.url}`);
    logger.log(`${LOG_PREFIX} Has body: ${signed.body !== undefined}`);

    let bodyBlob: Blob | undefined;
    if (signed.body !== undefined) {
      logger.log(`${LOG_PREFIX} Creating body blob`);
      bodyBlob = new Blob([signed.body], { type: "application/json" });
      logger.log(`${LOG_PREFIX} Body blob created`);
    }

    logger.log(`${LOG_PREFIX} About to fetch...`);

    const response = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: bodyBlob,
    });

    logger.log(`${LOG_PREFIX} Got response: ${response.status}`);

    if (!response.ok) {
      logger.log(`${LOG_PREFIX} Reading error text...`);
      const errorText = await response.text();
      logger.log(`${LOG_PREFIX} Error: ${errorText}`);
      return {
        kind: "Error",
        error: `API Gateway request failed (${response.status}): ${errorText}`,
      };
    }

    // Get the response text first to check if it's empty
    const responseText = await response.text();

    // If response is empty or just whitespace, return empty object
    if (responseText.trim() === "") {
      logger.log(`${LOG_PREFIX} Success (empty response): ${method} ${path}`);
      return { kind: "Ok", value: {} };
    }

    // Try to parse as JSON
    try {
      logger.log(`${LOG_PREFIX} Parsing JSON...`);
      const data = JSON.parse(responseText) as ApiGatewayResponse;
      logger.log(`${LOG_PREFIX} Success: ${method} ${path}`);
      return { kind: "Ok", value: data };
    } catch (parseError) {
      logger.log(`${LOG_PREFIX} JSON parse error, returning text as-is`);
      return { kind: "Ok", value: {} };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.log(`${LOG_PREFIX} Exception: ${message}`);
    return { kind: "Error", error: `API Gateway request failed: ${message}` };
  }
}

async function getGatewayDetails(
  credentials: AWSCredentials,
  region: AWSRegion,
  apiId: string,
  logger: Logger,
): Promise<Result<GatewayEndpoint | undefined>> {
  const result = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}`,
    undefined,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  const response = result.value;

  // Extract target from tags
  const target = response.tags?.["nomad-ip-target"] ?? "";

  return {
    kind: "Ok",
    value: {
      region,
      apiId,
      hostname: `${apiId}.execute-api.${region}.amazonaws.com`,
      port: 443,
      stageName: STAGE_NAME,
      target,
    },
  };
}

/**
 * Lists all Nomad IP gateways in a specific AWS region.
 * Filters gateways by the GATEWAY_NAME_PREFIX and fetches full details including tags.
 *
 * @param credentials - AWS credentials for API calls
 * @param region - AWS region to query
 * @param logger - Logger instance for status messages
 * @returns Result containing list of gateway endpoints in the region
 */
async function listGateways(
  credentials: AWSCredentials,
  region: AWSRegion,
  logger: Logger,
): Promise<Result<GatewayEndpoint[]>> {
  const result = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    "/restapis",
    undefined,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  const response = result.value;
  let items: RestApiItem[] = [];

  if (Array.isArray(response.items)) {
    items = response.items as RestApiItem[];
  } else if (Array.isArray(response.item)) {
    items = response.item as RestApiItem[];
  } else if (
    response._embedded !== undefined &&
    Array.isArray(response._embedded.item)
  ) {
    items = response._embedded.item as RestApiItem[];
  }

  // Filter to only nomad-ip gateways
  const nomadIpItems = items.filter(
    (item) =>
      item.id !== undefined &&
      item.name !== undefined &&
      item.name.startsWith(GATEWAY_NAME_PREFIX),
  );

  // Fetch details (including tags) for each gateway
  const endpoints: GatewayEndpoint[] = [];

  for (const item of nomadIpItems) {
    if (item.id === undefined) continue;

    const detailsResult = await getGatewayDetails(
      credentials,
      region,
      item.id,
      logger,
    );

    if (detailsResult.kind === "Ok" && detailsResult.value !== undefined) {
      endpoints.push(detailsResult.value);
    }
  }

  return { kind: "Ok", value: endpoints };
}

/**
 * Lists all Nomad IP gateways across multiple AWS regions in parallel.
 *
 * @param credentials - AWS credentials for API calls
 * @param regions - List of regions to query
 * @param logger - Logger instance for status messages
 * @returns Result containing all found endpoints, or error if all regions fail
 */
export async function listAllGateways(
  credentials: AWSCredentials,
  regions: AWSRegion[],
  logger: Logger,
): Promise<Result<GatewayEndpoint[]>> {
  const results = await Promise.all(
    regions.map((region) => listGateways(credentials, region, logger)),
  );

  const endpoints: GatewayEndpoint[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.kind === "Ok") {
      endpoints.push(...result.value);
    } else {
      errors.push(result.error);
    }
  }

  if (endpoints.length === 0 && errors.length > 0) {
    return { kind: "Error", error: errors.join("; ") };
  }

  return { kind: "Ok", value: endpoints };
}

/**
 * Creates a new AWS API Gateway for proxying requests to a target domain.
 *
 * This function performs an 8-step process to create a fully configured API Gateway:
 *
 * 1. **Create REST API**: Creates a new regional REST API with metadata tags
 *    - Tags include: `nomad-ip-target` (target domain) and `nomad-ip-stage` (stage name)
 *
 * 2. **Get Resources**: Retrieves the root resource ID for the API
 *
 * 3. **Create Proxy Resource**: Creates a `{proxy+}` resource to capture all paths
 *
 * 4. **Put Method on Proxy**: Configures ANY method on the proxy resource
 *    - Sets up request parameters for path proxy and headers
 *
 * 5. **Put Integration on Proxy**: Configures HTTP_PROXY integration
 *    - Routes requests to `https://{target}/{proxy}`
 *    - Overrides Host header to target domain (required for CDNs like Cloudflare)
 *    - Clears X-Forwarded-For to get fresh AWS IP
 *
 * 6. **Put Method on Root**: Configures ANY method on root resource
 *
 * 7. **Put Integration on Root**: Configures HTTP_PROXY for root path
 *    - Routes requests to `https://{target}/`
 *
 * 8. **Create Deployment**: Deploys the API to a stage for public access
 *
 * @param credentials - AWS credentials for API calls
 * @param region - AWS region to create the gateway in
 * @param target - Target domain to proxy requests to (e.g., "api.example.com")
 * @param logger - Logger instance for status messages
 * @returns Result containing the gateway endpoint details, or error message
 *
 * @example
 * const result = await createGateway(credentials, "us-east-1", "api.example.com", logger);
 * if (result.kind === "Ok") {
 *   console.log(`Gateway created: ${result.value.hostname}`);
 * }
 */
async function createGateway(
  credentials: AWSCredentials,
  region: AWSRegion,
  target: string,
  logger: Logger,
): Promise<Result<GatewayEndpoint>> {
  // Step 1: Create REST API with tags for metadata
  const createApiResult = await apiGatewayRequest(
    credentials,
    region,
    "POST",
    "/restapis",
    {
      name: `${GATEWAY_NAME_PREFIX}${region}`,
      description: "Nomad IP proxy",
      endpointConfiguration: {
        types: ["REGIONAL"],
      },
      tags: {
        "nomad-ip-target": target,
        "nomad-ip-stage": STAGE_NAME,
      },
    },
    logger,
  );

  if (createApiResult.kind === "Error") {
    return createApiResult;
  }

  const apiId = createApiResult.value.id;
  if (apiId === undefined) {
    logger.log(JSON.stringify(createApiResult.value));
    return {
      kind: "Error",
      error: "Failed to create API Gateway: no API ID returned",
    };
  }

  // Step 2: Get resources to find root
  const resourcesResult = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}/resources`,
    undefined,
    logger,
  );

  if (resourcesResult.kind === "Error") {
    return resourcesResult;
  }

  // AWS API Gateway can return items in different formats
  const resourceResponse = resourcesResult.value;

  logger.log(
    `${LOG_PREFIX} Resources response keys: ${Object.keys(resourceResponse).join(", ")}`,
  );

  let items: ResourceItem[] = [];
  if (Array.isArray(resourceResponse.items)) {
    items = resourceResponse.items;
    logger.log(`${LOG_PREFIX} Found items array with ${items.length} items`);
  } else if (Array.isArray(resourceResponse.item)) {
    items = resourceResponse.item;
    logger.log(`${LOG_PREFIX} Found item array with ${items.length} items`);
  } else if (
    resourceResponse._embedded !== undefined &&
    Array.isArray(resourceResponse._embedded.item)
  ) {
    items = resourceResponse._embedded.item;
    logger.log(
      `${LOG_PREFIX} Found _embedded.item array with ${items.length} items`,
    );
  } else if (
    resourceResponse._embedded !== undefined &&
    resourceResponse._embedded.item !== undefined
  ) {
    // Handle case where _embedded.item is a single object (not an array)
    items = [resourceResponse._embedded.item as ResourceItem];
    logger.log(
      `${LOG_PREFIX} Found _embedded.item object, converted to array with 1 item`,
    );
  } else if (
    resourceResponse._embedded !== undefined &&
    Array.isArray(resourceResponse._embedded)
  ) {
    // Handle case where _embedded contains the items directly
    items = resourceResponse._embedded;
    logger.log(
      `${LOG_PREFIX} Found _embedded array with ${items.length} items`,
    );
  } else {
    logger.log(`${LOG_PREFIX} No items array found in response`);
  }

  let rootResource: ResourceItem | undefined;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item !== undefined && item.path === "/") {
      rootResource = item;
      break;
    }
  }

  if (rootResource === undefined || rootResource.id === undefined) {
    return {
      kind: "Error",
      error: `Failed to find root resource in ${region}. Got ${items.length} items.`,
    };
  }
  const rootResourceId = rootResource.id;
  logger.log(`${LOG_PREFIX} Found root resource: ${rootResourceId}`);

  // Step 3: Create proxy resource {proxy+}
  const proxyResourceResult = await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/resources/${rootResourceId}`,
    {
      pathPart: "{proxy+}",
    },
    logger,
  );

  if (proxyResourceResult.kind === "Error") {
    return proxyResourceResult;
  }

  const proxyResourceId = proxyResourceResult.value.id;
  if (proxyResourceId === undefined) {
    return { kind: "Error", error: "Failed to create proxy resource" };
  }

  // Step 4: Put method on proxy resource
  const proxyMethodResult = await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${proxyResourceId}/methods/ANY`,
    {
      authorizationType: "NONE",
      requestParameters: {
        "method.request.path.proxy": true,
        "method.request.header.X-Forwarded-Host": true,
        "method.request.header.X-My-X-Forwarded-For": false,
      },
    },
    logger,
  );

  if (proxyMethodResult.kind === "Error") {
    return proxyMethodResult;
  }

  // Step 5: Put integration on proxy resource
  // Use the configured target instead of hardcoded httpbin.org
  // Override Host header to target domain (required for Cloudflare and other CDNs)
  const proxyIntegrationResult = await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${proxyResourceId}/methods/ANY/integration`,
    {
      type: "HTTP_PROXY",
      httpMethod: "ANY",
      uri: `https://${target}/{proxy}`,
      requestParameters: {
        "integration.request.path.proxy": "method.request.path.proxy",
        "integration.request.header.Host": `'${target}'`,
        // ADD THIS LINE BELOW:
        "integration.request.header.X-Forwarded-For": "''",
      },
    },
    logger,
  );

  if (proxyIntegrationResult.kind === "Error") {
    return proxyIntegrationResult;
  }

  // Step 6: Put method on root resource
  const rootMethodResult = await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${rootResourceId}/methods/ANY`,
    {
      authorizationType: "NONE",
    },
    logger,
  );

  if (rootMethodResult.kind === "Error") {
    return rootMethodResult;
  }

  // Step 7: Put integration on root resource
  // Override Host header to target domain (required for Cloudflare and other CDNs)
  const rootIntegrationResult = await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${rootResourceId}/methods/ANY/integration`,
    {
      type: "HTTP_PROXY",
      httpMethod: "ANY",
      uri: `https://${target}/`,
      requestParameters: {
        "integration.request.header.Host": `'${target}'`,
        "integration.request.header.X-Forwarded-For": "''",
      },
    },
    logger,
  );

  if (rootIntegrationResult.kind === "Error") {
    return rootIntegrationResult;
  }

  // Step 8: Create deployment
  const deploymentResult = await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/deployments`,
    {
      stageName: STAGE_NAME,
    },
    logger,
  );

  if (deploymentResult.kind === "Error") {
    return deploymentResult;
  }

  const hostname = `${apiId}.execute-api.${region}.amazonaws.com`;

  return {
    kind: "Ok",
    value: {
      region,
      apiId,
      hostname,
      port: 443,
      stageName: STAGE_NAME,
      target,
    },
  };
}

/**
 * Deletes an AWS API Gateway by its ID.
 *
 * @param credentials - AWS credentials for API calls
 * @param region - AWS region where the gateway exists
 * @param apiId - The API Gateway ID to delete
 * @param logger - Logger instance for status messages
 * @returns Result indicating success or failure
 */
export async function deleteGateway(
  credentials: AWSCredentials,
  region: AWSRegion,
  apiId: string,
  logger: Logger,
): Promise<Result<void>> {
  const result = await apiGatewayRequest(
    credentials,
    region,
    "DELETE",
    `/restapis/${apiId}`,
    undefined,
    logger,
  );

  if (result.kind === "Error") {
    return result;
  }

  return { kind: "Ok", value: undefined };
}

/**
 * Creates API Gateways for all domain/region combinations in the given scope.
 * Reuses existing gateways where possible and creates new ones with retry logic.
 *
 * @param credentials - AWS credentials for API calls
 * @param regions - List of AWS regions to create gateways in
 * @param domains - List of target domains to create gateways for
 * @param existingEndpoints - Existing endpoints to check for reuse
 * @param logger - Logger instance for status messages
 * @returns Result containing all endpoints (existing + newly created)
 */
export async function createGatewaysForScope(
  credentials: AWSCredentials,
  regions: AWSRegion[],
  domains: string[],
  existingEndpoints: GatewayEndpoint[],
  logger: Logger,
): Promise<Result<GatewayEndpoint[]>> {
  const allEndpoints: GatewayEndpoint[] = [];
  const errors: string[] = [];
  let isFirstCreation = true;

  for (const domain of domains) {
    for (const region of regions) {
      const existing = existingEndpoints.find(
        (e) => e.target === domain && e.region === region,
      );

      if (existing !== undefined) {
        logger.log(
          `${LOG_PREFIX} Reusing existing gateway for ${domain}@${region}`,
        );
        allEndpoints.push({
          ...existing,
          target:
            existing.target !== undefined && existing.target !== ""
              ? existing.target
              : domain,
        });
        continue;
      }

      // Check for existing gateway with empty target (from failed tag retrieval)
      const existingByApiId = existingEndpoints.find(
        (e) => e.region === region && e.target === "",
      );

      if (existingByApiId !== undefined) {
        logger.log(
          `${LOG_PREFIX} Reusing existing gateway ${existingByApiId.apiId} for ${domain}@${region} (updating target)`,
        );
        allEndpoints.push({
          ...existingByApiId,
          target: domain,
        });
        continue;
      }

      // Rate limiting: add delay between gateway creations to avoid AWS throttling
      if (!isFirstCreation) {
        await sleep(RATE_LIMIT_DELAY_MS);
      }
      isFirstCreation = false;

      // Create gateway with retry logic
      const result = await withRetry(
        () => createGateway(credentials, region, domain, logger),
        logger,
        `Create gateway for ${domain}@${region}`,
      );

      if (result.kind === "Ok") {
        const endpoint: GatewayEndpoint = {
          ...result.value,
          target: domain,
        };
        allEndpoints.push(endpoint);
        logger.log(
          `${LOG_PREFIX} Created new gateway for ${domain}@${region}: ${result.value.apiId} -> ${domain}`,
        );
      } else {
        errors.push(`${domain}@${region}: ${result.error}`);
      }
    }
  }

  if (allEndpoints.length === 0 && errors.length > 0) {
    return { kind: "Error", error: errors.join("; ") };
  }

  return { kind: "Ok", value: allEndpoints };
}

/**
 * Delays execution for the specified number of milliseconds.
 * Used for rate limiting and retry backoff.
 */
async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async operation with retry logic.
 * Retries on failure up to maxRetries times with exponential backoff.
 */
async function withRetry<T>(
  operation: () => Promise<Result<T>>,
  logger: Logger,
  operationName: string,
  maxRetries: number = MAX_RETRIES,
  baseDelayMs: number = RETRY_DELAY_MS,
): Promise<Result<T>> {
  let lastError: string = "Unknown error";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await operation();

    if (result.kind === "Ok") {
      return result;
    }

    lastError = result.error;

    if (attempt < maxRetries) {
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.log(
        `${LOG_PREFIX} ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms...`,
      );
      await sleep(delayMs);
    }
  }

  return {
    kind: "Error",
    error: `${operationName} failed after ${maxRetries + 1} attempts: ${lastError}`,
  };
}

type DeleteAllResult = {
  deletedApiIds: string[];
  errors: string[];
};

/**
 * Deletes all API Gateway endpoints with retry logic and rate limiting.
 * Continues deleting even if some deletions fail.
 *
 * @param credentials - AWS credentials for API calls
 * @param endpoints - List of endpoints to delete
 * @param logger - Logger instance for status messages
 * @returns Result containing deleted API IDs and any errors encountered
 */
export async function deleteAllGateways(
  credentials: AWSCredentials,
  endpoints: GatewayEndpoint[],
  logger: Logger,
): Promise<Result<DeleteAllResult>> {
  const errors: string[] = [];
  const deletedApiIds: string[] = [];

  for (const [i, endpoint] of endpoints.entries()) {
    let attempt = 0;
    let success = false;

    while (attempt <= MAX_RETRIES && !success) {
      try {
        const result = await deleteGateway(
          credentials,
          endpoint.region as AWSRegion,
          endpoint.apiId,
          logger,
        );

        if (result.kind === "Ok") {
          success = true;
          deletedApiIds.push(endpoint.apiId);
          logger.log(
            `${LOG_PREFIX} Successfully deleted gateway ${endpoint.apiId} (attempt ${attempt + 1})`,
          );
        } else {
          attempt++;
          if (attempt <= MAX_RETRIES) {
            logger.log(
              `${LOG_PREFIX} Failed to delete ${endpoint.apiId}, retrying (${attempt}/${MAX_RETRIES})...`,
            );
            await sleep(RETRY_DELAY_MS);
          } else {
            errors.push(
              `Failed to delete ${endpoint.apiId} after ${MAX_RETRIES} retries: ${result.error}`,
            );
          }
        }
      } catch (error) {
        attempt++;
        const message = error instanceof Error ? error.message : String(error);
        if (attempt <= MAX_RETRIES) {
          logger.log(
            `${LOG_PREFIX} Exception deleting ${endpoint.apiId}, retrying (${attempt}/${MAX_RETRIES}): ${message}`,
          );
          await sleep(RETRY_DELAY_MS);
        } else {
          errors.push(
            `Exception deleting ${endpoint.apiId} after ${MAX_RETRIES} retries: ${message}`,
          );
        }
      }

      // Add delay between calls to avoid rate limiting
      if (i < endpoints.length - 1 || (attempt < MAX_RETRIES && !success)) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  return { kind: "Ok", value: { deletedApiIds, errors } };
}
