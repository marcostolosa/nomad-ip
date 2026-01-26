import type { Database } from "sqlite";

import type { AWSCredentials, GatewayConfig } from "./types";

let db: Database | undefined;

export async function initStorage(database: Database): Promise<void> {
  db = database;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function getSetting(key: string): Promise<string | undefined> {
  if (db === undefined) {
    return undefined;
  }

  const stmt = await db.prepare("SELECT value FROM settings WHERE key = ?");
  const row = await stmt.get<{ value: string }>(key);
  return row?.value;
}

async function setSetting(key: string, value: string): Promise<void> {
  if (db === undefined) {
    return;
  }

  const stmt = await db.prepare(
    "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
  );
  await stmt.run(key, value);
}

export async function loadStoredCredentials(): Promise<
  AWSCredentials | undefined
> {
  const accessKeyId = await getSetting("aws_access_key_id");
  const secretAccessKey = await getSetting("aws_secret_access_key");

  if (accessKeyId !== undefined && secretAccessKey !== undefined) {
    return { accessKeyId, secretAccessKey };
  }

  return undefined;
}

export async function saveStoredCredentials(
  credentials: AWSCredentials,
): Promise<void> {
  await setSetting("aws_access_key_id", credentials.accessKeyId);
  await setSetting("aws_secret_access_key", credentials.secretAccessKey);
}

export async function loadStoredConfig(): Promise<GatewayConfig | undefined> {
  const configJson = await getSetting("gateway_config");

  if (configJson === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(configJson) as GatewayConfig;
  } catch {
    return undefined;
  }
}

export async function saveStoredConfig(config: GatewayConfig): Promise<void> {
  await setSetting("gateway_config", JSON.stringify(config));
}

// Registered configuration - the config that was last successfully registered
export type RegisteredConfig = {
  regions: string[];
  domains: string[];
};

export async function loadRegisteredConfig(): Promise<
  RegisteredConfig | undefined
> {
  const configJson = await getSetting("registered_config");

  if (configJson === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(configJson) as RegisteredConfig;
  } catch {
    return undefined;
  }
}

export async function saveRegisteredConfig(
  config: RegisteredConfig,
): Promise<void> {
  await setSetting("registered_config", JSON.stringify(config));
}

export async function clearRegisteredConfig(): Promise<void> {
  if (db === undefined) {
    return;
  }

  const stmt = await db.prepare("DELETE FROM settings WHERE key = ?");
  await stmt.run("registered_config");
}
