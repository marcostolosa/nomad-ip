/**
 * Integration tests for AWS Signature V4 signing.
 *
 * These tests verify the signing implementation without making actual AWS API calls.
 */

import * as vitest from "vitest";

import { createApiGatewayRequest } from "../packages/backend/src/aws/signing";

import type { AWSCredentials } from "./utils";

vitest.describe("AWS Signature V4", () => {
  vitest.it("should generate valid signed request structure", () => {
    const testCredentials: AWSCredentials = {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };

    const signed = createApiGatewayRequest(
      testCredentials,
      "us-east-1",
      "GET",
      "/restapis",
    );

    vitest
      .expect(signed.url)
      .toBe("https://apigateway.us-east-1.amazonaws.com/restapis");
    vitest.expect(signed.method).toBe("GET");
    vitest
      .expect(signed.headers["Authorization"])
      .toContain("AWS4-HMAC-SHA256");
    vitest
      .expect(signed.headers["Authorization"])
      .toContain("Credential=AKIAIOSFODNN7EXAMPLE");
    vitest.expect(signed.headers["x-amz-date"]).toBeDefined();
  });

  vitest.it("should include body in POST request", () => {
    const testCredentials: AWSCredentials = {
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    };

    const signed = createApiGatewayRequest(
      testCredentials,
      "us-east-1",
      "POST",
      "/restapis",
      {
        name: "test-api",
        description: "Test API",
      },
    );

    vitest
      .expect(signed.body)
      .toBe('{"name":"test-api","description":"Test API"}');
    vitest.expect(signed.headers["Content-Type"]).toBe("application/json");
    vitest.expect(signed.headers["Content-Length"]).toBeDefined();
  });
});
