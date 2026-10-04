import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileCode2,
  Folder,
  FolderOpen,
  KeyRound,
  Laptop,
  Plus,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import {
  api,
  post,
  patch,
  put,
  remove,
  type Device,
  type Config,
  type Group,
  type Snapshot,
  type Activity,
  date,
  relative,
  bytes,
  policies,
} from "./api";
import {
  AsyncForm,
  Button,
  Confirm,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  Notice,
  PageHead,
  Status,
  Tabs,
  Tag,
  useLoad,
} from "./components";
import { ActivityList, useVault } from "./App";
const types = [
  "Server",
  "PC",
  "Laptop",
  "NAS",
  "Router",
  "VPS",
  "VM",
  "Container Host",
  "Console",
  "Other",
];
export function DeviceForm({
  device,
  onClose,
  onDone,
}: {
  device?: Device;
  onClose: () => void;
  onDone: (device: Device) => void;
}) {
  const [name, setName] = useState(device?.name || ""),
    [type, setType] = useState(device?.type || "Server"),
    [host, setHost] = useState(device?.host || ""),
    [os, setOs] = useState(device?.os || ""),
    [connection, setConnection] = useState(device?.connection || "manual"),
    [port, setPort] = useState(device?.connection_data.port || 22),
    [username, setUsername] = useState(device?.connection_data.username || ""),
    [roots, setRoots] = useState(
      (device?.connection_data.roots || []).join("\n"),
    );
  return (
    <Modal
      title={device ? "Edit device" : "Add a device"}
      description="A home for the configurations that belong together."
      onClose={onClose}
    >
      <AsyncForm
        cancel={onClose}
        submit={device ? "Save device" : "Add device"}
        onSubmit={async () => {
          const body = {
            name,
            type,
            host,
            os,
            connection,
            connection_data: {
              ...device?.connection_data,
              host,
              port: Number(port),
              username,
              roots: roots
                .split("\n")
                .map((v: string) => v.trim())
                .filter(Boolean),
            },
          };
          onDone(
            device
              ? await patch(`/devices/${device.id}`, body)
              : await post("/devices", body),
          );
        }}
      >
        <div className="form-grid">
          <Field label="Device name" required>
            <input
              placeholder="Debian Home Server"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {types.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
          <Field label="Hostname / IP">
            <input
              placeholder="192.168.1.10"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
          </Field>
          <Field label="Operating system">
            <input
              placeholder="Debian 13"
              value={os}
              onChange={(e) => setOs(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Connection">
          <select
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            <option value="manual">Manual only</option>
            <option value="local">Local filesystem</option>
            <option value="ssh">SSH</option>
          </select>
        </Field>
        {connection === "ssh" && (
          <div className="form-grid">
            <Field label="SSH port" required>
              <input
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </Field>
            <Field label="SSH username" required>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </Field>
          </div>
        )}
        {connection !== "manual" && (
          <Field
            label="Allowed configuration roots"
            required
            hint="One absolute directory per line. Imports and syncs stay inside these paths."
          >
            <textarea
              value={roots}
              onChange={(e) => setRoots(e.target.value)}
              rows={4}
              required
              placeholder="/etc/nginx/&#10;/srv/apps/"
            />
          </Field>
        )}
        {connection === "ssh" && (
          <Notice>
            After adding this device, pin its host key and store an encrypted
            SSH credential in Connection.
          </Notice>
        )}
        {connection === "local" && (
          <Notice>
            Local paths refer to the Config Vault container. Mount your source
            directories read-only for pull and watch policies.
          </Notice>
        )}
      </AsyncForm>
    </Modal>
  );
}
export function Devices() {
  const { refresh, changed, notify, user } = useVault();
  const navigateSearch = useSearchParams();
  const [searchParams, setSearchParams] = navigateSearch;
  const [adding, setAdding] = useState(searchParams.get("add") === "true"),
    [filter, setFilter] = useState("");
  const { data, error, loading, reload } = useLoad(
    () => api<Device[]>("/devices"),
    [refresh],
  );
  const filtered = (data || []).filter((device) =>
    `${device.name} ${device.host} ${device.os} ${device.type}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHead
        eyebrow="EVERY SYSTEM, ONE VIEW"
        title="Devices"
        description="Your servers, desktops and logical targets. Their configurations, together."
        actions={
          user.role === "admin" && (
            <Button
              primary
              icon={<Plus size={16} />}
              onClick={() => setAdding(true)}
            >
              Add device
            </Button>
          )
        }
      />
      <div className="toolbar">
        <div className="filter-search">
          <Search size={16} />
          <input
            aria-label="Filter devices"
            placeholder="Find a device by name, address or OS…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <span className="muted">{data?.length || 0} devices</span>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : filtered.length ? (
        <div className="devices-grid">
          {filtered.map((device) => (
            <Link
              className="device-card"
              to={`/devices/${device.id}`}
              key={device.id}
            >
              <div className="device-card-top">
                <span
                  className={`device-symbol ${device.connection === "ssh" ? "orange" : ""}`}
                >
                  {["Laptop", "PC"].includes(device.type) ? (
                    <Laptop size={23} />
                  ) : (
                    <Server size={23} />
                  )}
                </span>
                <Status value={device.status} />
                <ArrowUpRight size={17} />
              </div>
              <h2>{device.name}</h2>
              <p>{device.host || "Manual configuration target"}</p>
              <div className="device-card-tags">
                <Tag>{device.type}</Tag>
                {device.os && <Tag>{device.os}</Tag>}
              </div>
              <div className="device-card-bottom">
                <span>
                  <FileCode2 size={14} />
                  <b>{device.config_count}</b> configs
                </span>
                <span>
                  <RefreshCw size={13} />
                  {relative(device.last_sync)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <Empty
          icon="device"
          title={filter ? "No devices found" : "Add your first device"}
          description={
            filter
              ? "Try another name or address."
              : "Start with a server, a laptop, or a logical target. Import its configurations when you are ready."
          }
          action={
            !filter &&
            user.role === "admin" && (
              <Button
                primary
                icon={<Plus size={16} />}
                onClick={() => setAdding(true)}
              >
                Add device
              </Button>
            )
          }
        />
      )}
      {adding && (
        <DeviceForm
          onClose={() => {
            setAdding(false);
            setSearchParams({});
          }}
          onDone={() => {
            setAdding(false);
            setSearchParams({});
            changed();
            notify(
              "Device added. Configure its connection when you are ready.",
            );
          }}
        />
      )}
    </>
  );
}
export function DeviceDetail() {
  const { id } = useParams(),
    { refresh, changed, notify, user } = useVault();
  const [tab, setTab] = useState("overview"),
    [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [importing, setImporting] = useState(false),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<unknown>();
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        api<Device>(`/devices/${id}`),
        api<Config[]>(`/configs?device_id=${id}`),
        api<Group[]>("/services"),
        api<Snapshot[]>("/snapshots"),
        api<Activity[]>("/activity"),
      ]).then(([device, configs, services, snapshots, activity]) => ({
        device,
        configs,
        services: services.filter((s) => s.device_id === device.id),
        snapshots: snapshots.filter((s) => s.device_id === device.id),
        activity: activity.filter((a) => a.target?.includes(device.name)),
      })),
    [id, refresh],
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return null;
  const { device, configs, services, snapshots, activity } = data;
  const sync = async () => {
    setBusy(true);
    setActionError(undefined);
    try {
      const result = await post(`/devices/${id}/sync`, {});
      changed();
      const changeCount = Array.isArray(result.changes)
        ? result.changes.length
        : (result.updated ?? result.changes ?? 0);
      const conflictCount = Array.isArray(result.conflicts)
        ? result.conflicts.length
        : (result.conflicts ?? 0);
      notify(
        result.message ||
          `Sync complete: ${changeCount} changes, ${conflictCount} conflicts.`,
      );
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Link to="/devices" className="back-link">
        <ArrowLeft size={14} />
        All devices
      </Link>
      <PageHead
        eyebrow={`${device.type.toUpperCase()} · ${device.connection.toUpperCase()}`}
        title={device.name}
        description={
          device.host
            ? `${device.host}${device.os ? ` · ${device.os}` : ""}`
            : device.os || "A configuration target in your vault."
        }
        actions={
          <>
            {device.connection !== "manual" && user.role !== "viewer" && (
              <Button icon={<RefreshCw size={16} />} busy={busy} onClick={sync}>
                Sync now
              </Button>
            )}
            {user.role === "admin" && (
              <Button
                icon={<Settings2 size={16} />}
                onClick={() => setEditing(true)}
              >
                Edit device
              </Button>
            )}
          </>
        }
      />
      <ErrorNotice error={actionError} />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "overview", label: "Overview" },
          { value: "configs", label: "Configs", count: configs.length },
          { value: "services", label: "Services", count: services.length },
          { value: "snapshots", label: "Snapshots", count: snapshots.length },
          { value: "connection", label: "Connection" },
          { value: "activity", label: "Activity" },
        ]}
      />
      {tab === "overview" ? (
        <>
          <div className="device-summary">
            <div className="panel summary-item">
              <span>Status</span>
              <Status value={device.status} />
            </div>
            <div className="panel summary-item">
              <span>Configurations</span>
              <strong>{configs.length}</strong>
            </div>
            <div className="panel summary-item">
              <span>Last sync</span>
              <strong>{relative(device.last_sync)}</strong>
              <small>{date(device.last_sync)}</small>
            </div>
            <div className="panel summary-item">
              <span>Connection</span>
              <strong>
                {device.connection === "ssh"
                  ? "SSH"
                  : device.connection === "local"
                    ? "Local filesystem"
                    : "Manual only"}
              </strong>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head">
              <div>
                <h2>Configuration files</h2>
                <p>Current files and their latest saved versions.</p>
              </div>
              <div className="head-actions">
                {device.connection !== "manual" && user.role !== "viewer" && (
                  <Button
                    icon={<FolderOpen size={16} />}
                    onClick={() => setImporting(true)}
                  >
                    Browse & import
                  </Button>
                )}
                <Link to={`/import?device=${id}`} className="button">
                  <Upload size={15} />
                  Import
                </Link>
              </div>
            </div>
            <DeviceConfigList configs={configs} />
          </div>
          <section className="panel section-space">
            <div className="panel-head">
              <h2>Recent device activity</h2>
            </div>
            <ActivityList entries={activity.slice(0, 5)} />
          </section>
        </>
      ) : tab === "configs" ? (
        <div className="panel">
          <div className="panel-head">
            <h2>{configs.length} configuration files</h2>
            <Link to={`/import?device=${id}`} className="button primary">
              <Plus size={15} />
              Import configuration
            </Link>
          </div>
          <DeviceConfigList configs={configs} />
        </div>
      ) : tab === "services" ? (
        <div className="panel">
          {services.length ? (
            <div className="simple-list">
              {services.map((s) => (
                <Link to="/services" key={s.id}>
                  <span className="device-symbol">
                    <Server size={18} />
                  </span>
                  <div>
                    <strong>{s.name}</strong>
                    <small>
                      {s.description ||
                        `${configs.filter((c) => c.service_id === s.id).length} configurations`}
                    </small>
                  </div>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No services assigned"
              description="Create a service and assign it to this device to group related configuration files."
              action={
                <Link className="button" to="/services">
                  <Plus size={15} />
                  Manage services
                </Link>
              }
            />
          )}
        </div>
      ) : tab === "snapshots" ? (
        <div className="panel">
          {snapshots.length ? (
            <div className="simple-list">
              {snapshots.map((s) => (
                <Link to={`/snapshots?open=${s.id}`} key={s.id}>
                  <span className="device-symbol">
                    <Clock3 size={18} />
                  </span>
                  <div>
                    <strong>{s.name}</strong>
                    <small>
                      {date(s.created_at)} ·{" "}
                      {s.file_count ?? s.files?.length ?? "Saved"} files
                    </small>
                  </div>
                  <ChevronRight size={16} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No device snapshots yet"
              description="Save a point in time before an upgrade or a configuration change."
              action={
                <Link
                  className="button primary"
                  to={`/snapshots?device=${id}&create=true`}
                >
                  <Plus size={15} />
                  Create snapshot
                </Link>
              }
            />
          )}
        </div>
      ) : tab === "connection" ? (
        <Connection device={device} />
      ) : (
        <section className="panel">
          <ActivityList entries={activity} />
        </section>
      )}
      {user.role === "admin" && (
        <div className="danger-zone">
          <span>
            Removing a device may affect its configurations. Review your backups
            first.
          </span>
          <Button
            danger
            icon={<Trash2 size={14} />}
            onClick={() => setDeleting(true)}
          >
            Delete device
          </Button>
        </div>
      )}
      {editing && (
        <DeviceForm
          device={device}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            changed();
            notify("Device updated.");
          }}
        />
      )}
      {importing && (
        <RemoteBrowser
          device={device}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            changed();
            notify("Selected configuration files imported.");
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete device?"
          description={`Delete ${device.name} and its configuration definitions? Saved snapshots may prevent this operation. This cannot be undone.`}
          danger
          label="Delete device"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await remove(`/devices/${id}`);
            changed();
            window.location.assign("/devices");
          }}
        />
      )}
    </>
  );
}
function DeviceConfigList({ configs }: { configs: Config[] }) {
  return configs.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Configuration</th>
            <th>Format</th>
            <th>Policy</th>
            <th>Version</th>
            <th>Changed</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {configs.map((config) => (
            <tr key={config.id}>
              <td>
                <Link to={`/configs/${config.id}`} className="file-cell">
                  <span className="file-icon">
                    <FileCode2 size={18} />
                  </span>
                  <div>
                    <strong>{config.name}</strong>
                    <small className="monospace">{config.path}</small>
                  </div>
                </Link>
              </td>
              <td>
                <Tag>{config.format}</Tag>
              </td>
              <td>{policies.find((p) => p.value === config.policy)?.label}</td>
              <td>
                <span className="version-pill">v{config.version}</span>
              </td>
              <td className="muted">{relative(config.updated_at)}</td>
              <td>
                <Link
                  to={`/configs/${config.id}`}
                  className="icon-button"
                  aria-label={`Open ${config.name}`}
                >
                  <ChevronRight size={16} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty
      title="A clean slate"
      description="Import a configuration file to start a reliable version history for this device."
    />
  );
}
function Connection({ device }: { device: Device }) {
  const { changed, notify, user } = useVault(),
    [editing, setEditing] = useState(false),
    [password, setPassword] = useState(""),
    [privateKey, setPrivateKey] = useState(""),
    [passphrase, setPassphrase] = useState(""),
    [auth, setAuth] = useState("key"),
    [key, setKey] = useState<{ host_key: string; fingerprint: string }>(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState<unknown>(),
    [result, setResult] = useState<any>(),
    [interval, setIntervalValue] = useState(
      (device.connection_data.sync_interval || 900) / 60,
    ),
    [autoSync, setAutoSync] = useState(!!device.connection_data.auto_sync);
  const operate = async (action: string, call: () => Promise<any>) => {
    setBusy(action);
    setError(undefined);
    try {
      const value = await call();
      setResult(value);
      if (action === "key") setKey(value);
      else if (action === "pin") {
        setKey(undefined);
        changed();
        notify("Host key pinned.");
      } else if (action === "test") notify("Connection test succeeded.");
    } catch (e) {
      setError(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <section className="panel connection-panel">
        <div className="panel-head">
          <div>
            <h2>Connection settings</h2>
            <p>Controlled access to your configuration source.</p>
          </div>
          {user.role === "admin" && (
            <Button
              onClick={() => setEditing(true)}
              icon={<Settings2 size={15} />}
            >
              Edit connection
            </Button>
          )}
        </div>
        <div className="metadata-grid">
          <div>
            <span>Connection</span>
            <strong>{device.connection}</strong>
          </div>
          <div>
            <span>Host</span>
            <strong>{device.host || "—"}</strong>
          </div>
          <div>
            <span>SSH username</span>
            <strong>{device.connection_data.username || "—"}</strong>
          </div>
          <div>
            <span>Allowed roots</span>
            <strong className="monospace">
              {(device.connection_data.roots || []).join(", ") || "None"}
            </strong>
          </div>
        </div>
      </section>
      {device.connection === "ssh" && user.role === "admin" && (
        <div className="connection-grid">
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Host identity</h2>
                <p>
                  Verify the fingerprint with a trusted source before pinning.
                </p>
              </div>
              <ShieldCheck size={20} />
            </div>
            <div className="panel-body">
              <div className="key-state">
                <Status
                  value={
                    device.connection_data.host_key ? "Pinned" : "Not pinned"
                  }
                />
                <small className="monospace">
                  {device.connection_data.host_key ||
                    "A verified host key is required for SSH access."}
                </small>
              </div>
              <Button
                busy={busy === "key"}
                icon={<KeyRound size={15} />}
                onClick={() =>
                  operate("key", () => api(`/devices/${device.id}/host-key`))
                }
              >
                Read server host key
              </Button>
              {key && (
                <div className="host-key-review">
                  <strong>Unverified fingerprint</strong>
                  <code>{key.fingerprint}</code>
                  <Notice kind="warning">
                    Check this fingerprint directly on the server or with its
                    administrator. Reading a key alone does not verify server
                    identity.
                  </Notice>
                  <Button
                    primary
                    busy={busy === "pin"}
                    onClick={() =>
                      operate("pin", () =>
                        patch(`/devices/${device.id}`, {
                          connection_data: {
                            ...device.connection_data,
                            host_key: key.host_key,
                          },
                        }),
                      )
                    }
                  >
                    Pin this host key
                  </Button>
                </div>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div>
                <h2>Encrypted credential</h2>
                <p>Stored only as encrypted data on your server.</p>
              </div>
              <KeyRound size={20} />
            </div>
            <AsyncForm
              submit="Store credential"
              onSubmit={async () => {
                await put(
                  `/devices/${device.id}/credential`,
                  auth === "key"
                    ? {
                        private_key: privateKey,
                        passphrase: passphrase || undefined,
                      }
                    : { password },
                );
                setPassword("");
                setPrivateKey("");
                setPassphrase("");
                notify("Encrypted SSH credential stored.");
              }}
            >
              <Field label="Authentication">
                <select value={auth} onChange={(e) => setAuth(e.target.value)}>
                  <option value="key">Private key</option>
                  <option value="password">Password</option>
                </select>
              </Field>
              {auth === "key" ? (
                <>
                  <Field label="Private key" required>
                    <textarea
                      rows={4}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      required
                      autoComplete="off"
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    />
                  </Field>
                  <Field label="Key passphrase">
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              ) : (
                <Field label="SSH password" required>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </Field>
              )}
            </AsyncForm>
          </section>
        </div>
      )}
      {device.connection !== "manual" && (
        <section className="panel section-space">
          <div className="panel-head">
            <div>
              <h2>Sync & connectivity</h2>
              <p>
                Pull detected changes into your vault. Remote files are never
                overwritten by sync.
              </p>
            </div>
            <Button
              busy={busy === "test"}
              onClick={() =>
                operate("test", () => post(`/devices/${device.id}/test`, {}))
              }
              icon={<CheckCircle2 size={16} />}
              disabled={user.role === "viewer"}
            >
              Test connection
            </Button>
          </div>
          {user.role === "admin" && (
            <AsyncForm
              submit="Save sync schedule"
              onSubmit={async () => {
                await patch(`/devices/${device.id}`, {
                  connection_data: {
                    ...device.connection_data,
                    auto_sync: autoSync,
                    sync_interval: Math.round(interval * 60),
                  },
                });
                changed();
                notify("Sync schedule updated.");
              }}
            >
              <div className="form-grid">
                <Field label="Automatic sync">
                  <select
                    value={autoSync ? "enabled" : "disabled"}
                    onChange={(e) => setAutoSync(e.target.value === "enabled")}
                  >
                    <option value="disabled">Disabled</option>
                    <option value="enabled">Enabled</option>
                  </select>
                </Field>
                <Field label="Every (minutes)">
                  <input
                    type="number"
                    value={interval}
                    onChange={(e) => setIntervalValue(Number(e.target.value))}
                    min={1}
                    max={10080}
                    required
                  />
                </Field>
              </div>
            </AsyncForm>
          )}
        </section>
      )}
      <ErrorNotice error={error} />
      {result && busy === "" && (
        <div className="notice info">
          <CheckCircle2 size={18} />
          <span>{result.message || "Operation completed."}</span>
        </div>
      )}
      {device.connection !== "manual" && user.role === "admin" && (
        <Hooks device={device} />
      )}{" "}
      {editing && (
        <DeviceForm
          device={device}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            changed();
          }}
        />
      )}
    </>
  );
}
function Hooks({ device }: { device: Device }) {
  const { notify } = useVault();
  const { data, error, loading, reload } = useLoad(
    () => api<any>(`/devices/${device.id}/hooks`),
    [device.id],
  );
  const [enabled, setEnabled] = useState<boolean>(),
    [command, setCommand] = useState<string>(),
    [configId, setConfigId] = useState("");
  return (
    <section className="panel section-space">
      <div className="panel-head">
        <div>
          <h2>Post-apply hook</h2>
          <p>
            Optional, explicit and audited. Hooks run only after a successful
            apply.
          </p>
        </div>
        <Tag>Advanced</Tag>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading ? (
        <Loading />
      ) : (
        <AsyncForm
          submit="Save hook settings"
          onSubmit={async () => {
            await put(`/devices/${device.id}/hooks`, {
              enabled: enabled ?? data.enabled,
              command: command || data.command || "nginx_reload",
              config_id: configId ? Number(configId) : null,
            });
            reload();
            notify("Hook settings saved.");
          }}
        >
          <div className="form-grid">
            <Field label="Hook execution">
              <select
                value={(enabled ?? data?.enabled) ? "enabled" : "disabled"}
                onChange={(e) => setEnabled(e.target.value === "enabled")}
              >
                <option value="disabled">Disabled (recommended default)</option>
                <option value="enabled">Enabled for explicit apply</option>
              </select>
            </Field>
            <Field label="Allowed hook">
              <select
                value={command || data?.command || "nginx_reload"}
                onChange={(e) => setCommand(e.target.value)}
              >
                {Object.entries(data?.commands || {}).map(([key, value]) => (
                  <option value={key} key={key}>
                    {String(value)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Notice>
            Configured command:{" "}
            <code>
              {data?.commands?.[command || data?.command || "nginx_reload"]}
            </code>
            . The apply dialog requires a separate confirmation before running
            it.
          </Notice>
        </AsyncForm>
      )}
    </section>
  );
}
export function RemoteBrowser({
  device,
  onClose,
  onDone,
}: {
  device: Device;
  onClose: () => void;
  onDone: () => void;
}) {
  const [path, setPath] = useState(device.connection_data.roots?.[0] || ""),
    [loadedPath, setLoadedPath] = useState(path),
    [selected, setSelected] = useState<string[]>([]),
    [policy, setPolicy] = useState("pull_only"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const listing = useLoad(
    () =>
      api<{
        path: string;
        files: { name: string; path: string; size: number; is_dir: boolean }[];
      }>(`/devices/${device.id}/browse?path=${encodeURIComponent(loadedPath)}`),
    [loadedPath],
  );
  return (
    <Modal
      wide
      title={`Import from ${device.name}`}
      description="Browse allowed source directories and choose the files to version."
      onClose={onClose}
    >
      <div className="modal-body">
        <form
          className="browse-path"
          onSubmit={(e) => {
            e.preventDefault();
            setLoadedPath(path);
          }}
        >
          <FolderOpen size={18} />
          <input
            aria-label="Directory path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <Button type="submit">Open</Button>
        </form>
        <ErrorNotice error={listing.error} onRetry={listing.reload} />
        {listing.loading ? (
          <Loading text="Reading source directory…" />
        ) : (
          <div className="browser-list">
            {listing.data?.files.map((file) => (
              <div className="browser-row" key={file.path}>
                {file.is_dir ? (
                  <button
                    className="browser-directory"
                    onClick={() => {
                      setPath(file.path);
                      setLoadedPath(file.path);
                    }}
                  >
                    <Folder size={18} />
                    <strong>{file.name}</strong>
                    <ChevronRight size={16} />
                  </button>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes(file.path)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, file.path]
                            : selected.filter((p) => p !== file.path),
                        )
                      }
                    />
                    <FileCode2 size={18} />
                    <strong>{file.name}</strong>
                    <small>{bytes(file.size)}</small>
                  </label>
                )}
              </div>
            ))}
            {!listing.data?.files.length && !listing.error && (
              <Empty
                title="No files in this directory"
                description="Choose another allowed source directory."
              />
            )}
          </div>
        )}
        <div className="form-grid">
          <Field label="Sync policy">
            <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
              {policies.map((p) => (
                <option value={p.value} key={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="selection-note">{selected.length} files selected</div>
        </div>
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary
          busy={busy}
          disabled={!selected.length}
          icon={<Upload size={15} />}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await post(`/devices/${device.id}/import`, {
                paths: selected,
                policy,
              });
              onDone();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Import selected files
        </Button>
      </div>
    </Modal>
  );
}
