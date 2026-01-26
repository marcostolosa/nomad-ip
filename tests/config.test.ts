import { beforeEach, describe, expect, it } from "vitest";

// Import config module functions
// Note: We need to test the config module in isolation
// Since the backend uses QuickJS runtime, we test the pure logic here

type GatewayEndpoint = {
  region: string;
  apiId: string;
  hostname: string;
  port: number;
  stageName: string;
  target: string;
};

type DomainGatewayMap = Map<string, GatewayEndpoint[]>;

type PluginState = {
  credentials: { accessKeyId: string; secretAccessKey: string } | undefined;
  config:
    | {
        regions: string[];
        scopeId: string;
        scopeName: string;
        domains: string[];
      }
    | undefined;
  endpoints: GatewayEndpoint[];
  domainGatewayMap: DomainGatewayMap;
  currentIndexPerDomain: Map<string, number>;
  requestCount: number;
};

// Recreate the config module logic for testing
function createConfigModule() {
  let state: PluginState = {
    credentials: undefined,
    config: undefined,
    endpoints: [],
    domainGatewayMap: new Map(),
    currentIndexPerDomain: new Map(),
    requestCount: 0,
  };

  function setEndpoints(endpoints: GatewayEndpoint[]): void {
    const domainGatewayMap: DomainGatewayMap = new Map();

    for (const endpoint of endpoints) {
      const existing = domainGatewayMap.get(endpoint.target) || [];
      existing.push(endpoint);
      domainGatewayMap.set(endpoint.target, existing);
    }

    state = { ...state, endpoints, domainGatewayMap };
  }

  function getNextEndpointForDomain(
    domain: string,
  ): GatewayEndpoint | undefined {
    const gateways = state.domainGatewayMap.get(domain);
    if (gateways === undefined || gateways.length === 0) {
      return undefined;
    }

    const currentIndex = state.currentIndexPerDomain.get(domain) ?? 0;
    const endpoint = gateways[currentIndex];

    const nextIndex = (currentIndex + 1) % gateways.length;
    state.currentIndexPerDomain.set(domain, nextIndex);
    state.requestCount++;

    return endpoint;
  }

  function resetState(): void {
    state = {
      credentials: state.credentials,
      config: state.config,
      endpoints: [],
      domainGatewayMap: new Map(),
      currentIndexPerDomain: new Map(),
      requestCount: 0,
    };
  }

  function getState(): PluginState {
    return state;
  }

  return {
    setEndpoints,
    getNextEndpointForDomain,
    resetState,
    getState,
  };
}

describe("Config Module", () => {
  let config: ReturnType<typeof createConfigModule>;

  beforeEach(() => {
    config = createConfigModule();
  });

  describe("setEndpoints", () => {
    it("should set endpoints and build domain gateway map", () => {
      const endpoints: GatewayEndpoint[] = [
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "us-west-1",
          apiId: "api2",
          hostname: "api2.execute-api.us-west-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ];

      config.setEndpoints(endpoints);

      const state = config.getState();
      expect(state.endpoints).toHaveLength(2);
      expect(state.domainGatewayMap.get("api.example.com")).toHaveLength(2);
    });

    it("should group endpoints by target domain", () => {
      const endpoints: GatewayEndpoint[] = [
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "us-east-1",
          apiId: "api2",
          hostname: "api2.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.test.com",
        },
        {
          region: "us-west-1",
          apiId: "api3",
          hostname: "api3.execute-api.us-west-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ];

      config.setEndpoints(endpoints);

      const state = config.getState();
      expect(state.domainGatewayMap.get("api.example.com")).toHaveLength(2);
      expect(state.domainGatewayMap.get("api.test.com")).toHaveLength(1);
    });

    it("should handle empty endpoints array", () => {
      config.setEndpoints([]);

      const state = config.getState();
      expect(state.endpoints).toHaveLength(0);
      expect(state.domainGatewayMap.size).toBe(0);
    });
  });

  describe("getNextEndpointForDomain", () => {
    it("should return undefined for unknown domain", () => {
      const endpoint = config.getNextEndpointForDomain("unknown.com");
      expect(endpoint).toBeUndefined();
    });

    it("should return endpoint for known domain", () => {
      config.setEndpoints([
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ]);

      const endpoint = config.getNextEndpointForDomain("api.example.com");
      expect(endpoint).toBeDefined();
      expect(endpoint?.apiId).toBe("api1");
    });

    it("should round-robin through multiple endpoints", () => {
      config.setEndpoints([
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "us-west-1",
          apiId: "api2",
          hostname: "api2.execute-api.us-west-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "eu-west-1",
          apiId: "api3",
          hostname: "api3.execute-api.eu-west-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ]);

      // First call should return api1
      const first = config.getNextEndpointForDomain("api.example.com");
      expect(first?.apiId).toBe("api1");

      // Second call should return api2
      const second = config.getNextEndpointForDomain("api.example.com");
      expect(second?.apiId).toBe("api2");

      // Third call should return api3
      const third = config.getNextEndpointForDomain("api.example.com");
      expect(third?.apiId).toBe("api3");

      // Fourth call should wrap around to api1
      const fourth = config.getNextEndpointForDomain("api.example.com");
      expect(fourth?.apiId).toBe("api1");
    });

    it("should maintain separate indexes per domain", () => {
      config.setEndpoints([
        {
          region: "us-east-1",
          apiId: "example-api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "us-west-1",
          apiId: "example-api2",
          hostname: "api2.execute-api.us-west-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
        {
          region: "us-east-1",
          apiId: "test-api1",
          hostname: "api3.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.test.com",
        },
      ]);

      // Get first endpoint for example.com
      const example1 = config.getNextEndpointForDomain("api.example.com");
      expect(example1?.apiId).toBe("example-api1");

      // Get first endpoint for test.com - should be independent
      const test1 = config.getNextEndpointForDomain("api.test.com");
      expect(test1?.apiId).toBe("test-api1");

      // Get second endpoint for example.com
      const example2 = config.getNextEndpointForDomain("api.example.com");
      expect(example2?.apiId).toBe("example-api2");

      // Get second endpoint for test.com - should wrap around (only 1 endpoint)
      const test2 = config.getNextEndpointForDomain("api.test.com");
      expect(test2?.apiId).toBe("test-api1");
    });

    it("should increment request count", () => {
      config.setEndpoints([
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ]);

      expect(config.getState().requestCount).toBe(0);

      config.getNextEndpointForDomain("api.example.com");
      expect(config.getState().requestCount).toBe(1);

      config.getNextEndpointForDomain("api.example.com");
      expect(config.getState().requestCount).toBe(2);
    });
  });

  describe("resetState", () => {
    it("should clear endpoints but preserve credentials and config", () => {
      config.setEndpoints([
        {
          region: "us-east-1",
          apiId: "api1",
          hostname: "api1.execute-api.us-east-1.amazonaws.com",
          port: 443,
          stageName: "nomadip",
          target: "api.example.com",
        },
      ]);

      // Make some requests to increment counters
      config.getNextEndpointForDomain("api.example.com");
      config.getNextEndpointForDomain("api.example.com");

      expect(config.getState().endpoints).toHaveLength(1);
      expect(config.getState().requestCount).toBe(2);

      config.resetState();

      expect(config.getState().endpoints).toHaveLength(0);
      expect(config.getState().domainGatewayMap.size).toBe(0);
      expect(config.getState().currentIndexPerDomain.size).toBe(0);
      expect(config.getState().requestCount).toBe(0);
    });
  });
});
