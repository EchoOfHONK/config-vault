export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(
      typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && "message" in detail
          ? String(detail.message)
          : JSON.stringify(detail),
    );
    this.status = status;
    this.detail = detail;
  }
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    const token =
      csrf ||
      document.cookie
        .split("; ")
        .find((v) => v.startsWith("cv_csrf="))
        ?.split("=")
        .slice(1)
        .join("=") ||
      "";
    headers.set("X-CSRF-Token", decodeURIComponent(token));
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/login"))
      window.dispatchEvent(new Event("vault:unauthorized"));
    const result = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, result.detail ?? result);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const post = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const remove = (path: string) => api(path, { method: "DELETE" });
export interface User {
  id: number;
  username: string;
  role: string;
  device_ids?: number[];
  project_ids?: number[];
  service_ids?: number[];
}
export interface Device {
  id: number;
  name: string;
  type: string;
  host: string;
  os: string;
  connection: string;
  connection_data: Record<string, any>;
  status: string;
  last_sync: string | null;
  config_count: number;
  has_credential?: boolean;
}
export interface Config {
  id: number;
  name: string;
  path: string;
  device_id: number;
  device_name: string;
  service_id: number | null;
  project_id: number | null;
  format: string;
  tags: string[];
  policy: string;
  version: number;
  updated_at: string;
  has_secrets: boolean;
  conflict?: boolean;
  remote_hash: string | null;
  content?: string;
}
export interface Group {
  id: number;
  name: string;
  description: string;
  device_id?: number | null;
}
export interface Template extends Group {
  format: string;
  content: string;
}
export interface Version {
  number: number;
  actor: string;
  message: string;
  created_at: string;
  content?: string;
}
export interface Activity {
  id: number;
  actor: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
}
export interface Snapshot {
  id: number;
  name: string;
  description: string;
  created_at: string;
  device_id: number | null;
  file_count?: number;
  files?: { config_id: number; name: string; path: string; version: number }[];
}
export interface Backup {
  id: number;
  name: string;
  created_at: string;
  size: number;
  status: string;
  available?: boolean;
}
export interface Token {
  id: number;
  name: string;
  scopes: string[];
  device_ids: number[];
  created_at: string;
  expires_at: string | null;
  token?: string;
}
export interface Dashboard {
  devices: number;
  configurations: number;
  changes_today: number;
  snapshots: number;
  last_backup: string | null;
  recent_changes: Activity[];
  alerts: { level: string; message: string }[];
  device_health: Device[];
}
export function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
export function date(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
  ).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export function relative(value: string | null | undefined) {
  if (!value) return "Never";
  const timestamp = new Date(
    value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`,
  ).getTime();
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}
export function bytes(value: number) {
  return value < 1024
    ? `${value} B`
    : value < 1048576
      ? `${(value / 1024).toFixed(1)} KB`
      : `${(value / 1048576).toFixed(1)} MB`;
}
export function detectFormat(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".env") || lower.startsWith(".env")) return "env";
  if (lower.includes("nginx")) return "nginx";
  if (lower.includes("dockerfile")) return "dockerfile";
  if (lower.endsWith(".yml") || lower.endsWith(".yaml")) return "yaml";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".js")) return "javascript";
  if (lower.endsWith(".xml")) return "xml";
  if (lower.endsWith(".lua")) return "lua";
  if (lower.endsWith(".sh")) return "shell";
  if (/\.(service|timer|socket)$/.test(lower)) return "systemd";
  if (lower.includes("wg") || lower.includes("wireguard")) return "wireguard";
  if (lower.endsWith(".properties")) return "properties";
  if (lower.endsWith(".ini")) return "ini";
  return "text";
}
export const policies = [
  { value: "manual", label: "Manual" },
  { value: "pull_only", label: "Pull only" },
  { value: "push_pull", label: "Push / pull" },
  { value: "watch", label: "Watch" },
  { value: "backup_only", label: "Backup only" },
];
export const formats = [
  "text",
  "nginx",
  "yaml",
  "json",
  "toml",
  "env",
  "ini",
  "properties",
  "wireguard",
  "systemd",
  "dockerfile",
  "shell",
  "python",
  "javascript",
  "typescript",
  "xml",
  "lua",
];
