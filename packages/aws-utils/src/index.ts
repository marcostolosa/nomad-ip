import { createHash, createHmac } from "crypto";

export type AWSCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type AWSRegion =
  | "us-east-1"
  | "us-east-2"
  | "us-west-1"
  | "us-west-2"
  | "eu-central-1"
  | "eu-west-1"
  | "eu-west-2"
  | "eu-west-3"
  | "eu-north-1"
  | "sa-east-1";

export const AWS_REGIONS: AWSRegion[] = [
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
];

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key: Buffer, data: string): string {
  return createHmac("sha256", key).update(data).digest("hex");
}

function getAmzDate(): { amzDate: string; dateStamp: string } {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  return { amzDate, dateStamp };
}

function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(Buffer.from(`AWS4${secretKey}`, "utf-8"), dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  return kSigning;
}

function getCanonicalHeaders(headers: Record<string, string>): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const sortedKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();

  const canonicalHeaders = sortedKeys
    .map((key) => {
      const originalKey = Object.keys(headers).find(
        (k) => k.toLowerCase() === key,
      );
      const value =
        originalKey !== undefined ? (headers[originalKey] ?? "") : "";
      return `${key}:${value.trim()}`;
    })
    .join("\n");

  const signedHeaders = sortedKeys.join(";");

  return { canonicalHeaders: canonicalHeaders + "\n", signedHeaders };
}

export function signRequest(params: {
  method: string;
  host: string;
  path: string;
  queryString?: string;
  headers: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: AWSCredentials;
}): { url: string; method: string; headers: Record<string, string> } {
  const {
    method,
    host,
    path,
    queryString,
    headers,
    body,
    region,
    service,
    credentials,
  } = params;

  const { amzDate, dateStamp } = getAmzDate();

  const headersWithDate: Record<string, string> = {
    ...headers,
    host,
    "x-amz-date": amzDate,
  };

  const { canonicalHeaders, signedHeaders } =
    getCanonicalHeaders(headersWithDate);

  const payloadHash = sha256(body ?? "");

  const canonicalUri = path;
  const canonicalQueryString = queryString ?? "";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const algorithm = "AWS4-HMAC-SHA256";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");

  const signingKey = getSignatureKey(
    credentials.secretAccessKey,
    dateStamp,
    region,
    service,
  );
  const signature = hmacSha256Hex(signingKey, stringToSign);

  const authorizationHeader =
    `${algorithm} ` +
    `Credential=${credentials.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  const signedHeadersOutput: Record<string, string> = {};
  for (const key of Object.keys(headersWithDate)) {
    if (key.toLowerCase() !== "host") {
      signedHeadersOutput[key] = headersWithDate[key] ?? "";
    }
  }
  signedHeadersOutput["Authorization"] = authorizationHeader;

  const url = `https://${host}${path}${queryString !== undefined && queryString !== "" ? `?${queryString}` : ""}`;

  return {
    url,
    method,
    headers: signedHeadersOutput,
  };
}

export function createApiGatewayRequest(
  credentials: AWSCredentials,
  region: string,
  method: string,
  action: string,
  body?: Record<string, unknown>,
): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  const host = `apigateway.${region}.amazonaws.com`;
  const bodyString = body !== undefined ? JSON.stringify(body) : undefined;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (bodyString !== undefined) {
    headers["Content-Length"] = String(bodyString.length);
  }

  return signRequest({
    method,
    host,
    path: action,
    headers,
    body: bodyString,
    region,
    service: "apigateway",
    credentials,
  });
}
