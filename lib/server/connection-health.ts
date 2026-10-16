import { db, putSetting } from "./db";
import { UpstreamError } from "./http";
import type { ConnectionHealth } from "../types";
export function healthKey(provider: "google" | "shop", id: string | number) {
  return `connection_health:${provider}:${id}`;
}
export async function recordHealth(
  provider: "google" | "shop",
  id: string | number,
  status: ConnectionHealth["status"],
  message: string,
  sql = db(),
) {
  const health: ConnectionHealth = {
    status,
    message,
    checkedAt: new Date().toISOString(),
  };
  await putSetting(healthKey(provider, id), JSON.stringify(health), sql);
  return health;
}
export function googleAuthFailure(
  error: unknown,
): Pick<ConnectionHealth, "status" | "message"> {
  if (error instanceof UpstreamError && error.providerCode === "invalid_grant")
    return {
      status: "reauthorization_required",
      message:
        "Google authorization has expired or been revoked. Reconnect this same Google account.",
    };
  if (
    error instanceof UpstreamError &&
    ["invalid_client", "unauthorized_client"].includes(error.providerCode || "")
  )
    return {
      status: "attention",
      message:
        "Google OAuth app settings were rejected. Check the client ID and secret in API settings.",
    };
  return {
    status: "attention",
    message:
      error instanceof Error
        ? error.message
        : "Google access could not be checked. Try refreshing again.",
  };
}
export function shopAuthFailure(
  error: unknown,
): Pick<ConnectionHealth, "status" | "message"> {
  if (
    error instanceof UpstreamError &&
    (error.status === 401 ||
      ["invalid_client", "invalid_grant"].includes(error.providerCode || ""))
  )
    return {
      status: "reauthorization_required",
      message:
        "Shopify authorization is invalid or expired. Open this store and update its credentials or reinstall/reauthorize the app.",
    };
  return {
    status: "attention",
    message:
      error instanceof Error
        ? error.message
        : "Shopify access could not be checked. Try refreshing again.",
  };
}
