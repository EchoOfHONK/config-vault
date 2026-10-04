import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  GitCompareArrows,
  History,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  api,
  post,
  patch,
  remove,
  type Config,
  type Device,
  type Group,
  type Version,
  type Template,
  date,
  relative,
  bytes,
  detectFormat,
  formats,
  policies,
} from "./api";
import {
  AsyncForm,
  Button,
  CodeEditor,
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
import { RemoteBrowser } from "./Devices";
export function Configurations() {
  const { refresh, changed, notify, user } = useVault();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || ""),
    [deviceId, setDeviceId] = useState(""),
    [serviceId, setServiceId] = useState(""),
    [projectId, setProjectId] = useState(""),
    [adding, setAdding] = useState(false);
  useEffect(() => setQ(params.get("q") || ""), [params]);
  const query = new URLSearchParams({
    q,
    ...(deviceId ? { device_id: deviceId } : {}),
    ...(serviceId ? { service_id: serviceId } : {}),
    ...(projectId ? { project_id: projectId } : {}),
  });
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        api<Config[]>(`/configs?${query}`),
        api<Device[]>("/devices"),
        api<Group[]>("/services"),
        api<Group[]>("/projects"),
      ]).then(([configs, devices, services, projects]) => ({
        configs,
        devices,
        services,
        projects,
      })),
    [q, deviceId, serviceId, projectId, refresh],
  );
  return (
    <>
      <PageHead
        eyebrow="ONE HOME FOR EVERY FILE"
        title="Configurations"
        description="Organized by device. Versioned automatically. Ready when you need them."
        actions={
          user.role !== "viewer" && (
            <>
              <Link to="/import" className="button">
                <Upload size={16} />
                Import files
              </Link>
              <Button
                primary
                icon={<Plus size={16} />}
                onClick={() => setAdding(true)}
              >
                New configuration
              </Button>
            </>
          )
        }
      />
      <div className="toolbar config-toolbar">
        <form
          className="filter-search"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(q ? { q } : {});
          }}
        >
          <Search size={16} />
          <input
            aria-label="Search configurations"
            placeholder="Search filename, path, tag or content…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear search"
              onClick={() => {
                setQ("");
                setParams({});
              }}
            >
              <X size={14} />
            </button>
          )}
        </form>
        <select
          aria-label="Filter by device"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
        >
          <option value="">All devices</option>
          {data?.devices.map((d) => (
            <option value={d.id} key={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
        >
          <option value="">All services</option>
          {data?.services.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">All projects</option>
          {data?.projects.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="panel">
          {data?.configs.length ? (
            <>
              <div className="list-caption">
                <span>{data.configs.length} configuration files</span>
                <small>
                  <ShieldCheck size={13} />
                  Secret values are masked
                </small>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Configuration</th>
                      <th>Device</th>
                      <th>Format</th>
                      <th>Tags</th>
                      <th>Version</th>
                      <th>Updated</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.configs.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link to={`/configs/${c.id}`} className="file-cell">
                            <span className="file-icon">
                              <FileCode2 size={19} />
                            </span>
                            <div>
                              <strong>
                                {c.name}
                                {c.has_secrets && (
                                  <LockKeyhole
                                    className="inline-icon"
                                    size={12}
                                  />
                                )}
                              </strong>
                              <small className="monospace">{c.path}</small>
                            </div>
                          </Link>
                        </td>
                        <td>
                          <Link
                            className="device-link"
                            to={`/devices/${c.device_id}`}
                          >
                            {c.device_name}
                          </Link>
                        </td>
                        <td>
                          <Tag>{c.format}</Tag>
                        </td>
                        <td>
                          <div className="tags">
                            {c.tags?.slice(0, 2).map((t) => (
                              <Tag key={t}>{t}</Tag>
                            ))}
                            {c.tags?.length > 2 && (
                              <Tag>+{c.tags.length - 2}</Tag>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="version-pill">v{c.version}</span>
                        </td>
                        <td className="muted">{relative(c.updated_at)}</td>
                        <td>
                          <Link
                            to={`/configs/${c.id}`}
                            className="icon-button"
                            aria-label={`Open ${c.name}`}
                          >
                            <ChevronRight size={16} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty
              title={
                q || deviceId || serviceId || projectId
                  ? "No configurations found"
                  : "Your configurations belong here"
              }
              description={
                q || deviceId || serviceId || projectId
                  ? "Try another search or adjust the filters."
                  : "Import a file or paste a configuration. Its complete version history starts with the first save."
              }
              action={
                !q &&
                user.role !== "viewer" && (
                  <Link to="/import" className="button primary">
                    <Upload size={16} />
                    Import first configuration
                  </Link>
                )
              }
            />
          )}
        </div>
      )}
      {adding && (
        <ConfigForm
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            changed();
            notify("Configuration created with Version 1.");
          }}
        />
      )}
    </>
  );
}
export function ConfigForm({
  onClose,
  onDone,
  deviceId,
  template,
}: {
  onClose: () => void;
  onDone: () => void;
  deviceId?: number;
  template?: Template;
}) {
  const { user } = useVault();
  const [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [device, setDevice] = useState(deviceId ? String(deviceId) : ""),
    [service, setService] = useState(""),
    [project, setProject] = useState(""),
    [format, setFormat] = useState(template?.format || "text"),
    [tags, setTags] = useState(""),
    [policy, setPolicy] = useState("manual"),
    [content, setContent] = useState(template?.content || "");
  const [templateLoading, setTemplateLoading] = useState(false),
    [templateError, setTemplateError] = useState<unknown>();
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        api<Device[]>("/devices"),
        api<Group[]>("/services"),
        api<Group[]>("/projects"),
      ]).then(([devices, services, projects]) => ({
        devices,
        services,
        projects,
      })),
    [],
  );
  return (
    <Modal
      wide
      title={template ? `Use template: ${template.name}` : "New configuration"}
      description="Save a file in your vault and start its version history."
      onClose={onClose}
    >
      <AsyncForm
        cancel={onClose}
        submit="Create configuration"
        onSubmit={async () => {
          if (!device) throw new Error("Select an existing device first.");
          if (template && content.includes("••"))
            throw new Error(
              "Reveal the template or replace masked values before saving.",
            );
          await post("/configs", {
            name,
            path,
            device_id: Number(device),
            service_id: service ? Number(service) : null,
            project_id: project ? Number(project) : null,
            format,
            content,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            policy,
            message: "Initial configuration",
          });
          onDone();
        }}
      >
        <ErrorNotice error={error} />
        {loading ? (
          <Loading />
        ) : !data?.devices.length ? (
          <Notice>
            Add a device before creating a configuration.{" "}
            <Link to="/devices?add=true">Add first device</Link>
          </Notice>
        ) : (
          <>
            <div className="form-grid">
              <Field label="Filename" required>
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!template) setFormat(detectFormat(e.target.value));
                  }}
                  placeholder="nginx.conf"
                  required
                />
              </Field>
              <Field label="Source path" required>
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/etc/nginx/nginx.conf"
                  required
                />
              </Field>
              <Field label="Device" required>
                <select
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  required
                >
                  <option value="">Select device</option>
                  {data.devices.map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
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
              <Field label="Service">
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  <option value="">None</option>
                  {data.services.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Project">
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">None</option>
                  {data.projects.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sync policy">
                <select
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                >
                  {policies.map((p) => (
                    <option value={p.value} key={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tags" hint="Separate tags with commas.">
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="production, network"
                />
              </Field>
            </div>
            <div className="editor-label">
              <span>File contents</span>
              <span>{format}</span>
            </div>
            {template && content.includes("••") && (
              <Notice kind="warning">
                Secret values in this template are hidden. Replace the
                placeholders before creating a file. An administrator can reveal
                the original template values.
                <Button
                  disabled={user?.role !== "admin"}
                  busy={templateLoading}
                  icon={<Eye size={14} />}
                  onClick={async () => {
                    setTemplateLoading(true);
                    try {
                      const actual = await api<Template>(
                        `/templates/${template.id}?reveal=true`,
                      );
                      setContent(actual.content);
                    } catch (e) {
                      setTemplateError(e);
                    } finally {
                      setTemplateLoading(false);
                    }
                  }}
                >
                  Reveal template values
                </Button>
              </Notice>
            )}
            <ErrorNotice error={templateError} />
            <CodeEditor
              value={content}
              onChange={setContent}
              format={format}
              height="300px"
            />
            <Notice>
              Potential secrets are detected and masked in the interface by
              default.
            </Notice>
          </>
        )}
      </AsyncForm>
    </Modal>
  );
}
export function ConfigDetail() {
  const { id } = useParams(),
    navigate = useNavigate(),
    { refresh, changed, notify, user } = useVault();
  const [tab, setTab] = useState("content"),
    [editing, setEditing] = useState(false),
    [revealed, setRevealed] = useState(false),
    [draft, setDraft] = useState(""),
    [changeMessage, setChangeMessage] = useState(""),
    [busy, setBusy] = useState(""),
    [actionError, setActionError] = useState<unknown>(),
    [validation, setValidation] = useState<{ valid: boolean; errors: any[] }>(),
    [restoreVersion, setRestoreVersion] = useState<number>(),
    [settings, setSettings] = useState(false),
    [deleting, setDeleting] = useState(false),
    [applying, setApplying] = useState(false),
    [conflict, setConflict] = useState(false),
    [left, setLeft] = useState(1),
    [right, setRight] = useState(1);
  const { data, error, loading, reload } = useLoad(
    () =>
      Promise.all([
        api<Config>(`/configs/${id}?reveal=${revealed}`),
        api<Version[]>(`/configs/${id}/versions`),
      ]).then(([config, versions]) => ({ config, versions })),
    [id, refresh, revealed],
  );
  useEffect(() => {
    if (data && !editing) {
      setDraft(data.config.content || "");
      setRight(data.config.version);
      setLeft(Math.max(1, data.config.version - 1));
    }
  }, [data, editing]);
  const diff = useLoad(
    () =>
      tab === "compare"
        ? api<any>(`/configs/${id}/diff?left=${left}&right=${right}`)
        : Promise.resolve(null),
    [id, tab, left, right, refresh],
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return null;
  const { config, versions } = data;
  const writable = user.role !== "viewer";
  const reveal = async () => {
    setBusy("reveal");
    setActionError(undefined);
    try {
      const fresh = await api<Config>(`/configs/${id}?reveal=true`);
      setDraft(fresh.content || "");
      setRevealed(true);
      notify(
        "Secret values revealed. This access was recorded in the audit log.",
      );
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy("");
    }
  };
  const startEditing = async () => {
    setActionError(undefined);
    if (config.has_secrets && !revealed) {
      setBusy("edit");
      try {
        const fresh = await api<Config>(`/configs/${id}?reveal=true`);
        setDraft(fresh.content || "");
        setRevealed(true);
        setEditing(true);
        setTab("content");
      } catch (e) {
        setActionError(e);
      } finally {
        setBusy("");
      }
    } else {
      setDraft(config.content || "");
      setEditing(true);
      setTab("content");
    }
  };
  const validate = async () => {
    setBusy("validate");
    setActionError(undefined);
    try {
      setValidation(
        await post("/validate", { format: config.format, content: draft }),
      );
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setActionError(undefined);
    try {
      const check = await post<{ valid: boolean; errors: any[] }>("/validate", {
        format: config.format,
        content: draft,
      });
      setValidation(check);
      if (!check.valid) throw new Error(check.errors.map(String).join("\n"));
      await patch(`/configs/${id}`, {
        content: draft,
        expected_version: config.version,
        message: changeMessage || "Updated configuration",
      });
      setEditing(false);
      setChangeMessage("");
      setRevealed(false);
      setValidation(undefined);
      changed();
      notify("A new version was saved to your vault.");
    } catch (e: any) {
      setActionError(e);
      if (e.status === 409)
        notify(
          "The file changed while you were editing. Copy your draft, reload and compare before saving.",
        );
    } finally {
      setBusy("");
    }
  };
  return (
    <>
      <Link to="/configs" className="back-link">
        <ArrowLeft size={14} />
        All configurations
      </Link>
      <PageHead
        eyebrow={`${config.device_name} / ${config.format.toUpperCase()}`}
        title={config.name}
        description={config.path}
        actions={
          editing ? (
            <>
              <Button
                onClick={() => {
                  setEditing(false);
                  setDraft(config.content || "");
                  setValidation(undefined);
                  setActionError(undefined);
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                icon={<Save size={16} />}
                busy={busy === "save"}
                onClick={save}
                disabled={draft === config.content}
              >
                Save version
              </Button>
            </>
          ) : (
            <>
              <a
                className="button"
                href={`/api/configs/${id}/download${revealed ? "?reveal=true" : ""}`}
                download
              >
                <Download size={16} />
                Download
              </a>
              {writable && (
                <Button
                  primary
                  icon={<Pencil size={16} />}
                  busy={busy === "edit"}
                  onClick={startEditing}
                >
                  Edit configuration
                </Button>
              )}
            </>
          )
        }
      />
      <div className="config-meta-bar">
        <Link to={`/devices/${config.device_id}`}>
          <ServerIcon />
          {config.device_name}
        </Link>
        <span>
          <FileCode2 size={14} />
          {config.format}
        </span>
        <span>
          <Clock3 size={14} />
          Changed {relative(config.updated_at)}
        </span>
        <span className="version-pill">Version {config.version}</span>
        {config.has_secrets && (
          <Tag>
            <LockKeyhole size={12} />
            Secrets detected
          </Tag>
        )}
        <div className="meta-spacer" />
        <Button
          icon={<Settings2 size={15} />}
          onClick={() => setSettings(true)}
          disabled={!writable}
        >
          File settings
        </Button>
      </div>
      {config.conflict && (
        <Notice kind="warning">
          <strong>Configuration conflict.</strong> Both the vault and the source
          changed. Review the two versions before applying anything.
          <Button onClick={() => setTab("remote")}>
            Review source conflict
          </Button>
        </Notice>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "content", label: "Contents" },
          {
            value: "history",
            label: "Version history",
            count: versions.length,
          },
          { value: "compare", label: "Compare versions" },
          { value: "remote", label: "Source & apply" },
        ]}
      />
      <ErrorNotice error={actionError} />
      {config.has_secrets && !revealed && (
        <div className="secret-banner">
          <LockKeyhole size={16} />
          <div>
            <strong>Potential secrets are hidden.</strong>
            <span>
              Revealing values requires edit access and is recorded in the audit
              log.
            </span>
          </div>
          {writable && (
            <Button
              icon={<Eye size={15} />}
              busy={busy === "reveal"}
              onClick={reveal}
            >
              Reveal values
            </Button>
          )}
        </div>
      )}
      {revealed && !editing && (
        <div className="secret-banner">
          <Eye size={16} />
          <div>
            <strong>Secret values are currently visible.</strong>
            <span>Hide them again when you are finished.</span>
          </div>
          <Button
            icon={<EyeOff size={15} />}
            onClick={() => setRevealed(false)}
          >
            Hide values
          </Button>
        </div>
      )}
      {tab === "content" ? (
        <section className="panel editor-panel">
          <div className="editor-toolbar">
            <div>
              <FileCode2 size={15} />
              <span>{config.name}</span>
              <Tag>{config.format}</Tag>
              {editing && <Tag>Editing</Tag>}
            </div>
            <div>
              {editing && (
                <Button
                  icon={<CheckCircle2 size={14} />}
                  busy={busy === "validate"}
                  onClick={validate}
                >
                  Validate
                </Button>
              )}
              <Button
                icon={<Copy size={14} />}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      editing ? draft : config.content || "",
                    );
                    notify("Configuration copied.");
                  } catch {
                    setActionError(
                      new Error(
                        "Clipboard access was denied by your browser. Select and copy the text directly.",
                      ),
                    );
                  }
                }}
              >
                Copy
              </Button>
            </div>
          </div>
          <CodeEditor
            value={editing ? draft : config.content || ""}
            onChange={setDraft}
            readOnly={!editing}
            format={config.format}
            height="520px"
          />
          {editing && (
            <div className="editor-save-note">
              <Field
                label="What changed?"
                hint="A short note makes the history easier to understand."
              >
                <input
                  value={changeMessage}
                  onChange={(e) => setChangeMessage(e.target.value)}
                  placeholder="Changed proxy timeout"
                />
              </Field>
              <Notice>
                Saving creates a new vault version. Use Source & apply to update
                the device explicitly.
              </Notice>
            </div>
          )}
          {validation && (
            <div
              className={`validation-result ${validation.valid ? "valid" : "invalid"}`}
            >
              <CheckCircle2 size={17} />
              <strong>
                {validation.valid
                  ? "Basic format validation passed"
                  : "Validation failed"}
              </strong>
              {validation.errors?.map((e, i) => (
                <div key={i}>
                  {typeof e === "string" ? e : JSON.stringify(e)}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : tab === "history" ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Every version, preserved.</h2>
              <p>
                Restoring creates a new version. Existing history is never
                rewritten.
              </p>
            </div>
            <History size={20} />
          </div>
          <div className="version-list">
            {versions.map((v) => (
              <div className="version-row" key={v.number}>
                <div
                  className={`version-point ${v.number === config.version ? "current" : ""}`}
                />
                <div className="version-main">
                  <div>
                    <strong>Version {v.number}</strong>
                    {v.number === config.version && <Tag>Current</Tag>}
                  </div>
                  <p>{v.message || "Configuration updated"}</p>
                  <small>
                    {v.actor} · {date(v.created_at)}
                  </small>
                </div>
                <div className="head-actions">
                  <Button
                    icon={<GitCompareArrows size={14} />}
                    onClick={() => {
                      setLeft(v.number);
                      setRight(config.version);
                      setTab("compare");
                    }}
                  >
                    Compare
                  </Button>
                  {writable && v.number !== config.version && (
                    <Button
                      icon={<RotateCcw size={14} />}
                      onClick={() => setRestoreVersion(v.number)}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : tab === "compare" ? (
        <>
          <div className="compare-selectors">
            <Field label="Previous version">
              <select
                value={left}
                onChange={(e) => setLeft(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option value={v.number} key={v.number}>
                    Version {v.number} — {v.message}
                  </option>
                ))}
              </select>
            </Field>
            <GitCompareArrows size={21} />
            <Field label="Compare with">
              <select
                value={right}
                onChange={(e) => setRight(Number(e.target.value))}
              >
                {versions.map((v) => (
                  <option value={v.number} key={v.number}>
                    Version {v.number} —{" "}
                    {v.number === config.version ? "Current" : v.message}
                  </option>
                ))}
              </select>
            </Field>
            {writable && left !== config.version && (
              <Button
                icon={<RotateCcw size={14} />}
                onClick={() => setRestoreVersion(left)}
              >
                Restore v{left}
              </Button>
            )}
          </div>
          <ErrorNotice error={diff.error} onRetry={diff.reload} />
          {diff.loading ? (
            <Loading text="Comparing versions…" />
          ) : (
            diff.data && (
              <>
                {diff.data.has_hidden_changes && (
                  <Notice kind="warning">
                    These versions contain changes to secret values. Their
                    actual values are hidden in this comparison.
                  </Notice>
                )}
                <DiffViewer
                  left={diff.data.left_content}
                  right={diff.data.right_content}
                  leftLabel={`Version ${left}`}
                  rightLabel={`Version ${right}${right === config.version ? " · Current" : ""}`}
                />
              </>
            )
          )}
        </>
      ) : (
        <RemoteSource
          config={config}
          onApply={() => setApplying(true)}
          onConflict={() => setConflict(true)}
        />
      )}
      {restoreVersion !== undefined && (
        <RestorePreview
          config={config}
          version={restoreVersion}
          onClose={() => setRestoreVersion(undefined)}
          onDone={() => {
            setRestoreVersion(undefined);
            setRevealed(false);
            changed();
            notify(`Version ${restoreVersion} restored as a new version.`);
          }}
        />
      )}
      {settings && (
        <ConfigSettings
          config={config}
          onClose={() => setSettings(false)}
          onDone={() => {
            setSettings(false);
            changed();
            notify("File settings saved.");
          }}
          onDelete={() => {
            setSettings(false);
            setDeleting(true);
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete this configuration?"
          description={
            <>
              Delete <strong>{config.name}</strong> and its saved versions? This
              cannot be undone. Saved snapshots may prevent deletion.
            </>
          }
          danger
          label="Delete configuration"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await remove(`/configs/${id}`);
            changed();
            navigate("/configs");
          }}
        />
      )}
      {applying && (
        <ApplyPreview
          config={config}
          onClose={() => setApplying(false)}
          onDone={() => {
            setApplying(false);
            changed();
            notify("Configuration applied to the source device.");
          }}
        />
      )}
      {conflict && (
        <ResolveConflict
          config={config}
          onClose={() => setConflict(false)}
          onDone={() => {
            setConflict(false);
            setRevealed(false);
            changed();
            notify(
              "Conflict resolved. The operation was recorded in the audit log.",
            );
          }}
        />
      )}
    </>
  );
}
function ServerIcon() {
  return <Folder size={14} />;
}
export function RestorePreview({
  config,
  version,
  onClose,
  onDone,
}: {
  config: Config;
  version: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data, error, loading } = useLoad(
    () =>
      api<any>(
        `/configs/${config.id}/diff?left=${config.version}&right=${version}`,
      ),
    [config.id, version],
  );
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<unknown>();
  return (
    <Modal
      wide
      title={`Restore Version ${version}`}
      description={`Review the exact change from current Version ${config.version}. Restoration creates a new version.`}
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={error} />
        {loading ? (
          <Loading />
        ) : (
          data && (
            <>
              {data.has_hidden_changes && (
                <Notice kind="warning">
                  This restore changes hidden secret values. They remain masked
                  in the preview.
                </Notice>
              )}
              <DiffViewer
                left={data.left_content || ""}
                right={data.right_content || ""}
                leftLabel={`Current · Version ${config.version}`}
                rightLabel={`Restore · Version ${version}`}
              />
            </>
          )
        )}
        <Notice>
          Newer history stays intact. This restores the vault file; applying it
          to a device is a separate, explicit action.
        </Notice>
        <ErrorNotice error={actionError} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary
          icon={<RotateCcw size={16} />}
          busy={busy}
          disabled={loading || !!error}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/configs/${config.id}/restore`, {
                version,
                expected_version: config.version,
              });
              onDone();
            } catch (e) {
              setActionError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm restore
        </Button>
      </div>
    </Modal>
  );
}
function ConfigSettings({
  config,
  onClose,
  onDone,
  onDelete,
}: {
  config: Config;
  onClose: () => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const { user } = useVault();
  const [tags, setTags] = useState(config.tags.join(", ")),
    [policy, setPolicy] = useState(config.policy),
    [project, setProject] = useState(
      config.project_id ? String(config.project_id) : "",
    ),
    [service, setService] = useState(
      config.service_id ? String(config.service_id) : "",
    );
  const groups = useLoad(
    () => Promise.all([api<Group[]>("/projects"), api<Group[]>("/services")]),
    [],
  );
  return (
    <Modal title="Configuration settings" onClose={onClose}>
      <AsyncForm
        cancel={onClose}
        submit="Save settings"
        onSubmit={async () => {
          await patch(`/configs/${config.id}`, {
            expected_version: config.version,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
            policy,
            project_id: project ? Number(project) : null,
            service_id: service ? Number(service) : null,
          });
          onDone();
        }}
      >
        <Field label="Tags" hint="Separate tags with commas.">
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </Field>
        <Field label="Sync policy">
          <select value={policy} onChange={(e) => setPolicy(e.target.value)}>
            {policies.map((p) => (
              <option value={p.value} key={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Notice>
          Push / pull permits explicitly approved remote updates. Other policies
          never permit a remote apply.
        </Notice>
        <div className="form-grid">
          <Field label="Project">
            <select
              value={project}
              onChange={(e) => setProject(e.target.value)}
            >
              <option value="">None</option>
              {groups.data?.[0].map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Service">
            <select
              value={service}
              onChange={(e) => setService(e.target.value)}
            >
              <option value="">None</option>
              {groups.data?.[1].map((g) => (
                <option value={g.id} key={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorNotice error={groups.error} />
        {user.role === "admin" && (
          <Button danger icon={<Trash2 size={14} />} onClick={onDelete}>
            Delete configuration
          </Button>
        )}
      </AsyncForm>
    </Modal>
  );
}
function RemoteSource({
  config,
  onApply,
  onConflict,
}: {
  config: Config;
  onApply: () => void;
  onConflict: () => void;
}) {
  const { user } = useVault();
  const { data, error, loading, reload } = useLoad(
    () => api<Device>(`/devices/${config.device_id}`),
    [config.device_id],
  );
  const [remote, setRemote] = useState<any>(),
    [busy, setBusy] = useState(false),
    [remoteError, setRemoteError] = useState<unknown>();
  if (loading) return <Loading />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (data?.connection === "manual")
    return (
      <div className="panel">
        <Empty
          title="Manually managed file"
          description="This file is stored and versioned in your vault. Download it to transfer it to the device, or configure a source connection on the device page."
          action={
            <Link className="button" to={`/devices/${config.device_id}`}>
              View device
              <ArrowUpRight size={15} />
            </Link>
          }
        />
      </div>
    );
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Source configuration</h2>
          <p>
            The vault and source are checked independently before any apply.
          </p>
        </div>
        <Button
          icon={<RefreshCw size={15} />}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setRemoteError(undefined);
            try {
              setRemote(await api(`/configs/${config.id}/remote`));
            } catch (e) {
              setRemoteError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Check source
        </Button>
      </div>
      <div className="panel-body">
        <div className="metadata-grid">
          <div>
            <span>Source device</span>
            <strong>{data?.name}</strong>
          </div>
          <div>
            <span>Path</span>
            <strong className="monospace">{config.path}</strong>
          </div>
          <div>
            <span>Policy</span>
            <strong>
              {policies.find((p) => p.value === config.policy)?.label}
            </strong>
          </div>
          <div>
            <span>Vault version</span>
            <strong>Version {config.version}</strong>
          </div>
        </div>
        <ErrorNotice error={remoteError} />
        {remote && (
          <>
            <div className="source-status">
              <Status
                value={
                  remote.conflict
                    ? "Conflict"
                    : remote.hash === config.remote_hash
                      ? "In sync"
                      : "Changes detected"
                }
              />
              {remote.conflict && user.role !== "viewer" && (
                <Button primary onClick={onConflict}>
                  Resolve conflict
                </Button>
              )}
            </div>
            <DiffViewer
              left={remote.content || ""}
              right={config.content || ""}
              leftLabel="Source device"
              rightLabel={`Vault · Version ${config.version}`}
            />
          </>
        )}
        <Notice>
          Apply checks the source fingerprint again, validates the configuration
          and preserves the previous state. A changed source requires a conflict
          review.
        </Notice>
        {user.role !== "viewer" && (
          <Button
            primary
            icon={<ArrowUpRight size={16} />}
            onClick={onApply}
            disabled={config.policy !== "push_pull"}
          >
            Review & apply to device
          </Button>
        )}
        {config.policy !== "push_pull" && (
          <small className="muted">
            Choose Push / pull in file settings to allow explicit apply.
          </small>
        )}
      </div>
    </section>
  );
}
function ApplyPreview({
  config,
  onClose,
  onDone,
}: {
  config: Config;
  onClose: () => void;
  onDone: () => void;
}) {
  const result = useLoad(
    () =>
      Promise.all([
        api<any>(`/configs/${config.id}/remote`),
        api<any>(`/configs/${config.id}/hooks`),
      ]),
    [config.id],
  );
  const [runHook, setRunHook] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const remote = result.data?.[0],
    hook = result.data?.[1];
  return (
    <Modal
      wide
      title="Review device apply"
      description={`${config.device_name} · ${config.path}`}
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={result.error} />
        {result.loading ? (
          <Loading text="Checking source before apply…" />
        ) : (
          remote && (
            <>
              <DiffViewer
                left={remote.content}
                right={config.content || ""}
                leftLabel="Source before apply"
                rightLabel={`Vault · Version ${config.version}`}
              />
              {remote.conflict ? (
                <Notice kind="warning">
                  The source and vault both changed. Close this dialog and
                  resolve the conflict explicitly.
                </Notice>
              ) : (
                <Notice>
                  The source is rechecked before writing. If it changed after
                  this preview, the apply is rejected.
                </Notice>
              )}
              {hook?.enabled && (
                <label className="check-row hook-confirm">
                  <input
                    type="checkbox"
                    checked={runHook}
                    onChange={(e) => setRunHook(e.target.checked)}
                  />
                  <div>
                    <strong>Also execute the configured hook</strong>
                    <small className="monospace">
                      {(hook.commands?.[hook.command] || hook.command).replace(
                        "{path}",
                        `'${config.path.replaceAll("'", "'\\''")}'`,
                      )}
                    </small>
                  </div>
                </label>
              )}
            </>
          )
        )}
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary
          disabled={!remote || remote.conflict || !!result.error}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/configs/${config.id}/apply`, {
                expected_version: config.version,
                expected_remote_hash: remote.hash,
                run_hook: runHook,
              });
              onDone();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm apply{runHook ? " & run hook" : ""}
        </Button>
      </div>
    </Modal>
  );
}
function ResolveConflict({
  config,
  onClose,
  onDone,
}: {
  config: Config;
  onClose: () => void;
  onDone: () => void;
}) {
  const remote = useLoad(
    () => api<any>(`/configs/${config.id}/remote`),
    [config.id],
  );
  const [sourceRevealed, setSourceRevealed] = useState(false),
    [sourceContent, setSourceContent] = useState<string>(),
    [strategy, setStrategy] = useState("remote"),
    [manual, setManual] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [revealed, setRevealed] = useState(false);
  return (
    <Modal
      wide
      title="Configuration conflict"
      description="Both copies may contain changes. Review them and choose the desired result."
      onClose={onClose}
    >
      <div className="modal-body">
        <ErrorNotice error={remote.error} />
        {remote.loading ? (
          <Loading />
        ) : (
          remote.data && (
            <>
              <div className="selection-toolbar">
                <strong>Source configuration</strong>
                <Button
                  busy={busy}
                  icon={
                    sourceRevealed ? <EyeOff size={14} /> : <Eye size={14} />
                  }
                  onClick={async () => {
                    if (sourceRevealed) {
                      setSourceContent(undefined);
                      setSourceRevealed(false);
                      return;
                    }
                    setBusy(true);
                    try {
                      const actual = await api<any>(
                        `/configs/${config.id}/remote?reveal=true`,
                      );
                      if (actual.hash !== remote.data.hash)
                        throw new Error(
                          "The source changed while reviewing. Close and reopen this conflict.",
                        );
                      setSourceContent(actual.content);
                      setSourceRevealed(true);
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {sourceRevealed
                    ? "Hide source secrets"
                    : "Reveal source values"}
                </Button>
              </div>
              <DiffViewer
                left={sourceContent ?? remote.data.content}
                right={config.content || ""}
                leftLabel={
                  sourceRevealed ? "Source device · Revealed" : "Source device"
                }
                rightLabel={`Vault · Version ${config.version}`}
              />
            </>
          )
        )}
        <div className="conflict-choices">
          {[
            {
              value: "remote",
              label: "Keep source",
              text: "Save the source file as a new vault version.",
            },
            {
              value: "vault",
              label: "Keep vault",
              text: "Explicitly overwrite the source with this vault version.",
            },
            {
              value: "manual",
              label: "Merge manually",
              text: "Write the full desired file, then save and apply it.",
            },
          ].map((option) => (
            <label
              className={strategy === option.value ? "selected" : ""}
              key={option.value}
            >
              <input
                type="radio"
                name="resolution"
                checked={strategy === option.value}
                disabled={
                  option.value !== "remote" && config.policy !== "push_pull"
                }
                onChange={() => setStrategy(option.value)}
              />
              <strong>{option.label}</strong>
              <small>{option.text}</small>
            </label>
          ))}
        </div>
        {config.policy !== "push_pull" && (
          <Notice>
            Applying a vault copy or manual merge requires the Push / pull
            policy. Close this dialog and change the policy in File settings to
            permit an explicit source update.
          </Notice>
        )}
        {strategy === "manual" && (
          <>
            {!revealed ? (
              <Button
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await api<Config>(
                      `/configs/${config.id}?reveal=true`,
                    );
                    setManual(result.content || "");
                    setRevealed(true);
                  } catch (e) {
                    setError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Load vault contents for manual merge
              </Button>
            ) : (
              <CodeEditor
                value={manual}
                onChange={setManual}
                format={config.format}
                height="300px"
              />
            )}
            <Notice>
              Enter the complete file, including any secret values. Masked
              placeholders must never be applied to the device.
            </Notice>
          </>
        )}
        <Notice kind={strategy === "remote" ? "info" : "warning"}>
          {strategy === "remote"
            ? "The source file is preserved. Its contents become a new vault version."
            : "This choice updates the source device. Its fingerprint is checked again before writing."}
        </Notice>
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary
          disabled={
            !remote.data ||
            !!remote.error ||
            (strategy === "manual" && !revealed)
          }
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              if (strategy === "manual" && manual.includes("••"))
                throw new Error(
                  "Replace all masked placeholders with actual values before applying.",
                );
              await post(`/configs/${config.id}/resolve`, {
                strategy,
                content: strategy === "manual" ? manual : undefined,
                expected_version: config.version,
                expected_remote_hash: remote.data.hash,
              });
              onDone();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Confirm resolution
        </Button>
      </div>
    </Modal>
  );
}
export function ImportPage() {
  const { refresh, changed, notify, user } = useVault(),
    [params] = useSearchParams();
  const [mode, setMode] = useState("paste"),
    [device, setDevice] = useState(params.get("device") || ""),
    [service, setService] = useState(""),
    [project, setProject] = useState(""),
    [policy, setPolicy] = useState("manual"),
    [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [content, setContent] = useState(""),
    [format, setFormat] = useState("text"),
    [files, setFiles] = useState<File[]>([]),
    [basePath, setBasePath] = useState("/"),
    [remote, setRemote] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const inputRef = useRef<HTMLInputElement>(null);
  const groups = useLoad(
    () =>
      Promise.all([
        api<Device[]>("/devices"),
        api<Group[]>("/services"),
        api<Group[]>("/projects"),
      ]),
    [refresh],
  );
  const selectedDevice = groups.data?.[0].find((d) => d.id === Number(device));
  if (user.role === "viewer")
    return (
      <Empty
        title="Editing access required"
        description="Importing configurations requires the Editor or Admin role."
      />
    );
  return (
    <>
      <PageHead
        eyebrow="BRING YOUR FILES HOME"
        title="Import configurations"
        description="Paste a file, upload a folder, or pull selected configurations from a device."
      />
      <Tabs
        value={mode}
        onChange={(v) => {
          setMode(v);
          setFiles([]);
          setError(undefined);
        }}
        items={[
          { value: "paste", label: "Paste text" },
          { value: "files", label: "Files" },
          { value: "folder", label: "Folder" },
          { value: "archive", label: "ZIP / TAR" },
          { value: "remote", label: "Device source" },
        ]}
      />
      <div className="import-layout">
        <section className="panel import-main">
          <div className="panel-head">
            <div>
              <h2>
                {mode === "paste"
                  ? "Start with a configuration"
                  : mode === "remote"
                    ? "Import directly from a device"
                    : mode === "folder"
                      ? "Choose a configuration folder"
                      : mode === "archive"
                        ? "Upload a configuration archive"
                        : "Upload configuration files"}
              </h2>
              <p>
                {mode === "paste"
                  ? "The original contents become Version 1."
                  : mode === "remote"
                    ? "Local or SSH. Read only from explicitly allowed paths."
                    : "Filenames and folder structure are preserved."}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <ErrorNotice error={groups.error} />
            {!groups.loading && !groups.data?.[0].length && (
              <Notice>
                Create a device first.{" "}
                <Link to="/devices?add=true">Add your first device</Link>
              </Notice>
            )}
            <div className="form-grid">
              <Field label="Target device" required>
                <select
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  required
                >
                  <option value="">Select a device</option>
                  {groups.data?.[0].map((d) => (
                    <option value={d.id} key={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sync policy">
                <select
                  value={policy}
                  onChange={(e) => setPolicy(e.target.value)}
                >
                  {policies.map((p) => (
                    <option value={p.value} key={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Service">
                <select
                  value={service}
                  onChange={(e) => setService(e.target.value)}
                >
                  <option value="">None</option>
                  {groups.data?.[1].map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Project">
                <select
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                >
                  <option value="">None</option>
                  {groups.data?.[2].map((g) => (
                    <option value={g.id} key={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {mode === "paste" ? (
              <>
                <div className="form-grid">
                  <Field label="Filename" required>
                    <input
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setFormat(detectFormat(e.target.value));
                      }}
                      placeholder="nginx.conf"
                      required
                    />
                  </Field>
                  <Field label="Original path" required>
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      placeholder="/etc/nginx/nginx.conf"
                      required
                    />
                  </Field>
                </div>
                <div className="editor-label">
                  <strong>Configuration contents</strong>
                  <select
                    aria-label="Configuration format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    {formats.map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <CodeEditor
                  value={content}
                  onChange={setContent}
                  format={format}
                  height="350px"
                />
              </>
            ) : mode === "remote" ? (
              <>
                <Notice>
                  SSH credentials are encrypted. Server identity must be pinned
                  and tested in the device Connection tab before importing.
                </Notice>
                {selectedDevice?.connection === "manual" ? (
                  <Empty
                    title="This device uses manual import"
                    description="Choose Paste, Files, Folder or Archive, or configure its local or SSH connection."
                    action={
                      <Link className="button" to={`/devices/${device}`}>
                        Configure connection
                      </Link>
                    }
                  />
                ) : (
                  <div className="source-import">
                    <Folder size={32} />
                    <h3>Select source configurations</h3>
                    <p>
                      Browse configuration directories on{" "}
                      {selectedDevice?.name || "your selected device"} and
                      choose the files you need.
                    </p>
                    <Button
                      primary
                      disabled={!selectedDevice}
                      onClick={() => setRemote(true)}
                      icon={<Search size={16} />}
                    >
                      Browse source files
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <>
                <Field
                  label="Original base path"
                  hint="This prefix is combined with each uploaded file's relative path."
                >
                  <input
                    value={basePath}
                    onChange={(e) => setBasePath(e.target.value)}
                    placeholder="/etc/nginx"
                  />
                </Field>
                <input
                  key={mode}
                  ref={inputRef}
                  type="file"
                  className="visually-hidden"
                  multiple={mode !== "archive"}
                  accept={
                    mode === "archive" ? ".zip,.tar,.tar.gz,.tgz" : undefined
                  }
                  {...(mode === "folder"
                    ? ({ webkitdirectory: "", directory: "" } as any)
                    : {})}
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
                <button
                  className="upload-zone"
                  onClick={() => inputRef.current?.click()}
                >
                  <span className="round-icon">
                    <Upload size={28} />
                  </span>
                  <strong>
                    {files.length
                      ? `${files.length} ${files.length === 1 ? "file" : "files"} selected`
                      : `Choose ${mode === "folder" ? "a folder" : mode === "archive" ? "a ZIP or TAR archive" : "configuration files"}`}
                  </strong>
                  <span>Click to browse your computer</span>
                  <small>
                    {mode === "archive"
                      ? "Archives are safely extracted on your server."
                      : "Only text configuration files are imported."}
                  </small>
                </button>
                {files.length > 0 && (
                  <div className="upload-files">
                    {files.map((file, i) => (
                      <div key={`${file.name}-${i}`}>
                        <FileCode2 size={15} />
                        <span>{file.webkitRelativePath || file.name}</span>
                        <small>{bytes(file.size)}</small>
                        <button
                          className="icon-button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setFiles(files.filter((_, j) => j !== i))
                          }
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <ErrorNotice error={error} />
            {mode !== "remote" && (
              <div className="import-actions">
                <Button
                  primary
                  busy={busy}
                  icon={<Upload size={16} />}
                  disabled={
                    !device ||
                    (mode === "paste"
                      ? !name || !path || !content
                      : !files.length)
                  }
                  onClick={async () => {
                    setBusy(true);
                    setError(undefined);
                    try {
                      if (mode === "paste")
                        await post("/configs", {
                          name,
                          path,
                          device_id: Number(device),
                          service_id: service ? Number(service) : null,
                          project_id: project ? Number(project) : null,
                          policy,
                          format,
                          content,
                          tags: [],
                          message: "Initial import",
                        });
                      else {
                        const form = new FormData();
                        for (const file of files)
                          form.append(
                            "files",
                            file,
                            file.webkitRelativePath || file.name,
                          );
                        form.append("device_id", device);
                        form.append("policy", policy);
                        form.append("base_path", basePath);
                        if (service) form.append("service_id", service);
                        if (project) form.append("project_id", project);
                        await api("/import/files", {
                          method: "POST",
                          body: form,
                        });
                      }
                      changed();
                      notify("Configurations imported successfully.");
                      setFiles([]);
                      setContent("");
                      setName("");
                      setPath("");
                    } catch (e) {
                      setError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Import {mode === "paste" ? "configuration" : "selected files"}
                </Button>
              </div>
            )}
          </div>
        </section>
        <aside className="import-aside">
          <div className="panel">
            <div className="panel-body">
              <ShieldCheck size={25} />
              <h3>A safe starting point.</h3>
              <p>
                Import reads your files and creates vault versions. It does not
                change the source.
              </p>
              <div className="import-tips">
                <span>
                  <CheckCircle2 size={16} />
                  Automatic format detection
                </span>
                <span>
                  <CheckCircle2 size={16} />
                  Secret values masked by default
                </span>
                <span>
                  <CheckCircle2 size={16} />
                  Every future change versioned
                </span>
                <span>
                  <CheckCircle2 size={16} />
                  No external services involved
                </span>
              </div>
            </div>
          </div>
          <div className="help-note">
            <strong>Working with a remote device?</strong>
            <p>
              Set a connection, verify the host identity, and limit the allowed
              directories before importing.
            </p>
            <Link to="/devices" className="text-link">
              Manage devices
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </aside>
      </div>
      {remote && selectedDevice && (
        <RemoteBrowser
          device={selectedDevice}
          onClose={() => setRemote(false)}
          onDone={() => {
            setRemote(false);
            changed();
            notify("Selected source configurations imported.");
          }}
        />
      )}
    </>
  );
}
