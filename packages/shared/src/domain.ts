/**
 * Domain validation utilities for Nomad IP.
 * Shared between backend and frontend.
 */

// Domain validation patterns
const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]+$/;
const DOMAIN_PATTERN =
  /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/;

/**
 * Result of filtering domains from an allowlist.
 */
export type DomainFilterResult = {
  /** Valid domains that passed all validation checks */
  validDomains: string[];
  /** Wildcard patterns that were skipped */
  skippedWildcards: string[];
  /** IP addresses that were skipped */
  skippedIPs: string[];
};

/**
 * Checks if a domain pattern contains a wildcard character.
 *
 * @param domain - The domain string to check
 * @returns True if the domain contains a wildcard (*), false otherwise
 *
 * @example
 * isWildcard("*.example.com") // true
 * isWildcard("example.com") // false
 */
export function isWildcard(domain: string): boolean {
  return domain.includes("*");
}

/**
 * Checks if a string is an IPv4 address.
 *
 * @param value - The string to check
 * @returns True if the value matches IPv4 format
 */
export function isIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

/**
 * Checks if a string is an IPv6 address.
 *
 * @param value - The string to check
 * @returns True if the value matches IPv6 format
 */
export function isIPv6(value: string): boolean {
  return IPV6_PATTERN.test(value);
}

/**
 * Checks if a string is an IP address (IPv4 or IPv6).
 *
 * @param value - The string to check
 * @returns True if the value is an IPv4 or IPv6 address
 *
 * @example
 * isIPAddress("192.168.1.1") // true
 * isIPAddress("::1") // true
 * isIPAddress("example.com") // false
 */
export function isIPAddress(value: string): boolean {
  return isIPv4(value) || isIPv6(value);
}

/**
 * Validates if a string is a valid domain name.
 * Rejects wildcards, IP addresses, and invalid domain formats.
 *
 * @param domain - The domain string to validate
 * @returns True if the domain is valid, false otherwise
 *
 * @example
 * isValidDomain("example.com") // true
 * isValidDomain("api.example.com") // true
 * isValidDomain("*.example.com") // false (wildcard)
 * isValidDomain("192.168.1.1") // false (IP address)
 * isValidDomain("localhost") // false (no TLD)
 */
export function isValidDomain(domain: string): boolean {
  if (isWildcard(domain)) {
    return false;
  }

  if (isIPAddress(domain)) {
    return false;
  }

  return DOMAIN_PATTERN.test(domain);
}

/**
 * Filters a list of allowlist entries to extract valid domains.
 * Separates wildcards and IP addresses into separate arrays for reporting.
 *
 * @param allowlist - Array of domain patterns to filter
 * @returns Object containing valid domains and skipped entries
 *
 * @example
 * filterValidDomains(["example.com", "*.test.com", "192.168.1.1"])
 * // Returns:
 * // {
 * //   validDomains: ["example.com"],
 * //   skippedWildcards: ["*.test.com"],
 * //   skippedIPs: ["192.168.1.1"]
 * // }
 */
export function filterValidDomains(allowlist: string[]): DomainFilterResult {
  const validDomains: string[] = [];
  const skippedWildcards: string[] = [];
  const skippedIPs: string[] = [];

  for (const pattern of allowlist) {
    if (isWildcard(pattern)) {
      skippedWildcards.push(pattern);
    } else if (isIPAddress(pattern)) {
      skippedIPs.push(pattern);
    } else {
      validDomains.push(pattern);
    }
  }

  return { validDomains, skippedWildcards, skippedIPs };
}

/**
 * Gateway endpoint information (minimal type for shared usage).
 */
export type GatewayEndpointBase = {
  target: string;
  region: string;
};

/**
 * Result of calculating missing domain/region combinations.
 */
export type MissingCombinationsResult = {
  /** Domains that have at least one missing region */
  missingDomains: string[];
  /** Regions that have at least one missing domain */
  missingRegions: string[];
};

/**
 * Calculates which domain/region combinations are missing from existing endpoints.
 * Used to determine which gateways need to be created.
 *
 * @param selectedRegions - List of regions that should have gateways
 * @param selectedDomains - List of domains that should have gateways
 * @param endpoints - Existing gateway endpoints
 * @returns Object containing domains and regions that have missing combinations
 *
 * @example
 * missingDomainRegion(
 *   ["us-east-1", "us-west-1"],
 *   ["api.example.com"],
 *   [{ target: "api.example.com", region: "us-east-1" }]
 * )
 * // Returns: { missingDomains: ["api.example.com"], missingRegions: ["us-west-1"] }
 */
export function missingDomainRegion<T extends GatewayEndpointBase>(
  selectedRegions: string[],
  selectedDomains: string[],
  endpoints: T[],
): MissingCombinationsResult {
  // Build set of required combinations
  const requiredCombinations = new Set<string>();
  for (const domain of selectedDomains) {
    for (const region of selectedRegions) {
      requiredCombinations.add(`${domain}:${region}`);
    }
  }

  // Build set of existing combinations (only for endpoints with valid targets)
  const existingCombinations = new Set<string>();
  for (const endpoint of endpoints) {
    if (endpoint.target !== "") {
      existingCombinations.add(`${endpoint.target}:${endpoint.region}`);
    }
  }

  // Find missing combinations
  const missingDomains = new Set<string>();
  const missingRegions = new Set<string>();

  for (const required of requiredCombinations) {
    if (!existingCombinations.has(required)) {
      const [domain, region] = required.split(":");
      if (domain !== undefined && region !== undefined) {
        missingDomains.add(domain);
        missingRegions.add(region);
      }
    }
  }

  return {
    missingDomains: [...missingDomains],
    missingRegions: [...missingRegions],
  };
}
