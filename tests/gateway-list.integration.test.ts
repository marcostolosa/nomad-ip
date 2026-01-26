/**
 * Integration tests for listing AWS API Gateways.
 *
 * These tests use real AWS API keys and query actual resources.
 * Run locally only with valid AWS credentials.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=xxx AWS_SECRET_ACCESS_KEY=xxx pnpm test:integration
 */

import { describe, expect, it } from "vitest";

import {
  type AWSCredentials,
  getCredentials,
  listGateways,
  TEST_REGION,
} from "./utils";

describe("Gateway Listing", () => {
  let credentials: AWSCredentials | undefined;

  try {
    credentials = getCredentials();
  } catch {
    console.warn("AWS credentials not configured - tests will be skipped");
  }

  it("should list existing gateways", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const gateways = await listGateways(credentials, TEST_REGION, "nomad-ip-");
    console.log(`Found ${gateways.length} existing nomad-ip gateways`);
    expect(Array.isArray(gateways)).toBe(true);
  });

  it("should return empty array when no gateways match prefix", async () => {
    if (credentials === undefined) {
      console.log("Skipping: no credentials");
      return;
    }

    const uniquePrefix = `nonexistent-prefix-${Date.now()}-`;
    const gateways = await listGateways(credentials, TEST_REGION, uniquePrefix);
    expect(gateways).toEqual([]);
  });
});
