/**
 * Shared utilities for AWS API Gateway integration tests.
 */

import { createApiGatewayRequest } from "../packages/backend/src/aws/signing";

export type AWSCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type GatewayEndpoint = {
  region: string;
  apiId: string;
  hostname: string;
  port: number;
  stageName: string;
};

export type ResourceItem = { id?: string; path?: string };
export type RestApiItem = { id?: string; name?: string };

export type ApiGatewayResponse =
  | {
      id?: string;
      items?: ResourceItem[] | RestApiItem[];
      item?: ResourceItem[] | RestApiItem[];
      _embedded?: { item?: ResourceItem[] | RestApiItem[] };
      message?: string;
    }
  | ResourceItem;

export const TEST_REGION = "us-east-1";
export const STAGE_NAME = "nomadip";
export const GATEWAY_NAME_PREFIX = "nomad-ip-test-";
export const TARGET_HOST = "httpbin.org";

export function getCredentials(): AWSCredentials {
  const accessKeyId = process.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["AWS_SECRET_ACCESS_KEY"];

  if (accessKeyId === undefined || secretAccessKey === undefined) {
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables are required",
    );
  }

  return { accessKeyId, secretAccessKey };
}

export async function sleep(ms: number): Promise<void> {
  // eslint-disable-next-line compat/compat
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiGatewayRequest(
  credentials: AWSCredentials,
  region: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retries = 5,
): Promise<ApiGatewayResponse> {
  const signed = createApiGatewayRequest(
    credentials,
    region,
    method,
    path,
    body,
  );

  for (let attempt = 0; attempt < retries; attempt++) {
    // eslint-disable-next-line compat/compat
    const response = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body,
    });

    if (response.status === 429) {
      const waitTime = Math.pow(2, attempt) * 2000;
      console.log(`Rate limited, waiting ${waitTime}ms before retry...`);
      await sleep(waitTime);
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API Gateway request failed (${response.status}): ${errorText}`,
      );
    }

    const text = await response.text();
    if (text.length === 0) {
      return {};
    }

    return JSON.parse(text) as ApiGatewayResponse;
  }

  throw new Error(
    "API Gateway request failed: max retries exceeded due to rate limiting",
  );
}

export async function listGateways(
  credentials: AWSCredentials,
  region: string,
  prefix: string,
): Promise<RestApiItem[]> {
  const response = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    "/restapis",
  );

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

  return items.filter(
    (item) => item.name !== undefined && item.name.startsWith(prefix),
  );
}

export async function deleteGateway(
  credentials: AWSCredentials,
  region: string,
  apiId: string,
): Promise<void> {
  await apiGatewayRequest(credentials, region, "DELETE", `/restapis/${apiId}`);
}

export async function createGateway(
  credentials: AWSCredentials,
  region: string,
  name: string,
  target: string = TARGET_HOST,
): Promise<GatewayEndpoint> {
  const createResult = await apiGatewayRequest(
    credentials,
    region,
    "POST",
    "/restapis",
    {
      name,
      description: "Nomad IP integration test",
      endpointConfiguration: { types: ["REGIONAL"] },
    },
  );

  const apiId = createResult.id;
  if (apiId === undefined) {
    throw new Error("Failed to create API Gateway: no API ID returned");
  }

  const resourcesResult = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}/resources`,
  );

  console.log("Resources response:", JSON.stringify(resourcesResult, null, 2));

  let items: ResourceItem[] = [];

  // Check if response is a single ResourceItem
  if ("path" in resourcesResult && resourcesResult.path !== undefined) {
    items = [resourcesResult];
  } else if (
    "items" in resourcesResult &&
    Array.isArray(resourcesResult.items)
  ) {
    items = resourcesResult.items as ResourceItem[];
  } else if ("item" in resourcesResult && Array.isArray(resourcesResult.item)) {
    items = resourcesResult.item as ResourceItem[];
  } else if (
    "_embedded" in resourcesResult &&
    resourcesResult._embedded !== undefined &&
    Array.isArray(resourcesResult._embedded.item)
  ) {
    items = resourcesResult._embedded.item as ResourceItem[];
  } else if (
    "_embedded" in resourcesResult &&
    resourcesResult._embedded !== undefined
  ) {
    const embedded = resourcesResult._embedded as { item?: ResourceItem };
    if (embedded.item !== undefined) {
      items = [embedded.item];
    }
  } else if ("id" in resourcesResult && resourcesResult.id !== undefined) {
    items = [resourcesResult];
  }

  console.log("Parsed items:", items);

  const rootResource = items.find((item) => item.path === "/");
  if (rootResource === undefined || rootResource.id === undefined) {
    throw new Error(
      `Failed to find root resource. Items: ${JSON.stringify(items)}`,
    );
  }

  const proxyResource = await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/resources/${rootResource.id}`,
    { pathPart: "{proxy+}" },
  );

  if (proxyResource.id === undefined) {
    throw new Error("Failed to create proxy resource");
  }

  await apiGatewayRequest(
    credentials,
    region,
    "PUT",
    `/restapis/${apiId}/resources/${proxyResource.id}/methods/ANY`,
    {
      authorizationType: "NONE",
      requestParameters: {
        "method.request.path.proxy": true,
        "method.request.header.X-Forwarded-Host": true,
        "method.request.header.X-My-X-Forwarded-For": false,
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
    {
      authorizationType: "NONE",
    },
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

  await apiGatewayRequest(
    credentials,
    region,
    "POST",
    `/restapis/${apiId}/deployments`,
    {
      stageName: STAGE_NAME,
    },
  );

  return {
    region,
    apiId,
    hostname: `${apiId}.execute-api.${region}.amazonaws.com`,
    port: 443,
    stageName: STAGE_NAME,
  };
}
