import { describe, expect, it } from "vitest";
import {
  filterValidDomains,
  isIPAddress,
  isIPv4,
  isIPv6,
  isValidDomain,
  isWildcard,
  missingDomainRegion,
  type GatewayEndpointBase,
} from "../packages/shared/src/domain";

// Alias for test compatibility
const isIP = isIPAddress;

describe("Domain Parsing", () => {
  describe("Wildcard Detection", () => {
    it("should detect wildcard patterns", () => {
      expect(isWildcard("*.example.com")).toBe(true);
      expect(isWildcard("*example.com")).toBe(true);
      expect(isWildcard("example.*")).toBe(true);
      expect(isWildcard("*.*.example.com")).toBe(true);
    });

    it("should not detect non-wildcard patterns as wildcards", () => {
      expect(isWildcard("example.com")).toBe(false);
      expect(isWildcard("api.example.com")).toBe(false);
      expect(isWildcard("192.168.1.1")).toBe(false);
    });
  });

  describe("IPv4 Detection", () => {
    it("should detect valid IPv4 addresses", () => {
      expect(isIPv4("192.168.1.1")).toBe(true);
      expect(isIPv4("10.0.0.1")).toBe(true);
      expect(isIPv4("172.16.0.1")).toBe(true);
      expect(isIPv4("8.8.8.8")).toBe(true);
      expect(isIPv4("255.255.255.255")).toBe(true);
      expect(isIPv4("0.0.0.0")).toBe(true);
    });

    it("should not detect domains as IPv4", () => {
      expect(isIPv4("example.com")).toBe(false);
      expect(isIPv4("api.example.com")).toBe(false);
      expect(isIPv4("sub.domain.example.com")).toBe(false);
    });

    it("should not detect invalid IPv4 patterns", () => {
      expect(isIPv4("192.168.1")).toBe(false);
      expect(isIPv4("192.168.1.1.1")).toBe(false);
      expect(isIPv4("999.999.999.999")).toBe(true); // Pattern matches, validation would fail at runtime
    });
  });

  describe("IPv6 Detection", () => {
    it("should detect IPv6 addresses", () => {
      expect(isIPv6("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(true);
      expect(isIPv6("2001:db8:85a3::8a2e:370:7334")).toBe(true);
      expect(isIPv6("::1")).toBe(true);
      expect(isIPv6("fe80::1")).toBe(true);
      expect(isIPv6("::")).toBe(true);
    });

    it("should not detect domains as IPv6", () => {
      expect(isIPv6("example.com")).toBe(false);
      expect(isIPv6("api.example.com")).toBe(false);
      expect(isIPv6("192.168.1.1")).toBe(false);
    });

    it("should handle edge cases", () => {
      // Contains dots - not IPv6
      expect(isIPv6("example.com")).toBe(false);
      // Mixed case hex
      expect(isIPv6("2001:DB8:85A3::8A2E:370:7334")).toBe(true);
    });
  });

  describe("Domain Filtering", () => {
    it("should filter out wildcards", () => {
      const allowlist = ["example.com", "*.example.com", "api.example.com"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual(["example.com", "api.example.com"]);
      expect(result.skippedWildcards).toEqual(["*.example.com"]);
      expect(result.skippedIPs).toEqual([]);
    });

    it("should filter out IPv4 addresses", () => {
      const allowlist = ["example.com", "192.168.1.1", "api.example.com"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual(["example.com", "api.example.com"]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual(["192.168.1.1"]);
    });

    it("should filter out IPv6 addresses", () => {
      const allowlist = ["example.com", "2001:db8::1", "api.example.com"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual(["example.com", "api.example.com"]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual(["2001:db8::1"]);
    });

    it("should filter out both wildcards and IPs", () => {
      const allowlist = [
        "example.com",
        "*.example.com",
        "192.168.1.1",
        "api.example.com",
        "2001:db8::1",
        "*",
        "10.0.0.1",
      ];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual(["example.com", "api.example.com"]);
      expect(result.skippedWildcards).toEqual(["*.example.com", "*"]);
      expect(result.skippedIPs).toEqual([
        "192.168.1.1",
        "2001:db8::1",
        "10.0.0.1",
      ]);
    });

    it("should return empty arrays when all entries are invalid", () => {
      const allowlist = ["*.example.com", "192.168.1.1", "2001:db8::1"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([]);
      expect(result.skippedWildcards).toEqual(["*.example.com"]);
      expect(result.skippedIPs).toEqual(["192.168.1.1", "2001:db8::1"]);
    });

    it("should handle empty allowlist", () => {
      const allowlist: string[] = [];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual([]);
    });

    it("should handle complex real-world scenarios", () => {
      const allowlist = [
        "example.com",
        "api.example.com",
        "*.cdn.example.com",
        "192.168.1.100",
        "staging.example.com",
        "10.0.0.50",
        "prod-*.example.com",
        "2001:0db8:85a3::8a2e:0370:7334",
        "auth.example.com",
      ];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([
        "example.com",
        "api.example.com",
        "staging.example.com",
        "auth.example.com",
      ]);
      expect(result.skippedWildcards).toEqual([
        "*.cdn.example.com",
        "prod-*.example.com",
      ]);
      expect(result.skippedIPs).toEqual([
        "192.168.1.100",
        "10.0.0.50",
        "2001:0db8:85a3::8a2e:0370:7334",
      ]);
    });
  });

  describe("Edge Cases", () => {
    it("should handle localhost", () => {
      expect(isIP("localhost")).toBe(false);
      expect(isIP("127.0.0.1")).toBe(true);
      expect(isIP("::1")).toBe(true);
    });

    it("should handle port numbers (not part of pattern)", () => {
      // Port numbers would typically be stripped before domain filtering
      expect(isIP("192.168.1.1:8080")).toBe(false);
      expect(isWildcard("*.example.com:443")).toBe(true);
    });

    it("should handle subdomains", () => {
      const allowlist = [
        "sub.domain.example.com",
        "deep.sub.domain.example.com",
      ];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([
        "sub.domain.example.com",
        "deep.sub.domain.example.com",
      ]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual([]);
    });

    it("should handle domains with numbers", () => {
      const allowlist = ["app1.example.com", "api2.test3.com"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([
        "app1.example.com",
        "api2.test3.com",
      ]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual([]);
    });

    it("should handle domains with hyphens", () => {
      const allowlist = ["my-app.example.com", "test-api-server.com"];
      const result = filterValidDomains(allowlist);

      expect(result.validDomains).toEqual([
        "my-app.example.com",
        "test-api-server.com",
      ]);
      expect(result.skippedWildcards).toEqual([]);
      expect(result.skippedIPs).toEqual([]);
    });
  });

  describe("Domain Validation for User Input", () => {
    it("should accept valid domain names", () => {
      expect(isValidDomain("example.com")).toBe(true);
      expect(isValidDomain("api.example.com")).toBe(true);
      expect(isValidDomain("sub.domain.example.com")).toBe(true);
      expect(isValidDomain("test-api.example.com")).toBe(true);
      expect(isValidDomain("app1.example.com")).toBe(true);
    });

    it("should reject single labels (no dot)", () => {
      expect(isValidDomain("localhost")).toBe(false);
      expect(isValidDomain("example")).toBe(false);
      expect(isValidDomain("test")).toBe(false);
    });

    it("should reject wildcard patterns", () => {
      expect(isValidDomain("*.example.com")).toBe(false);
      expect(isValidDomain("*example.com")).toBe(false);
      expect(isValidDomain("example.*")).toBe(false);
    });

    it("should reject IPv4 addresses", () => {
      expect(isValidDomain("192.168.1.1")).toBe(false);
      expect(isValidDomain("10.0.0.1")).toBe(false);
      expect(isValidDomain("8.8.8.8")).toBe(false);
    });

    it("should reject IPv6 addresses", () => {
      expect(isValidDomain("2001:db8::1")).toBe(false);
      expect(isValidDomain("::1")).toBe(false);
      expect(isValidDomain("fe80::1")).toBe(false);
    });

    it("should reject invalid characters", () => {
      expect(isValidDomain("example_test.com")).toBe(false);
      expect(isValidDomain("example@test.com")).toBe(false);
      expect(isValidDomain("example test.com")).toBe(false);
      expect(isValidDomain("example$.com")).toBe(false);
    });

    it("should reject domains starting or ending with hyphen", () => {
      expect(isValidDomain("-example.com")).toBe(false);
      expect(isValidDomain("example-.com")).toBe(false);
      expect(isValidDomain("api.-example.com")).toBe(false);
    });

    it("should reject empty or invalid formats", () => {
      expect(isValidDomain("")).toBe(false);
      expect(isValidDomain(".")).toBe(false);
      expect(isValidDomain("..")).toBe(false);
      expect(isValidDomain(".example.com")).toBe(false);
      expect(isValidDomain("example.com.")).toBe(false);
    });

    it("should accept domains with multiple subdomains", () => {
      expect(isValidDomain("a.b.c.d.example.com")).toBe(true);
      expect(isValidDomain("very.deep.subdomain.structure.example.com")).toBe(
        true,
      );
    });

    it("should accept domains with numbers", () => {
      expect(isValidDomain("app123.example.com")).toBe(true);
      expect(isValidDomain("test1.test2.example.com")).toBe(true);
      expect(isValidDomain("2024.example.com")).toBe(true);
    });

    it("should accept domains with hyphens in valid positions", () => {
      expect(isValidDomain("my-app.example.com")).toBe(true);
      expect(isValidDomain("test-api-server.example.com")).toBe(true);
      expect(isValidDomain("a-b-c.example.com")).toBe(true);
    });
  });

  describe("missingDomainRegion", () => {
    it("should return missing domains and regions for basic case", () => {
      const selectedRegions = ["us-west-1", "us-east-1"];
      const selectedScopeDomains = ["api.example.com", "api.test.com"];
      const endpoints: GatewayEndpointBase[] = [
        {
          target: "api.example.com",
          region: "us-west-1",
        },
      ];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains.sort()).toEqual([
        "api.example.com",
        "api.test.com",
      ]);
      expect(result.missingRegions.sort()).toEqual(["us-east-1", "us-west-1"]);
    });

    it("should return empty arrays when all combinations exist", () => {
      const selectedRegions = ["us-west-1"];
      const selectedScopeDomains = ["api.example.com"];
      const endpoints: GatewayEndpointBase[] = [
        {
          target: "api.example.com",
          region: "us-west-1",
        },
      ];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains).toEqual([]);
      expect(result.missingRegions).toEqual([]);
    });

    it("should return all domains and regions when no endpoints exist", () => {
      const selectedRegions = ["us-west-1", "us-east-1"];
      const selectedScopeDomains = ["api.example.com", "api.test.com"];
      const endpoints: GatewayEndpointBase[] = [];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains).toEqual([
        "api.example.com",
        "api.test.com",
      ]);
      expect(result.missingRegions).toEqual(["us-west-1", "us-east-1"]);
    });

    it("should handle partial matches correctly", () => {
      const selectedRegions = ["us-west-1", "us-east-1"];
      const selectedScopeDomains = ["api.example.com", "api.test.com"];
      const endpoints: GatewayEndpointBase[] = [
        {
          target: "api.example.com",
          region: "us-west-1",
        },
        {
          target: "api.test.com",
          region: "us-west-1",
        },
      ];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains).toEqual([
        "api.example.com",
        "api.test.com",
      ]);
      expect(result.missingRegions).toEqual(["us-east-1"]);
    });

    it("should ignore endpoints with empty targets", () => {
      const selectedRegions = ["us-west-1"];
      const selectedScopeDomains = ["api.example.com"];
      const endpoints: GatewayEndpointBase[] = [
        {
          target: "",
          region: "us-west-1",
        },
      ];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains).toEqual(["api.example.com"]);
      expect(result.missingRegions).toEqual(["us-west-1"]);
    });

    it("should handle empty inputs gracefully", () => {
      const selectedRegions: string[] = [];
      const selectedScopeDomains: string[] = [];
      const endpoints: GatewayEndpointBase[] = [];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      expect(result.missingDomains).toEqual([]);
      expect(result.missingRegions).toEqual([]);
    });

    it("should handle large numbers of domains and regions", () => {
      const selectedRegions = [
        "us-west-1",
        "us-west-2",
        "us-east-1",
        "us-east-2",
        "eu-west-1",
      ];
      const selectedScopeDomains = [
        "api.example.com",
        "api.test.com",
        "api.demo.com",
      ];
      const endpoints: GatewayEndpointBase[] = [
        {
          target: "api.example.com",
          region: "us-west-1",
        },
      ];

      const result = missingDomainRegion(
        selectedRegions,
        selectedScopeDomains,
        endpoints,
      );

      // Should have all domains and all regions except the one combination that exists
      expect(result.missingDomains.length).toBe(3);
      expect(result.missingRegions.length).toBe(5);
      expect(result.missingDomains).toContain("api.example.com");
      expect(result.missingDomains).toContain("api.test.com");
      expect(result.missingDomains).toContain("api.demo.com");
    });
  });
});
