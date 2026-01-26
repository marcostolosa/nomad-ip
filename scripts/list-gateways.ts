#!/usr/bin/env node

import { readFileSync } from "fs";
import { join } from "path";

import {
  AWS_REGIONS,
  createApiGatewayRequest,
} from "../packages/aws-utils/src/index";

const STAGE_NAME = "nomadip";
const GATEWAY_NAME_PREFIX = "nomad-ip-";

// Load .env file if it exists
const dotenvPath = join(process.cwd(), ".env");
try {
  const dotenvContent = readFileSync(dotenvPath, "utf-8");
  for (const line of dotenvContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
} catch {
  // .env file doesn't exist, continue anyway
}

// Console logger implementation (not used in this version)

// Node.js fetch is available in modern Node versions
const fetch = globalThis.fetch;

interface AWSCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

interface GatewayEndpoint {
  region: string;
  apiId: string;
  hostname: string;
  port: number;
  stageName: string;
  target: string;
}

interface ApiGatewayResponse {
  id?: string;
  items?: any[];
  item?: any[];
  _embedded?: { item?: any[] };
  tags?: Record<string, string>;
}

async function apiGatewayRequest(
  credentials: AWSCredentials,
  region: string,
  method: string,
  path: string,
  body: Record<string, unknown> | undefined,
): Promise<ApiGatewayResponse> {
  const signed = createApiGatewayRequest(
    credentials,
    region,
    method,
    path,
    body,
  );

  const response = await fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body: signed.body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `API Gateway request failed (${response.status}): ${errorText}`,
    );
  }

  const responseText = await response.text();
  if (responseText.trim() === "") {
    return {};
  }

  return JSON.parse(responseText);
}

async function getGatewayDetails(
  credentials: AWSCredentials,
  region: string,
  apiId: string,
): Promise<GatewayEndpoint> {
  const response = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    `/restapis/${apiId}`,
    undefined,
  );

  const target = response.tags?.["nomad-ip-target"] ?? "";

  return {
    region,
    apiId,
    hostname: `${apiId}.execute-api.${region}.amazonaws.com`,
    port: 443,
    stageName: STAGE_NAME,
    target,
  };
}

async function listGateways(
  credentials: AWSCredentials,
  region: string,
): Promise<GatewayEndpoint[]> {
  const response = await apiGatewayRequest(
    credentials,
    region,
    "GET",
    "/restapis",
    undefined,
  );

  let items: any[] = [];

  if (Array.isArray(response.items)) {
    items = response.items;
  } else if (Array.isArray(response.item)) {
    items = response.item;
  } else if (
    response._embedded !== undefined &&
    Array.isArray(response._embedded.item)
  ) {
    items = response._embedded.item;
  }

  // Filter to only nomad-ip gateways
  const nomadIpItems = items.filter(
    (item) =>
      item.id !== undefined &&
      item.name !== undefined &&
      item.name.startsWith(GATEWAY_NAME_PREFIX),
  );

  // Fetch details (including tags) for each gateway
  const endpoints: GatewayEndpoint[] = [];

  for (const item of nomadIpItems) {
    if (item.id === undefined) continue;

    const details = await getGatewayDetails(credentials, region, item.id);

    endpoints.push(details);
  }

  return endpoints;
}

async function listAllGateways(
  credentials: AWSCredentials,
  regions: string[],
): Promise<GatewayEndpoint[]> {
  const endpoints: GatewayEndpoint[] = [];
  const errors: string[] = [];

  for (const region of regions) {
    try {
      const regionEndpoints = await listGateways(credentials, region);
      endpoints.push(...regionEndpoints);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Region ${region}: ${message}`);
    }
  }

  if (endpoints.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }

  return endpoints;
}

function loadCredentials(): AWSCredentials {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (accessKeyId && secretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }

  const credentialsPath = join(process.cwd(), "credentials.json");
  try {
    const content = readFileSync(credentialsPath, "utf-8");
    const data = JSON.parse(content);
    if (data.accessKeyId && data.secretAccessKey) {
      return {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
      };
    }
  } catch {
    // Ignore - file doesn't exist or is invalid
  }

  throw new Error(
    "AWS credentials not found. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables or create a credentials.json file.",
  );
}

async function main() {
  console.log("Nomad IP - AWS Gateway Inspector");
  console.log("================================\n");

  const credentials = loadCredentials();
  console.log(
    `Using credentials: ${credentials.accessKeyId.slice(0, 4)}****${credentials.accessKeyId.slice(-4)}\n`,
  );

  const regionsArg = process.argv[2];

  // Handle help
  if (regionsArg === "--help" || regionsArg === "-h") {
    console.log("Usage: node scripts/list-gateways.ts [regions]");
    console.log("");
    console.log("Arguments:");
    console.log("  regions      Comma-separated list of AWS regions to check");
    console.log("              If not provided, all regions will be checked");
    console.log("");
    console.log("Examples:");
    console.log("  node scripts/list-gateways.ts");
    console.log("  node scripts/list-gateways.ts us-east-1,us-west-2");
    console.log("");
    console.log("Environment:");
    console.log("  AWS_ACCESS_KEY_ID     AWS Access Key ID");
    console.log("  AWS_SECRET_ACCESS_KEY AWS Secret Access Key");
    console.log("");
    console.log("Alternatively, create a credentials.json file with:");
    console.log("  {");
    console.log('    "accessKeyId": "your-access-key-id",');
    console.log('    "secretAccessKey": "your-secret-access-key"');
    console.log("  }");
    process.exit(0);
  }

  const regions = regionsArg
    ? regionsArg.split(",").map((r) => r.trim())
    : [...AWS_REGIONS];

  console.log(`Checking regions: ${regions.join(", ")}\n`);

  try {
    const allEndpoints = await listAllGateways(credentials, regions);
    const totalGateways = allEndpoints.length;

    // Group endpoints by region for display
    const endpointsByRegion: Record<string, GatewayEndpoint[]> = {};
    for (const endpoint of allEndpoints) {
      const region = endpoint.region || "unknown";
      if (!endpointsByRegion[region]) {
        endpointsByRegion[region] = [];
      }
      endpointsByRegion[region].push(endpoint);
    }

    // Display endpoints by region
    for (const [region, endpoints] of Object.entries(endpointsByRegion)) {
      if (endpoints.length > 0) {
        console.log(`\n[${region}] Found ${endpoints.length} gateway(s):`);
        console.log("-".repeat(80));

        for (const endpoint of endpoints) {
          console.log(`  API ID:      ${endpoint.apiId}`);
          console.log(`  Hostname:    ${endpoint.hostname}`);
          console.log(`  Target:      ${endpoint.target || "(not set)"}`);
          console.log(`  Stage:       ${endpoint.stageName}`);
          console.log("");
        }
      }
    }

    console.log("\n" + "=".repeat(80));
    console.log(`Summary: ${totalGateways} total gateways found\n`);

    if (allEndpoints.length > 0) {
      console.log("Metadata Recovery Analysis:");
      console.log("-".repeat(80));

      const withTarget = allEndpoints.filter(
        (e) => e.target && e.target !== "",
      );
      const withoutTarget = allEndpoints.filter(
        (e) => !e.target || e.target === "",
      );

      console.log(`  Gateways with target metadata: ${withTarget.length}`);
      console.log(
        `  Gateways missing target metadata: ${withoutTarget.length}`,
      );

      if (withTarget.length > 0) {
        const targets = [...new Set(withTarget.map((e) => e.target))];
        console.log(`\n  Recovered targets: ${targets.join(", ")}`);
      }

      console.log("\n  Target distribution:");
      const targetCounts: Record<string, number> = {};
      for (const endpoint of allEndpoints) {
        const t = endpoint.target || "(none)";
        targetCounts[t] = (targetCounts[t] || 0) + 1;
      }
      for (const [target, count] of Object.entries(targetCounts)) {
        console.log(`    ${target}: ${count} gateway(s)`);
      }
    } else {
      console.log("  No Nomad IP gateways found in any region.");
      console.log(
        "  Make sure gateways were created with the 'nomad-ip-' prefix.",
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Error: ${message}`);
  }
}

main().catch(console.error);
