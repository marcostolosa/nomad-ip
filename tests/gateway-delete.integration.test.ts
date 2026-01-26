/**
 * Integration tests for deleting AWS API Gateways.
 *
 * These tests use real AWS API keys and create/delete actual resources.
 * Run locally only with valid AWS credentials.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx pnpm test:integration
 */

import { describe, expect, it } from "vitest";

import {
  type AWSCredentials,
  createGateway,
  deleteGateway,
  GATEWAY_NAME_PREFIX,
  type GatewayEndpoint,
  getCredentials,
  listGateways,
  sleep,
  TEST_REGION,
} from "./utils";

describe("Gateway Deletion", () => {
  let credentials: AWSCredentials | undefined;

  try {
    credentials = getCredentials();
  } catch {
    console.warn("AWS credentials not configured - tests will be skipped");
  }

  it("should delete a gateway", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const name = `${GATEWAY_NAME_PREFIX}${Date.now()}`;
    const endpoint = await createGateway(credentials, TEST_REGION, name);
    console.log(`Created gateway for deletion test: ${endpoint.apiId}`);

    await deleteGateway(credentials, TEST_REGION, endpoint.apiId);
    console.log(`Deleted gateway: ${endpoint.apiId}`);

    const remaining = await listGateways(
      credentials,
      TEST_REGION,
      GATEWAY_NAME_PREFIX,
    );
    const found = remaining.find((g) => g.id === endpoint.apiId);
    expect(found).toBeUndefined();
  }, 60000);

  it("should delete all gateways", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const gatewaysToDelete: GatewayEndpoint[] = [];
    const gatewayCount = 3;

    for (let i = 0; i < gatewayCount; i++) {
      const name = `${GATEWAY_NAME_PREFIX}delete-all-${Date.now()}-${i}`;
      const endpoint = await createGateway(credentials, TEST_REGION, name);
      gatewaysToDelete.push(endpoint);
      console.log(`Created gateway for deletion test: ${endpoint.apiId}`);
    }

    expect(gatewaysToDelete.length).toBe(gatewayCount);

    for (const endpoint of gatewaysToDelete) {
      try {
        await deleteGateway(credentials, TEST_REGION, endpoint.apiId);
        console.log(`Deleted gateway: ${endpoint.apiId}`);
      } catch (error) {
        console.error(`Failed to delete ${endpoint.apiId}:`, error);
      }
    }

    const remainingGateways = await listGateways(
      credentials,
      TEST_REGION,
      GATEWAY_NAME_PREFIX,
    );

    const remainingTestGateways = remainingGateways.filter((gateway) =>
      gatewaysToDelete.some((deleted) => deleted.apiId === gateway.id),
    );

    expect(remainingTestGateways.length).toBe(0);
    console.log(`Successfully deleted all ${gatewayCount} test gateways`);
  }, 120000);

  it("should delete multiple gateways with rate limiting", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const gatewaysToDelete: GatewayEndpoint[] = [];
    const gatewayCount = 5;

    console.log(
      `Creating ${gatewayCount} gateways for rate-limited deletion test...`,
    );
    for (let i = 0; i < gatewayCount; i++) {
      const name = `${GATEWAY_NAME_PREFIX}rate-limited-${Date.now()}-${i}`;
      const endpoint = await createGateway(credentials, TEST_REGION, name);
      gatewaysToDelete.push(endpoint);
      console.log(`Created gateway: ${endpoint.apiId}`);
    }

    expect(gatewaysToDelete.length).toBe(gatewayCount);

    console.log(`Deleting ${gatewayCount} gateways with rate limiting...`);
    const startTime = Date.now();
    const maxRetries = 2;
    const delayMs = 500;
    const errors: string[] = [];

    for (const [i, endpoint] of gatewaysToDelete.entries()) {
      let attempt = 0;
      let success = false;

      while (attempt <= maxRetries && !success) {
        try {
          await deleteGateway(credentials, TEST_REGION, endpoint.apiId);
          console.log(`Deleted: ${endpoint.apiId} (attempt ${attempt + 1})`);
          success = true;
        } catch (error) {
          attempt++;
          console.error(
            `Failed ${endpoint.apiId} (attempt ${attempt}):`,
            error,
          );
          if (attempt <= maxRetries) {
            await sleep(delayMs);
          } else {
            errors.push(
              `Failed to delete ${endpoint.apiId} after ${maxRetries} retries`,
            );
          }
        }
      }

      if (i < gatewaysToDelete.length - 1) {
        await sleep(delayMs);
      }
    }

    const endTime = Date.now();
    console.log(`Completed in ${endTime - startTime}ms`);

    const remainingGateways = await listGateways(
      credentials,
      TEST_REGION,
      GATEWAY_NAME_PREFIX,
    );
    const remainingTestGateways = remainingGateways.filter((gateway) =>
      gatewaysToDelete.some((deleted) => deleted.apiId === gateway.id),
    );

    expect(remainingTestGateways.length).toBe(0);
    expect(errors.length).toBe(0);
    console.log(
      `Successfully deleted all ${gatewayCount} gateways with rate limiting`,
    );
  }, 180000);
});
