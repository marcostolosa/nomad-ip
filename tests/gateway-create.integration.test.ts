/**
 * Integration tests for creating AWS API Gateways.
 *
 * These tests use real AWS API keys and create actual resources.
 * Run locally only with valid AWS credentials.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx pnpm test:integration
 */

import { afterAll, describe, expect, it } from "vitest";

import {
  type AWSCredentials,
  createGateway,
  deleteGateway,
  GATEWAY_NAME_PREFIX,
  type GatewayEndpoint,
  getCredentials,
  STAGE_NAME,
  TEST_REGION,
} from "./utils";

describe("Gateway Creation", () => {
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
      } catch (error) {
        console.error(`Failed to clean up ${endpoint.apiId}:`, error);
      }
    }
  }, 60000);

  it("should create a gateway with full proxy configuration", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const name = `${GATEWAY_NAME_PREFIX}${Date.now()}`;
    const endpoint = await createGateway(credentials, TEST_REGION, name);
    createdEndpoints.push(endpoint);

    console.log(`Created gateway: ${endpoint.hostname}`);

    expect(endpoint.apiId).toBeDefined();
    expect(endpoint.hostname).toContain(endpoint.apiId);
    expect(endpoint.hostname).toContain(TEST_REGION);
    expect(endpoint.stageName).toBe(STAGE_NAME);
  }, 60000);
});
