/**
 * Integration tests for AWS API Gateway tags functionality.
 *
 * These tests verify that:
 * 1. Tags are correctly set when creating a gateway
 * 2. Tags can be retrieved when fetching gateway details
 * 3. The target can be recovered from tags without local storage
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx pnpm test:integration
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  apiGatewayRequest,
  type ApiGatewayResponse,
  type AWSCredentials,
  deleteGateway,
  GATEWAY_NAME_PREFIX,
  getCredentials,
  type ResourceItem,
  sleep,
  STAGE_NAME,
  TARGET_HOST,
  TEST_REGION,
} from "./utils";

type GatewayEndpoint = {
  region: string;
  apiId: string;
  hostname: string;
  port: number;
  stageName: string;
  target: string;
};

type GatewayDetailsResponse = ApiGatewayResponse & {
  tags?: Record<string, string>;
};

/**
 * Creates a gateway with tags containing metadata (target, stage).
 */
async function createGatewayWithTags(
  credentials: AWSCredentials,
  region: string,
  target: string,
): Promise<GatewayEndpoint> {
  const name = `${GATEWAY_NAME_PREFIX}tags-test-${Date.now()}`;

  // Create REST API with tags
  const createResult = (await apiGatewayRequest(
    credentials,
    region,
    "POST",
    "/restapis",
    {
      name,
      description: "Nomad IP tags integration test",
      endpointConfiguration: { types: ["REGIONAL"] },
      tags: {
        "nomad-ip-target": target,
        "nomad-ip-stage": STAGE_NAME,
      },
    },
  )) as { id?: string };

  const apiId = createResult.id;
  if (apiId === undefined) {
    throw new Error("Failed to create API Gateway: no API ID returned");
  }

  // Get root resource
  const resourcesResult = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}/resources`,
  );

  let items: ResourceItem[] = [];
  if ("items" in resourcesResult && Array.isArray(resourcesResult.items)) {
    items = resourcesResult.items as ResourceItem[];
  } else if ("item" in resourcesResult && Array.isArray(resourcesResult.item)) {
    items = resourcesResult.item as ResourceItem[];
  } else if (
    "_embedded" in resourcesResult &&
    resourcesResult._embedded !== undefined
  ) {
    const embedded = resourcesResult._embedded as {
      item?: ResourceItem | ResourceItem[];
    };
    if (Array.isArray(embedded.item)) {
      items = embedded.item;
    } else if (embedded.item !== undefined) {
      items = [embedded.item];
    }
  }

  const rootResource = items.find((item) => item.path === "/");
  if (rootResource === undefined || rootResource.id === undefined) {
    throw new Error("Failed to find root resource");
  }

  // Create proxy resource
  const proxyResource = (await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/resources/${rootResource.id}`,
    { pathPart: "{proxy+}" },
  )) as { id?: string };

  if (proxyResource.id === undefined) {
    throw new Error("Failed to create proxy resource");
  }

  // Setup methods and integrations
  await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${proxyResource.id}/methods/ANY`,
    {
      authorizationType: "NONE",
      requestParameters: {
        "method.request.path.proxy": true,
      },
    },
  );

  await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${proxyResource.id}/methods/ANY/integration`,
    {
      type: "HTTP_PROXY",
      httpMethod: "ANY",
      uri: `https://${target}/{proxy}`,
      requestParameters: {
        "integration.request.path.proxy": "method.request.path.proxy",
      },
    },
  );

  await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${rootResource.id}/methods/ANY`,
    { authorizationType: "NONE" },
  );

  await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${rootResource.id}/methods/ANY/integration`,
    {
      type: "HTTP_PROXY",
      httpMethod: "ANY",
      uri: `https://${target}/`,
    },
  );

  // Deploy
  await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/deployments`,
    { stageName: STAGE_NAME },
  );

  return {
    region,
    apiId,
    hostname: `${apiId}.execute-api.${region}.amazonaws.com`,
    port: 443,
    stageName: STAGE_NAME,
    target,
  };
}

/**
 * Fetches gateway details including tags.
 */
async function getGatewayDetails(
  credentials: AWSCredentials,
  region: string,
  apiId: string,
): Promise<GatewayDetailsResponse> {
  return (await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}`,
  )) as GatewayDetailsResponse;
}

describe("Gateway Tags", () => {
  const createdEndpoints: GatewayEndpoint[] = [];
  let credentials: AWSCredentials | undefined;

  try {
    credentials = getCredentials();
  } catch {
    console.warn("AWS credentials not configured - tests will be skipped");
  }

  afterAll(async () => {
    if (credentials === undefined) return;

    for (const endpoint of createdEndpoints) {
      try {
        await deleteGateway(credentials, endpoint.region, endpoint.apiId);
        console.log(`Cleaned up gateway: ${endpoint.apiId}`);
        await sleep(1000);
      } catch (error) {
        console.error(`Failed to clean up ${endpoint.apiId}:`, error);
      }
    }
  }, 120000);

  it("should create a gateway with tags and retrieve them", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    // Step 1: Create a gateway with tags
    console.log(`Creating gateway with target: ${TARGET_HOST}`);
    const endpoint = await createGatewayWithTags(
      credentials,
      TEST_REGION,
      TARGET_HOST,
    );
    createdEndpoints.push(endpoint);

    console.log(`Created gateway: ${endpoint.apiId}`);
    expect(endpoint.apiId).toBeDefined();

    // Step 2: Fetch gateway details and verify tags
    console.log("Fetching gateway details to verify tags...");
    const details = await getGatewayDetails(
      credentials,
      TEST_REGION,
      endpoint.apiId,
    );

    console.log(`Gateway tags:`, details.tags);

    expect(details.tags).toBeDefined();
    expect(details.tags?.["nomad-ip-target"]).toBe(TARGET_HOST);
    expect(details.tags?.["nomad-ip-stage"]).toBe(STAGE_NAME);

    console.log(
      `✓ Tags verified: target="${details.tags?.["nomad-ip-target"]}"`,
    );
  }, 60000);

  it("should recover target from tags when listing gateways", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    // Create a gateway if we don't have one from previous test
    let testEndpoint: GatewayEndpoint;

    if (createdEndpoints.length === 0) {
      console.log("Creating test gateway...");
      testEndpoint = await createGatewayWithTags(
        credentials,
        TEST_REGION,
        TARGET_HOST,
      );
      createdEndpoints.push(testEndpoint);
    } else {
      testEndpoint = createdEndpoints[0]!;
    }

    // Simulate what the plugin does: list gateways, then fetch details for each
    console.log("Listing all gateways...");
    const listResult = await apiGatewayRequest(
      credentials,
      TEST_REGION,
      "GET",
      "/restapis",
    );

    type RestApiItem = { id?: string; name?: string };
    let items: RestApiItem[] = [];

    if ("items" in listResult && Array.isArray(listResult.items)) {
      items = listResult.items as RestApiItem[];
    } else if ("item" in listResult && Array.isArray(listResult.item)) {
      items = listResult.item as RestApiItem[];
    } else if (
      "_embedded" in listResult &&
      listResult._embedded !== undefined &&
      Array.isArray(listResult._embedded.item)
    ) {
      items = listResult._embedded.item as RestApiItem[];
    }

    // Filter to nomad-ip gateways
    const nomadIpGateways = items.filter(
      (item) =>
        item.name !== undefined && item.name.startsWith(GATEWAY_NAME_PREFIX),
    );

    console.log(`Found ${nomadIpGateways.length} nomad-ip gateways`);

    // For each gateway, fetch details to get tags
    for (const gateway of nomadIpGateways) {
      if (gateway.id === undefined) continue;

      const details = await getGatewayDetails(
        credentials,
        TEST_REGION,
        gateway.id,
      );

      const target = details.tags?.["nomad-ip-target"] ?? "";
      console.log(`Gateway ${gateway.id}: target="${target}"`);

      // Verify our test gateway has the correct target
      if (gateway.id === testEndpoint.apiId) {
        expect(target).toBe(TARGET_HOST);
        console.log(`✓ Test gateway target recovered correctly from tags`);
      }
    }
  }, 60000);
});
