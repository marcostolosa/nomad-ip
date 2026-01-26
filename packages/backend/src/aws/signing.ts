import { type BinaryLike, createHash, createHmac } from "crypto";

import type { AWSCredentials } from "../types";

type SignedRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

type SigningParams = {
  method: string;
  host: string;
  path: string;
  queryString?: string;
  headers: Record<string, string>;
  body?: string;
  region: string;
  service: string;
  credentials: AWSCredentials;
};

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: BinaryLike, data: string): BinaryLike {
  return createHmac("sha256", key).update(data).digest();
}

function hmacSha256Hex(key: BinaryLike, data: string): string {
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
): BinaryLike {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp);
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
      const value = originalKey !== undefined ? headers[originalKey] : "";
      return `${key}:${(value ?? "").trim()}`;
    })
    .join("\n");

  const signedHeaders = sortedKeys.join(";");

  return { canonicalHeaders: canonicalHeaders + "\n", signedHeaders };
}

function signRequest(params: SigningParams): SignedRequest {
  const {
    method,
    host,
    path,
    queryString,
    body,
    region,
    service,
    credentials,
  } = params;

  const { amzDate, dateStamp } = getAmzDate();

  const headers: Record<string, string> = {
    ...params.headers,
    host,
    "x-amz-date": amzDate,
  };

  const { canonicalHeaders, signedHeaders } = getCanonicalHeaders(headers);

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

  const signedHeaders2: Record<string, string> = {};
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() !== "host") {
      signedHeaders2[key] = headers[key] ?? "";
    }
  }
  signedHeaders2["Authorization"] = authorizationHeader;

  const url = `https://${host}${path}${queryString !== undefined && queryString !== "" ? `?${queryString}` : ""}`;

  return {
    url,
    method,
    headers: signedHeaders2,
    body,
  };
}

export function createApiGatewayRequest(
  credentials: AWSCredentials,
  region: string,
  method: string,
  action: string,
  body?: Record<string, unknown>,
): SignedRequest {
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
