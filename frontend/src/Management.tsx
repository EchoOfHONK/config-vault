import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileCode2,
  FolderKanban,
  GitCompareArrows,
  HardDrive,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import {
  api,
  post,
  patch,
  remove,
  type Config,
  type Device,
  type Group,
  type Snapshot,
  type Backup,
  type User,
  type Token,
  type Template,
  type Version,
  date,
  relative,
  bytes,
  formats,
} from "./api";
import {
  AsyncForm,
  Button,
  CheckList,
  Confirm,
  DiffViewer,
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
import { useVault } from "./App";
import { ConfigForm } from "./Configs";
export function Snapshots() {
  const { refresh, changed, notify, user } = useVault(),
    [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get("create") === "true"),
    [opened, setOpened] = useState<number | undefined>(
      params.get("open") ? Number(params.get("open")) : undefined,
    ),
    [filter, setFilter] = useState("");
  const { data, error, loading, reload } = useLoad(
    () => api<Snapshot[]>("/snapshots"),
    [refresh],
  );
  return (
    <>
      <PageHead
        eyebrow="POINTS YOU CAN RETURN TO"
        title="Snapshots"
        description="Save a configuration state before an upgrade, a migration, or a change."
        actions={
          user.role !== "viewer" && (
            <Button
              primary
              icon={<Plus size={16} />}
              onClick={() => setCreating(true)}
            >
              Create snapshot
            </Button>
          )
        }
      />
      <div className="toolbar">
        <div className="filter-search">
          <Search size={16} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Find a snapshot…"
            aria-label="Filter snapshots"
          />
        </div>
        <span className="muted">{data?.length || 0} snapshots</span>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="snapshots-grid">
          {data?.length ? (
            data
              .filter((s) =>
                `${s.name} ${s.description}`
                  .toLowerCase()
                  .includes(filter.toLowerCase()),
              )
              .map((s) => (
                <button
                  className="snapshot-card panel"
                  onClick={() => setOpened(s.id)}
                  key={s.id}
                >
                  <div className="snapshot-card-head">
                    <span className="device-symbol">
                      <Clock3 size={22} />
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <h2>{s.name}</h2>
                  <p>{s.description || "A saved configuration state."}</p>
                  <div className="snapshot-card-foot">
                    <span>
                      <FileCode2 size={14} />
                      {s.file_count ?? s.files?.length ?? "Saved"} files
                    </span>
                    <span>{relative(s.created_at)}</span>
                  </div>
                </button>
              ))
          ) : (
            <Empty
              title="Save a point in time"
              description="Create a snapshot of a device or selected files. Compare and restore them together, whenever you need."
              action={
                user.role !== "viewer" && (
                  <Button
                    primary
                    icon={<Plus size={16} />}
                    onClick={() => setCreating(true)}
                  >
                    Create first snapshot
                  </Button>
                )
              }
            />
          )}
        </div>
      )}
      {creating && (
        <NewSnapshot
          defaultDevice={params.get("device") || ""}
          onClose={() => {
            setCreating(false);
            setParams({});
          }}
          onDone={() => {
            setCreating(false);
            setParams({});
            changed();
            notify("Snapshot created.");
          }}
        />
      )}
      {opened !== undefined && (
        <SnapshotDetail
          id={opened}
          onClose={() => {
            setOpened(undefined);
            setParams({});
          }}
        />
      )}
    </>
  );
}
function NewSnapshot({
  defaultDevice,
  onClose,
  onDone,
}: {
  defaultDevice: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [device, setDevice] = useState(defaultDevice),
    [selected, setSelected] = useState<number[]>([]),
    [all, setAll] = useState(true);
  const result = useLoad(
    () =>
      Promise.all([
        api<Config[]>(device ? `/configs?device_id=${device}` : "/configs"),
        api<Device[]>("/devices"),
      ]),
    [device],
  );
  return (
    <Modal
      title="Create snapshot"
      description="A snapshot remembers each file's exact version at this moment."
      onClose={onClose}
    >
      <AsyncForm
        cancel={onClose}
        submit="Create snapshot"
        onSubmit={async () => {
          const configs = result.data?.[0] || [];
          const ids = all ? configs.map((c) => c.id) : selected;
          if (!ids.length)
            throw new Error("Select at least one configuration.");
          await post("/snapshots", {
            name,
            description,
            device_id: device ? Number(device) : null,
            config_ids: ids,
          });
          onDone();
        }}
      >
        <Field label="Snapshot name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Before Debian upgrade"
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="System state before upgrading to Debian 13.2"
          />
        </Field>
        <Field label="Device">
          <select
            value={device}
            onChange={(e) => {
              setDevice(e.target.value);
              setSelected([]);
            }}
          >
            <option value="">All accessible devices</option>
            {result.data?.[1].map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          <div>
            <strong>Include all matching configurations</strong>
            <small>{result.data?.[0].length || 0} files</small>
          </div>
        </label>
        {!all && (
          <CheckList
            selected={selected}
            onChange={setSelected}
            options={(result.data?.[0] || []).map((c) => ({
              id: c.id,
              label: c.name,
              detail: `${c.device_name} · ${c.path}`,
            }))}
          />
        )}
        <ErrorNotice error={result.error} />
      </AsyncForm>
    </Modal>
  );
}
function SnapshotDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { user, changed, notify } = useVault();
  const snapshot = useLoad(() => api<Snapshot>(`/snapshots/${id}`), [id]);
  const [selected, setSelected] = useState<number[]>([]),
    [reviewing, setReviewing] = useState(false),
    [deleting, setDeleting] = useState(false);
  return (
    <Modal
      wide
      title={snapshot.data?.name || "Snapshot"}
      description={
        snapshot.data
          ? `${date(snapshot.data.created_at)} · ${snapshot.data.description}`
          : "Loading snapshot…"
      }
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={snapshot.error} />
        {snapshot.loading ? (
          <Loading />
        ) : (
          <>
            <Notice>
              The saved versions are immutable. Restoring selected files creates
              new versions.
            </Notice>
            <div className="selection-toolbar">
              <strong>{snapshot.data?.files?.length || 0} saved files</strong>
              <Button
                onClick={() =>
                  setSelected(
                    snapshot.data?.files?.map((f) => f.config_id) || [],
                  )
                }
              >
                Select all
              </Button>
              <Button onClick={() => setSelected([])}>Clear selection</Button>
            </div>
            <CheckList
              options={(snapshot.data?.files || []).map((f) => ({
                id: f.config_id,
                label: `${f.name} · Version ${f.version}`,
                detail: f.path,
              }))}
              selected={selected}
              onChange={setSelected}
            />
          </>
        )}
      </div>
      <div className="modal-actions">
        {user.role !== "viewer" && (
          <Button
            danger
            icon={<Trash2 size={14} />}
            onClick={() => setDeleting(true)}
          >
            Delete snapshot
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
        {user.role !== "viewer" && (
          <Button
            primary
            icon={<RotateCcw size={16} />}
            disabled={!selected.length}
            onClick={() => setReviewing(true)}
          >
            Review restore ({selected.length})
          </Button>
        )}
      </div>
      {reviewing && snapshot.data && (
        <SnapshotRestore
          snapshot={snapshot.data}
          selected={selected}
          onClose={() => setReviewing(false)}
          onDone={() => {
            changed();
            notify("Selected snapshot files restored as new versions.");
            onClose();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete snapshot?"
          description="Remove this saved configuration point? Current files and version history are preserved."
          danger
          label="Delete snapshot"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await remove(`/snapshots/${id}`);
            changed();
            notify("Snapshot deleted. Version history is preserved.");
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
function SnapshotRestore({
  snapshot,
  selected,
  onClose,
  onDone,
}: {
  snapshot: Snapshot;
  selected: number[];
  onClose: () => void;
  onDone: () => void;
}) {
  const files = (snapshot.files || []).filter((f) =>
    selected.includes(f.config_id),
  );
  const preview = useLoad(
    () =>
      Promise.all(
        files.map(async (file) => {
          const current = await api<Config>(`/configs/${file.config_id}`);
          const diff = await api<any>(
            `/configs/${file.config_id}/diff?left=${file.version}&right=${current.version}`,
          );
          return {
            file,
            current,
            saved: { content: diff.left_content },
            hidden: diff.has_hidden_changes,
          };
        }),
      ),
    [snapshot.id, selected.join(",")],
  );
  const [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const current = preview.data?.[index];
  return (
    <Modal
      wide
      title="Review snapshot restore"
      description={`${selected.length} files will be restored together. Every file is checked for concurrent changes.`}
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={preview.error} />
        {preview.loading ? (
          <Loading text="Preparing restore comparison…" />
        ) : (
          current && (
            <>
              <Field label="Review file">
                <select
                  value={index}
                  onChange={(e) => setIndex(Number(e.target.value))}
                >
                  {preview.data!.map((p, i) => (
                    <option value={i} key={p.file.config_id}>
                      {p.file.path}
                    </option>
                  ))}
                </select>
              </Field>
              {current.hidden && (
                <Notice kind="warning">
                  This file contains changes to hidden secret values. They
                  remain masked in the preview.
                </Notice>
              )}
              <DiffViewer
                left={current.current.content || ""}
                right={current.saved.content || ""}
                leftLabel={`Current · Version ${current.current.version}`}
                rightLabel={`Snapshot · Version ${current.file.version}`}
              />
              <Notice>
                All selected changes are applied in one transaction. If any file
                changed since this preview, restoration stops.
              </Notice>
            </>
          )
        )}
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary
          disabled={preview.loading || !!preview.error}
          busy={busy}
          icon={<RotateCcw size={15} />}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/snapshots/${snapshot.id}/restore`, {
                config_ids: selected,
                expected_versions: Object.fromEntries(
                  preview.data!.map((p) => [
                    String(p.file.config_id),
                    p.current.version,
                  ]),
                ),
              });
              onDone();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm restore {selected.length} files
        </Button>
      </div>
    </Modal>
  );
}
export function Compare() {
  const { refresh } = useVault();
  const devices = useLoad(() => api<Device[]>("/devices"), [refresh]);
  const [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [opened, setOpened] = useState<{
      path: string;
      left_id: number;
      right_id: number;
    }>();
  const comparisons = useLoad(
    () =>
      left && right && left !== right
        ? api<
            {
              path: string;
              left_id: number | null;
              right_id: number | null;
              status: string;
            }[]
          >(`/compare?left_device=${left}&right_device=${right}`)
        : Promise.resolve(null),
    [left, right, refresh],
  );
  return (
    <>
      <PageHead
        eyebrow="SPOT WHAT IS DIFFERENT"
        title="Compare devices"
        description="Compare matching configuration paths across two systems. Secrets stay masked."
      />
      <div className="compare-device-select panel">
        <Field label="First device">
          <select value={left} onChange={(e) => setLeft(e.target.value)}>
            <option value="">Select device</option>
            {devices.data?.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <GitCompareArrows size={25} />
        <Field label="Second device">
          <select value={right} onChange={(e) => setRight(e.target.value)}>
            <option value="">Select device</option>
            {devices.data?.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <ErrorNotice error={devices.error} />
      <ErrorNotice error={comparisons.error} onRetry={comparisons.reload} />
      {comparisons.loading ? (
        <Loading text="Comparing configurations…" />
      ) : comparisons.data ? (
        <div className="panel">
          <div className="panel-head">
            <h2>{comparisons.data.length} matching paths</h2>
            <Tag>
              {comparisons.data.filter((c) => c.status === "different").length}{" "}
              differences
            </Tag>
          </div>
          {comparisons.data.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Configuration path</th>
                    <th>Result</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {comparisons.data.map((c) => (
                    <tr key={c.path}>
                      <td className="monospace">{c.path}</td>
                      <td>
                        <Status value={c.status} />
                      </td>
                      <td>
                        {c.left_id && c.right_id ? (
                          <Button
                            icon={<GitCompareArrows size={14} />}
                            onClick={() => setOpened(c as any)}
                          >
                            View diff
                          </Button>
                        ) : (
                          <Link
                            to={`/configs/${c.left_id || c.right_id}`}
                            className="button"
                          >
                            View file
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No configuration files to compare"
              description="Import files on these devices to compare their contents."
            />
          )}
        </div>
      ) : (
        <Empty
          title={
            left && right && left === right
              ? "Choose two different devices"
              : "Choose your systems"
          }
          description="Compare production with staging, or two servers that should share a configuration."
        />
      )}
      {opened && (
        <DeviceDiff
          value={opened}
          onClose={() => setOpened(undefined)}
          leftName={
            devices.data?.find((d) => d.id === Number(left))?.name ||
            "First device"
          }
          rightName={
            devices.data?.find((d) => d.id === Number(right))?.name ||
            "Second device"
          }
        />
      )}
    </>
  );
}
function DeviceDiff({
  value,
  onClose,
  leftName,
  rightName,
}: {
  value: { path: string; left_id: number; right_id: number; status?: string };
  onClose: () => void;
  leftName: string;
  rightName: string;
}) {
  const result = useLoad(
    () =>
      Promise.all([
        api<Config>(`/configs/${value.left_id}`),
        api<Config>(`/configs/${value.right_id}`),
      ]),
    [value],
  );
  return (
    <Modal
      wide
      title="Device comparison"
      description={value.path}
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={result.error} />
        {result.loading ? (
          <Loading />
        ) : (
          result.data && (
            <>
              {value.status === "different" &&
                result.data[0].content === result.data[1].content && (
                  <Notice kind="warning">
                    These files differ in hidden secret values. Their values
                    remain masked in this comparison.
                  </Notice>
                )}
              <DiffViewer
                left={result.data[0].content || ""}
                right={result.data[1].content || ""}
                leftLabel={leftName}
                rightLabel={rightName}
              />
            </>
          )
        )}
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
export function Backups() {
  const { refresh, changed, notify } = useVault();
  const { data, error, loading, reload } = useLoad(
    () => api<Backup[]>("/backups"),
    [refresh],
  );
  const [creating, setCreating] = useState(false),
    [restoring, setRestoring] = useState(false);
  return (
    <>
      <PageHead
        eyebrow="YOUR RECOVERY PLAN"
        title="Backups"
        description="Encrypted backups of configurations, history, devices, users and metadata."
        actions={
          <>
            <Button
              icon={<RotateCcw size={16} />}
              onClick={() => setRestoring(true)}
            >
              Restore backup
            </Button>
            <Button
              primary
              icon={<Plus size={16} />}
              onClick={() => setCreating(true)}
            >
              Create backup
            </Button>
          </>
        }
      />
      <div className="backup-summary panel">
        <span className="round-icon">
          <HardDrive size={28} />
        </span>
        <div>
          <h2>Recovery starts with a copy.</h2>
          <p>
            Keep backup files outside this server. Password-protected backups
            are portable; instance-key backups need your saved vault encryption
            key.
          </p>
        </div>
        <Link className="text-link" to="/settings">
          Backup schedule
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="panel-head">
            <h2>Backup archive</h2>
            <Tag>{data?.length || 0} backups</Tag>
          </div>
          {data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Backup</th>
                    <th>Created</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div className="file-cell">
                          <span className="file-icon">
                            <Archive size={18} />
                          </span>
                          <strong>{b.name}</strong>
                        </div>
                      </td>
                      <td className="muted">{date(b.created_at)}</td>
                      <td>{bytes(b.size)}</td>
                      <td>
                        <Status value={b.status} />
                      </td>
                      <td>
                        {b.available !== false &&
                          b.status.toLowerCase() === "completed" && (
                            <a
                              href={`/api/backups/${b.id}/download`}
                              download
                              className="button"
                            >
                              <Download size={15} />
                              Download
                            </a>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="Create your first backup"
              description="Preserve the complete state of your vault in an encrypted archive."
              action={
                <Button
                  primary
                  onClick={() => setCreating(true)}
                  icon={<Plus size={15} />}
                >
                  Create backup
                </Button>
              }
            />
          )}
        </section>
      )}
      {creating && (
        <BackupCreate
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            changed();
            notify(
              "Encrypted backup created. Download a copy to another device.",
            );
          }}
        />
      )}
      {restoring && <BackupRestore onClose={() => setRestoring(false)} />}
    </>
  );
}
function BackupCreate({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [portable, setPortable] = useState(true),
    [password, setPassword] = useState(""),
    [again, setAgain] = useState("");
  return (
    <Modal
      title="Create encrypted backup"
      description="Configurations and all recovery metadata are included."
      onClose={onClose}
    >
      <AsyncForm
        cancel={onClose}
        submit="Create backup"
        onSubmit={async () => {
          if (portable && password !== again)
            throw new Error("Backup passwords do not match.");
          await post("/backups", { password: portable ? password : undefined });
          onDone();
        }}
      >
        <Field label="Encryption method">
          <select
            value={portable ? "portable" : "instance"}
            onChange={(e) => setPortable(e.target.value === "portable")}
          >
            <option value="portable">Portable password encryption</option>
            <option value="instance">Instance encryption key</option>
          </select>
        </Field>
        {portable ? (
          <>
            <Field
              label="Backup password"
              required
              hint="At least 12 characters. Keep this password separately from the archive."
            >
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={12}
                required
                autoComplete="new-password"
              />
            </Field>
            <Field label="Repeat password" required>
              <input
                type="password"
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                required
                autoComplete="new-password"
              />
            </Field>
          </>
        ) : (
          <Notice>
            Recovering this backup on another machine requires your original
            instance encryption key.
          </Notice>
        )}
      </AsyncForm>
    </Modal>
  );
}
function BackupRestore({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File>(),
    [password, setPassword] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  return (
    <Modal
      title="Restore a backup"
      description="This replaces the current vault data with the saved state."
      onClose={onClose}
    >
      <AsyncForm
        cancel={onClose}
        submit="Restore vault"
        onSubmit={async () => {
          if (!file) throw new Error("Choose a backup file.");
          if (!confirmed)
            throw new Error("Confirm replacement of current data.");
          const form = new FormData();
          form.append("file", file);
          form.append("password", password);
          form.append("confirm", "true");
          await api("/backups/restore", { method: "POST", body: form });
          window.location.assign("/");
        }}
      >
        <Notice kind="warning">
          Create and download a backup of the current state first. Restoring
          replaces devices, configurations, users, versions, snapshots and
          activity with the backup contents.
        </Notice>
        <Field label="Encrypted backup file" required>
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0])}
            required
          />
        </Field>
        <Field
          label="Backup password"
          hint="Leave empty for an instance-key backup. The original instance key must be available on the server."
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <div>
            <strong>
              I understand that current vault data will be replaced.
            </strong>
            <small>
              After restoration, sign in with an account from the backup.
            </small>
          </div>
        </label>
      </AsyncForm>
    </Modal>
  );
}
export function GroupsPage() {
  const { refresh, changed, notify, user } = useVault();
  const [tab, setTab] = useState("services"),
    [editing, setEditing] = useState<Group | Template | null | undefined>(),
    [deleting, setDeleting] = useState<Group>(),
    [template, setTemplate] = useState<Template>();
  const result = useLoad(
    () =>
      Promise.all([
        api<Group[]>("/services"),
        api<Group[]>("/projects"),
        api<Template[]>("/templates"),
        api<Config[]>("/configs"),
        api<Device[]>("/devices"),
      ]),
    [refresh],
  );
  const groupItems =
    tab === "services"
      ? result.data?.[0]
      : tab === "projects"
        ? result.data?.[1]
        : result.data?.[2];
  const canManage =
    user.role !== "viewer" && (tab !== "templates" || user.role === "admin");
  return (
    <>
      <PageHead
        eyebrow="GROUP FILES THE WAY YOU WORK"
        title="Services & projects"
        description="Bring related configurations together across devices and applications."
        actions={
          canManage && (
            <Button
              primary
              icon={<Plus size={16} />}
              onClick={() => setEditing(null)}
            >
              New{" "}
              {tab === "services"
                ? "service"
                : tab === "projects"
                  ? "project"
                  : "template"}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          {
            value: "services",
            label: "Services",
            count: result.data?.[0].length,
          },
          {
            value: "projects",
            label: "Projects",
            count: result.data?.[1].length,
          },
          {
            value: "templates",
            label: "Templates",
            count: result.data?.[2].length,
          },
        ]}
      />
      <ErrorNotice error={result.error} onRetry={result.reload} />
      {result.loading && !result.data ? (
        <Loading />
      ) : groupItems?.length ? (
        <div className="group-grid">
          {groupItems.map((group) => {
            const files = result.data![3].filter((c) =>
              tab === "services"
                ? c.service_id === group.id
                : c.project_id === group.id,
            );
            return (
              <section className="panel group-card" key={group.id}>
                <div className="group-card-head">
                  <span className="device-symbol">
                    {tab === "templates" ? (
                      <FileCode2 size={21} />
                    ) : (
                      <FolderKanban size={21} />
                    )}
                  </span>
                  {canManage && (
                    <div className="head-actions">
                      <button
                        className="icon-button"
                        aria-label={`Edit ${group.name}`}
                        onClick={() => setEditing(group)}
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Delete ${group.name}`}
                        onClick={() => setDeleting(group)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
                <h2>{group.name}</h2>
                <p>
                  {group.description ||
                    "Related configuration files, together."}
                </p>
                {tab === "templates" ? (
                  <>
                    <Tag>{(group as Template).format}</Tag>
                    <div className="group-card-actions">
                      <Button
                        primary
                        icon={<Plus size={15} />}
                        disabled={user.role === "viewer"}
                        onClick={() => setTemplate(group as Template)}
                      >
                        Create configuration
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="group-device">
                      <Server size={14} />
                      {tab === "services"
                        ? result.data?.[4].find((d) => d.id === group.device_id)
                            ?.name || "Across devices"
                        : "Across devices"}
                      <span>{files.length} configurations</span>
                    </div>
                    <div className="group-file-list">
                      {files.slice(0, 4).map((c) => (
                        <Link key={c.id} to={`/configs/${c.id}`}>
                          <FileCode2 size={14} />
                          {c.name}
                          <span>v{c.version}</span>
                        </Link>
                      ))}
                      {!files.length && (
                        <small>
                          Assign files from their configuration settings.
                        </small>
                      )}
                    </div>
                    {tab === "projects" && (
                      <div className="group-card-actions">
                        <a
                          href={`/api/projects/${group.id}/export`}
                          className="button"
                        >
                          <Download size={15} />
                          Export repository
                        </a>
                        <small>Secret values excluded automatically.</small>
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <Empty
          title={`No ${tab} yet`}
          description={
            tab === "templates"
              ? "Create a reusable configuration template. Start a real configuration from it when you need."
              : `Create a ${tab === "services" ? "service" : "project"} to organize related files across your systems.`
          }
          action={
            canManage && (
              <Button
                primary
                onClick={() => setEditing(null)}
                icon={<Plus size={15} />}
              >
                Create{" "}
                {tab === "services"
                  ? "service"
                  : tab === "projects"
                    ? "project"
                    : "template"}
              </Button>
            )
          }
        />
      )}
      {editing !== undefined && (
        <GroupForm
          kind={tab}
          value={editing || undefined}
          devices={result.data?.[4] || []}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            changed();
            notify(`${tab === "templates" ? "Template" : "Group"} saved.`);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete ${tab === "templates" ? "template" : "group"}?`}
          description={`Delete ${deleting.name}? Configuration files and their versions are preserved.`}
          danger
          label="Delete"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await remove(`/${tab}/${deleting.id}`);
            changed();
          }}
        />
      )}
      {template && (
        <ConfigForm
          template={template}
          onClose={() => setTemplate(undefined)}
          onDone={() => {
            setTemplate(undefined);
            changed();
            notify("Configuration created from template.");
          }}
        />
      )}
    </>
  );
}
function GroupForm({
  kind,
  value,
  devices,
  onClose,
  onDone,
}: {
  kind: string;
  value?: Group | Template;
  devices: Device[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(value?.name || ""),
    [description, setDescription] = useState(value?.description || ""),
    [device, setDevice] = useState(
      value?.device_id ? String(value.device_id) : "",
    ),
    [format, setFormat] = useState((value as Template)?.format || "text"),
    [content, setContent] = useState((value as Template)?.content || "");
  const [revealBusy, setRevealBusy] = useState(false),
    [revealError, setRevealError] = useState<unknown>();
  return (
    <Modal
      title={`${value ? "Edit" : "Create"} ${kind === "services" ? "service" : kind === "projects" ? "project" : "template"}`}
      onClose={onClose}
      wide={kind === "templates"}
    >
      <AsyncForm
        cancel={onClose}
        onSubmit={async () => {
          if (kind === "templates" && content.includes("••"))
            throw new Error(
              "Reveal or replace masked template values before saving.",
            );
          const body = {
            name,
            description,
            ...(kind === "services"
              ? { device_id: device ? Number(device) : null }
              : {}),
            ...(kind === "templates" ? { format, content } : {}),
          };
          if (value) await patch(`/${kind}/${value.id}`, body);
          else await post(`/${kind}`, body);
          onDone();
        }}
      >
        <Field label="Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder={
              kind === "services"
                ? "WireGuard Netherlands"
                : kind === "projects"
                  ? "HYPERHUB"
                  : "Nginx reverse proxy"
            }
          />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </Field>
        {kind === "services" && (
          <Field label="Runs on">
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="">No specific device</option>
              {devices.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {kind === "templates" && (
          <>
            {value && content.includes("••") && (
              <Notice kind="warning">
                This template contains hidden secret values. Revealing them is
                recorded in the audit log.
                <Button
                  busy={revealBusy}
                  icon={<LockKeyhole size={14} />}
                  onClick={async () => {
                    setRevealBusy(true);
                    try {
                      const actual = await api<Template>(
                        `/templates/${value.id}?reveal=true`,
                      );
                      setContent(actual.content);
                    } catch (e) {
                      setRevealError(e);
                    } finally {
                      setRevealBusy(false);
                    }
                  }}
                >
                  Reveal template values
                </Button>
              </Notice>
            )}
            <ErrorNotice error={revealError} />
            <Field label="Format">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {formats.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </Field>
            <Field label="Template contents">
              <textarea
                className="monospace"
                rows={12}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
            </Field>
            <Notice>
              Templates are plain configuration text. Replace placeholder values
              when creating a configuration.
            </Notice>
          </>
        )}
      </AsyncForm>
    </Modal>
  );
}
export function UsersPage() {
  const { refresh, changed, notify, user } = useVault();
  const result = useLoad(
    () =>
      Promise.all([
        api<User[]>("/users"),
        api<Device[]>("/devices"),
        api<Group[]>("/projects"),
        api<Group[]>("/services"),
      ]),
    [refresh],
  );
  const [editing, setEditing] = useState<User | null | undefined>(),
    [deleting, setDeleting] = useState<User>();
  return (
    <>
      <PageHead
        eyebrow="ACCESS WITH INTENTION"
        title="Users & permissions"
        description="Give people the access they need. Scope it to the systems they manage."
        actions={
          <Button
            primary
            icon={<Plus size={16} />}
            onClick={() => setEditing(null)}
          >
            Add user
          </Button>
        }
      />
      <ErrorNotice error={result.error} onRetry={result.reload} />
      {result.loading && !result.data ? (
        <Loading />
      ) : (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Device scopes</th>
                  <th>Project scopes</th>
                  <th>Service scopes</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.data?.[0].map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="file-cell">
                        <span className="avatar">
                          {u.username.slice(0, 2).toUpperCase()}
                        </span>
                        <strong>{u.username}</strong>
                        {u.id === user.id && <Tag>You</Tag>}
                      </div>
                    </td>
                    <td>
                      <Tag>{u.role}</Tag>
                    </td>
                    <td>
                      {u.device_ids?.length
                        ? u.device_ids
                            .map(
                              (id) =>
                                result.data![1].find((d) => d.id === id)
                                  ?.name || id,
                            )
                            .join(", ")
                        : u.device_ids?.length ||
                            u.project_ids?.length ||
                            u.service_ids?.length
                          ? "—"
                          : "All"}
                    </td>
                    <td>
                      {u.project_ids?.length
                        ? u.project_ids
                            .map(
                              (id) =>
                                result.data![2].find((g) => g.id === id)
                                  ?.name || id,
                            )
                            .join(", ")
                        : u.device_ids?.length ||
                            u.project_ids?.length ||
                            u.service_ids?.length
                          ? "—"
                          : "All"}
                    </td>
                    <td>
                      {u.service_ids?.length
                        ? u.service_ids
                            .map(
                              (id) =>
                                result.data![3].find((g) => g.id === id)
                                  ?.name || id,
                            )
                            .join(", ")
                        : u.device_ids?.length ||
                            u.project_ids?.length ||
                            u.service_ids?.length
                          ? "—"
                          : "All"}
                    </td>
                    <td>
                      <div className="head-actions">
                        <Button
                          icon={<Pencil size={14} />}
                          onClick={() => setEditing(u)}
                        >
                          Edit
                        </Button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${u.username}`}
                          onClick={() => setDeleting(u)}
                          disabled={u.id === user.id}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="role-cards">
        <div className="panel">
          <ShieldCheck size={22} />
          <h3>Admin</h3>
          <p>
            Manage instance settings, users, credentials, hooks and full
            recovery.
          </p>
        </div>
        <div className="panel">
          <Pencil size={22} />
          <h3>Editor</h3>
          <p>
            Edit, restore, import and sync configurations within their permitted
            scope.
          </p>
        </div>
        <div className="panel">
          <Users size={22} />
          <h3>Viewer</h3>
          <p>Browse masked configurations and compare their version history.</p>
        </div>
      </div>
      {editing !== undefined && (
        <UserForm
          value={editing || undefined}
          devices={result.data?.[1] || []}
          projects={result.data?.[2] || []}
          services={result.data?.[3] || []}
          onClose={() => setEditing(undefined)}
          onDone={() => {
            setEditing(undefined);
            changed();
            notify("User permissions saved.");
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete user?"
          description={`Revoke access for ${deleting.username}? The audit history is preserved. The last admin cannot be removed.`}
          danger
          label="Delete user"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await remove(`/users/${deleting.id}`);
            changed();
          }}
        />
      )}
    </>
  );
}
function UserForm({
  value,
  devices,
  projects,
  services,
  onClose,
  onDone,
}: {
  value?: User;
  devices: Device[];
  projects: Group[];
  services: Group[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [username, setUsername] = useState(value?.username || ""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState(value?.role || "viewer"),
    [deviceIds, setDeviceIds] = useState<number[]>(value?.device_ids || []),
    [projectIds, setProjectIds] = useState<number[]>(value?.project_ids || []),
    [serviceIds, setServiceIds] = useState<number[]>(value?.service_ids || []);
  return (
    <Modal title={value ? "Edit user" : "Add user"} onClose={onClose}>
      <AsyncForm
        cancel={onClose}
        onSubmit={async () => {
          const body = {
            username,
            password: password || undefined,
            role,
            device_ids: deviceIds,
            project_ids: projectIds,
            service_ids: serviceIds,
          };
          if (value) await patch(`/users/${value.id}`, body);
          else await post("/users", body);
          onDone();
        }}
      >
        <Field label="Username" required>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="off"
          />
        </Field>
        <Field
          label={value ? "New password (optional)" : "Password"}
          required={!value}
          hint="At least 12 characters."
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!value}
            minLength={password ? 12 : undefined}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Role">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </Field>
        {role !== "admin" && (
          <>
            <Notice>
              No scopes selected means access to all devices. Selecting any
              scope limits access to matching devices, projects or services.
            </Notice>
            <details className="scope-details">
              <summary>
                Device access (
                {deviceIds.length ||
                  (projectIds.length || serviceIds.length ? "none" : "all")}
                )
              </summary>
              <CheckList
                options={devices.map((d) => ({ id: d.id, label: d.name }))}
                selected={deviceIds}
                onChange={setDeviceIds}
              />
            </details>
            <details className="scope-details">
              <summary>
                Project access (
                {projectIds.length ||
                  (deviceIds.length || serviceIds.length ? "none" : "all")}
                )
              </summary>
              <CheckList
                options={projects.map((g) => ({ id: g.id, label: g.name }))}
                selected={projectIds}
                onChange={setProjectIds}
              />
            </details>
            <details className="scope-details">
              <summary>
                Service access (
                {serviceIds.length ||
                  (deviceIds.length || projectIds.length ? "none" : "all")}
                )
              </summary>
              <CheckList
                options={services.map((g) => ({ id: g.id, label: g.name }))}
                selected={serviceIds}
                onChange={setServiceIds}
              />
            </details>
          </>
        )}
      </AsyncForm>
    </Modal>
  );
}
export function SettingsPage() {
  const [tab, setTab] = useState("general");
  return (
    <>
      <PageHead
        eyebrow="YOUR INSTANCE, YOUR RULES"
        title="Settings"
        description="Manage your vault, backup schedule and scoped API access."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "general", label: "Instance & backups" },
          { value: "tokens", label: "API tokens" },
          { value: "security", label: "Security & integrations" },
        ]}
      />
      {tab === "general" ? (
        <GeneralSettings />
      ) : tab === "tokens" ? (
        <Tokens />
      ) : (
        <div className="security-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Built-in protections</h2>
              <ShieldCheck size={22} />
            </div>
            <div className="panel-body">
              <div className="security-items">
                {[
                  "Password hashing and cookie sessions",
                  "CSRF protection on state changes",
                  "Encrypted configurations and credentials",
                  "Secret masking in viewers, search and diffs",
                  "Host key pinning for SSH connections",
                  "Scoped role and API token access",
                  "Audited views, edits, restores and applies",
                  "Conflict checks before every remote write",
                ].map((text) => (
                  <div key={text}>
                    <CheckCircle2 size={17} />
                    {text}
                  </div>
                ))}
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>Secrets Hub integration</h2>
              <Tag>Integration point</Tag>
            </div>
            <div className="panel-body">
              <p>
                Credentials are currently stored encrypted in this instance. The
                credential provider boundary is ready for a future external
                Secrets Hub.
              </p>
              <Notice>
                External Secrets Hub connectivity is not configured in this
                release. No data is sent to an external secrets service.
              </Notice>
              <p className="muted">
                Use HTTPS through your reverse proxy and keep the instance
                encryption key in a secure location outside this server. See the
                Russian README for installation and recovery instructions.
              </p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function GeneralSettings() {
  const { notify } = useVault();
  const result = useLoad(() => api<any>("/settings"), []);
  const [name, setName] = useState<string>(),
    [timezone, setTimezone] = useState<string>(),
    [interval, setIntervalValue] = useState<number>(),
    [retention, setRetention] = useState<number>();
  if (result.loading) return <Loading />;
  if (result.error)
    return <ErrorNotice error={result.error} onRetry={result.reload} />;
  return (
    <section className="panel settings-form">
      <div className="panel-head">
        <div>
          <h2>Instance settings</h2>
          <p>Applied to your self-hosted Config Vault instance.</p>
        </div>
      </div>
      <AsyncForm
        submit="Save settings"
        onSubmit={async () => {
          await patch("/settings", {
            instance_name: name ?? result.data.instance_name,
            timezone: timezone ?? result.data.timezone,
            backup_interval_hours:
              interval ?? result.data.backup_interval_hours,
            backup_retention: retention ?? result.data.backup_retention,
          });
          result.reload();
          notify("Instance settings saved.");
        }}
      >
        <div className="form-grid">
          <Field label="Instance name" required>
            <input
              value={name ?? result.data.instance_name ?? ""}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field label="Timezone" required>
            <input
              value={timezone ?? result.data.timezone ?? "UTC"}
              onChange={(e) => setTimezone(e.target.value)}
              required
              placeholder="Europe/Moscow"
            />
          </Field>
          <Field label="Scheduled backup frequency">
            <select
              value={interval ?? result.data.backup_interval_hours ?? 0}
              onChange={(e) => setIntervalValue(Number(e.target.value))}
            >
              <option value={0}>Manual only</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Daily</option>
              <option value={168}>Weekly</option>
            </select>
          </Field>
          <Field label="Keep latest backups">
            <input
              type="number"
              value={retention ?? result.data.backup_retention ?? 14}
              onChange={(e) => setRetention(Number(e.target.value))}
              min={1}
              max={365}
              required
            />
          </Field>
        </div>
        <Notice>
          Scheduled backups use the instance encryption key. Download portable
          password-protected backups from Backups for recovery on a new machine.
        </Notice>
      </AsyncForm>
    </section>
  );
}
function Tokens() {
  const { refresh, changed, notify } = useVault();
  const result = useLoad(() => api<Token[]>("/tokens"), [refresh]);
  const [creating, setCreating] = useState(false),
    [deleting, setDeleting] = useState<Token>(),
    [created, setCreated] = useState<string>();
  return (
    <>
      <div className="section-head">
        <div>
          <h2>API tokens</h2>
          <p>Scoped credentials for a future agent, CLI, or integration.</p>
        </div>
        <Button
          primary
          icon={<Plus size={16} />}
          onClick={() => setCreating(true)}
        >
          Create token
        </Button>
      </div>
      <ErrorNotice error={result.error} onRetry={result.reload} />
      {result.loading && !result.data ? (
        <Loading />
      ) : (
        <div className="panel">
          {result.data?.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Token</th>
                    <th>Scopes</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="file-cell">
                          <KeyRound size={18} />
                          <strong>{t.name}</strong>
                        </div>
                      </td>
                      <td>
                        <div className="tags">
                          {t.scopes.map((s) => (
                            <Tag key={s}>{s}</Tag>
                          ))}
                        </div>
                      </td>
                      <td>{t.expires_at ? date(t.expires_at) : "No expiry"}</td>
                      <td>
                        <Button
                          danger
                          onClick={() => setDeleting(t)}
                          icon={<Trash2 size={14} />}
                        >
                          Revoke
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              title="No API tokens"
              description="Create a scoped token when connecting an agent or automation."
              icon="secure"
            />
          )}
        </div>
      )}
      {creating && (
        <TokenForm
          onClose={() => setCreating(false)}
          onDone={(token) => {
            setCreating(false);
            setCreated(token);
            changed();
          }}
        />
      )}
      {created && (
        <Modal
          title="Save your API token"
          description="This token is shown only once. Store it securely."
          onClose={() => setCreated(undefined)}
        >
          <div className="modal-body">
            <div className="token-once">
              <code>{created}</code>
            </div>
            <Button
              icon={<Copy size={15} />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created);
                  notify("API token copied.");
                } catch {
                  notify("Select the token text and copy it manually.");
                }
              }}
            >
              Copy token
            </Button>
            <Notice>
              Send as <code>Authorization: Bearer &lt;token&gt;</code>. Never
              put tokens in URLs or logs.
            </Notice>
          </div>
          <div className="modal-actions">
            <Button primary onClick={() => setCreated(undefined)}>
              I saved the token
            </Button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title="Revoke API token?"
          description={`Immediately revoke ${deleting.name}? Any connected agent using it will lose access.`}
          danger
          label="Revoke token"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            await remove(`/tokens/${deleting.id}`);
            changed();
          }}
        />
      )}
    </>
  );
}
function TokenForm({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (token: string) => void;
}) {
  const [name, setName] = useState(""),
    [scopes, setScopes] = useState<string[]>(["read:configs"]),
    [deviceIds, setDeviceIds] = useState<number[]>([]),
    [days, setDays] = useState(30);
  const devices = useLoad(() => api<Device[]>("/devices"), []);
  return (
    <Modal title="Create scoped API token" onClose={onClose}>
      <AsyncForm
        cancel={onClose}
        submit="Create token"
        onSubmit={async () => {
          if (!scopes.length)
            throw new Error("Choose at least one token permission.");
          const result = await post<any>("/tokens", {
            name,
            scopes,
            device_ids: deviceIds,
            expires_days: days,
          });
          const token = result.token || result.access_token;
          if (!token)
            throw new Error("The server did not return the new token.");
          onDone(token);
        }}
      >
        <Field label="Token name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="Home server agent"
          />
        </Field>
        <Field label="Expires in (days)">
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            required
          />
        </Field>
        <div className="scope-details open">
          <strong>Permissions</strong>
          {[
            "read:configs",
            "write:configs",
            "sync:device",
            "create:snapshot",
          ].map((s) => (
            <label className="check-row" key={s}>
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, s]
                      : scopes.filter((v) => v !== s),
                  )
                }
              />
              <strong className="monospace">{s}</strong>
            </label>
          ))}
        </div>
        <details className="scope-details">
          <summary>
            Device scopes ({deviceIds.length || "all permitted devices"})
          </summary>
          <CheckList
            selected={deviceIds}
            onChange={setDeviceIds}
            options={(devices.data || []).map((d) => ({
              id: d.id,
              label: d.name,
            }))}
          />
        </details>
        <Notice>
          Tokens inherit the creator's permissions and can only narrow access.
        </Notice>
        <ErrorNotice error={devices.error} />
      </AsyncForm>
    </Modal>
  );
}
