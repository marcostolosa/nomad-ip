export type Result<T> =
  | { kind: "Ok"; value: T }
  | { kind: "Error"; error: string };

export type AWSCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type GatewayConfig = {
  regions: string[];
  scopeId: string;
  scopeName: string;
  domains: string[];
};

export type GatewayEndpoint = {
  region: string;
  apiId: string;
  hostname: string;
  port: number;
  stageName: string;
  target: string;
};

export type DomainGatewayMap = Map<string, GatewayEndpoint[]>;

export type PluginState = {
  credentials: AWSCredentials | undefined;
  config: GatewayConfig | undefined;
  endpoints: GatewayEndpoint[];
  domainGatewayMap: DomainGatewayMap;
  currentIndexPerDomain: Map<string, number>;
  requestCount: number;
};

export const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "sa-east-1",
] as const;

export type AWSRegion = (typeof AWS_REGIONS)[number];
