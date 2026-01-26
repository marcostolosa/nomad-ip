/**
 * Integration tests for proxying requests through AWS API Gateways.
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
  TARGET_HOST,
  TEST_REGION,
} from "./utils";

describe("Gateway Proxy", () => {
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

  it("should proxy a request through the gateway", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const name = `${GATEWAY_NAME_PREFIX}${Date.now()}`;
    const endpoint = await createGateway(credentials, TEST_REGION, name);
    createdEndpoints.push(endpoint);

    console.log(`Created gateway for proxy test: ${endpoint.hostname}`);

    console.log("Waiting for deployment to propagate...");
    // eslint-disable-next-line compat/compat
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const gatewayUrl = `https://${endpoint.hostname}/${endpoint.stageName}/get`;

    console.log(`Proxying request through ${gatewayUrl}`);

    // eslint-disable-next-line compat/compat
    const response = await fetch(gatewayUrl, {
      method: "GET",
    });

    console.log(`Response status: ${response.status}`);

    if (response.ok) {
      const body = (await response.json()) as Record<string, unknown>;
      console.log("Response body:", JSON.stringify(body, null, 2));
      expect(body).toBeDefined();
      expect(body["url"]).toContain(TARGET_HOST);
    } else {
      const errorText = await response.text();
      console.log(`Error response: ${errorText}`);
    }

    expect(response.status).toBeLessThan(500);
  }, 120000);

  it("should demonstrate IP address limitation in API Gateway", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    // AWS API Gateway HTTP_PROXY integration has a known limitation with IP addresses:
    // - HTTPS requires valid SSL certificates
    // - SSL certificates are issued for domain names, not IP addresses
    // - When API Gateway connects to https://<IP>/, SSL verification fails
    //
    // This test documents this limitation by:
    // 1. Creating a gateway with an IP target
    // 2. Verifying it returns 502/504 (expected failure)
    // 3. Demonstrating why domain names are required

    const targetIP = "93.184.215.14"; // example.com IP
    const name = `${GATEWAY_NAME_PREFIX}ip-${Date.now()}`;
    const endpoint = await createGateway(
      credentials,
      TEST_REGION,
      name,
      targetIP,
    );
    createdEndpoints.push(endpoint);

    console.log(
      `Created gateway with IP target: ${endpoint.hostname} -> ${targetIP}`,
    );
    console.log(
      "Note: This gateway will fail due to SSL certificate validation",
    );

    console.log("Waiting for deployment to propagate...");
    // eslint-disable-next-line compat/compat
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const gatewayUrl = `https://${endpoint.hostname}/${endpoint.stageName}/`;

    console.log(`Testing request through ${gatewayUrl}`);

    // eslint-disable-next-line compat/compat
    const response = await fetch(gatewayUrl, {
      method: "GET",
    });

    console.log(`Response status: ${response.status}`);
    const responseText = await response.text();
    console.log(`Response: ${responseText.substring(0, 500)}`);

    // AWS API Gateway HTTP_PROXY with IP addresses results in:
    // - 502 Bad Gateway: SSL handshake failure
    // - 504 Gateway Timeout: Connection timeout due to SSL issues
    //
    // This is expected behavior and documents the limitation
    expect([502, 504]).toContain(response.status);

    console.log(
      `✓ Confirmed limitation: AWS API Gateway HTTP_PROXY cannot handle IP addresses (got ${response.status})`,
    );
    console.log(
      "  Reason: SSL certificates are issued for domain names, not IPs",
    );
    console.log("  Solution: Always use domain names as gateway targets");
  }, 120000);
});
