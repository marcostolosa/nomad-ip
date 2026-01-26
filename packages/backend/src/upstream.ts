import { type SDK } from "caido:plugin";
import {
  type Connection,
  type RequestSpec,
  type RequestSpecRaw,
} from "caido:utils";

import { getConfig, getNextEndpointForDomain, hasEndpoints } from "./config";
import { LOG_PREFIX } from "./constants";

/**
 * Handles upstream request interception and routing through AWS API Gateway.
 * Routes requests for configured domains through the appropriate gateway endpoint.
 *
 * @returns Modified request and connection for gateway routing, or undefined for passthrough
 */
async function handleRequest(
  sdk: SDK,
  request: RequestSpecRaw,
): Promise<{ request?: RequestSpec; connection?: Connection } | undefined> {
  const targetDomain = request.getHost();

  sdk.console.log(`${LOG_PREFIX} ${targetDomain} -> Start handle request`);

  // Fast path: no endpoints configured
  if (!hasEndpoints()) {
    sdk.console.error(
      `${LOG_PREFIX} ${targetDomain} -> No endpoint configured`,
    );
    return undefined;
  }

  const config = getConfig();
  if (config === undefined) {
    sdk.console.error(`${LOG_PREFIX} ${targetDomain} -> Config is undefined`);
    return undefined;
  }

  // Get next endpoint for this domain (round-robin selection)
  const endpoint = getNextEndpointForDomain(targetDomain);
  if (endpoint === undefined) {
    sdk.console.error(
      `${LOG_PREFIX} ${targetDomain} -> Could not get next endpoint for domain ${targetDomain}`,
    );
    return undefined;
  }

  // Get the original request spec and modify it
  const spec = request.toSpec();
  const originalHost = targetDomain;

  // Update the path to include the stage name
  const originalPath = spec.getPath();
  const gatewayPath = `/${endpoint.stageName}${originalPath}`;
  spec.setPath(gatewayPath);

  // Set connection details for the gateway
  spec.setHost(endpoint.hostname);
  spec.setPort(endpoint.port);
  spec.setTls(true);

  // Update headers for gateway routing
  spec.setHeader("Host", endpoint.hostname);
  spec.setHeader("X-Forwarded-Host", originalHost);

  // Create connection to the gateway
  const gatewayUrl = `https://${endpoint.hostname}`;
  const connection = await sdk.net.connect(gatewayUrl);

  sdk.console.log(
    `${LOG_PREFIX} ${targetDomain} -> ${endpoint.hostname} (${endpoint.region})`,
  );

  return { request: spec, connection };
}

export { handleRequest };
