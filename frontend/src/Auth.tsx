import { useState } from "react";
import {
  Archive,
  ArrowRight,
  Check,
  CheckCircle2,
  FileCode2,
  LockKeyhole,
  Server,
  ShieldCheck,
  Clock3,
} from "lucide-react";
import {
  api,
  post,
  patch,
  type User,
  type Device,
  detectFormat,
  setCsrf,
} from "./api";
import {
  AsyncForm,
  Button,
  CodeEditor,
  ErrorNotice,
  Field,
  Notice,
} from "./components";
import { Brand } from "./App";
export function Login({
  onComplete,
}: {
  onComplete: (user: User, csrf: string) => void;
}) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  return (
    <div className="auth-page">
      <div className="auth-story">
        <div className="brand">
          <Brand />
        </div>
        <div className="auth-message">
          <div className="eyebrow">YOUR SYSTEMS. UNDER CONTROL.</div>
          <h1>
            A home for every
            <br />
            configuration.
          </h1>
          <p>
            Your devices, files and history in one private vault. Make changes
            with confidence. Return to what worked.
          </p>
          <div className="auth-features">
            <span>
              <Clock3 size={18} />
              Every version, remembered
            </span>
            <span>
              <ShieldCheck size={18} />
              Your infrastructure, your data
            </span>
            <span>
              <Archive size={18} />
              Recovery built in
            </span>
          </div>
        </div>
        <span className="auth-bottom">SELF-HOSTED · PRIVATE BY DESIGN</span>
      </div>
      <div className="auth-form-wrap">
        <div className="auth-card">
          <span className="round-icon">
            <LockKeyhole size={24} />
          </span>
          <h2>Welcome back.</h2>
          <p>Sign in to your Config Vault instance.</p>
          <AsyncForm
            submit="Sign in to vault"
            onSubmit={async () => {
              const result = await post<{ user: User; csrf: string }>(
                "/auth/login",
                { username, password },
              );
              onComplete(result.user, result.csrf);
            }}
          >
            <Field label="Username" required>
              <input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password" required>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </AsyncForm>
          <div className="auth-secure">
            <ShieldCheck size={14} />A secure session on your own server.
          </div>
        </div>
      </div>
    </div>
  );
}
export function Setup({
  onComplete,
}: {
  onComplete: (user: User, csrf: string) => void;
}) {
  const [step, setStep] = useState(0),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [instance, setInstance] = useState("My Config Vault"),
    [timezone, setTimezone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ),
    [backupHours, setBackupHours] = useState(24),
    [retention, setRetention] = useState(14),
    [session, setSession] = useState<{ user: User; csrf: string }>(),
    [device, setDevice] = useState<Device>(),
    [deviceName, setDeviceName] = useState(""),
    [deviceType, setDeviceType] = useState("Server"),
    [name, setName] = useState(""),
    [path, setPath] = useState(""),
    [content, setContent] = useState("");
  const titles = [
    "Welcome",
    "Create admin",
    "Your instance",
    "Backup plan",
    "First device",
    "First config",
    "Ready",
  ];
  return (
    <div className="setup-page">
      <div className="setup-top">
        <div className="brand">
          <Brand />
        </div>
        <span className="secure-label">
          <i />
          First-run setup
        </span>
      </div>
      <div className="setup-layout">
        <aside className="setup-steps">
          <div className="eyebrow">MAKE IT YOURS</div>
          <h2>
            A few steps.
            <br />A safer setup.
          </h2>
          {titles.map((title, i) => (
            <div
              className={`setup-step ${step === i ? "active" : step > i ? "done" : ""}`}
              key={title}
            >
              <span>{step > i ? <Check size={14} /> : i + 1}</span>
              <strong>{title}</strong>
            </div>
          ))}
        </aside>
        <section className="setup-card">
          {step === 0 ? (
            <>
              <span className="setup-hero-icon">
                <Archive size={42} />
              </span>
              <div className="eyebrow">WELCOME TO CONFIG VAULT</div>
              <h1>
                Bring your configs
                <br />
                together.
              </h1>
              <p className="setup-description">
                A private home for your servers, applications and system
                settings. Keep every version. Compare changes. Restore with
                confidence.
              </p>
              <div className="setup-values">
                <div>
                  <FileCode2 size={20} />
                  <strong>Organize</strong>
                  <span>Files grouped by the systems they belong to.</span>
                </div>
                <div>
                  <Clock3 size={20} />
                  <strong>Remember</strong>
                  <span>A clear history of every configuration change.</span>
                </div>
                <div>
                  <ShieldCheck size={20} />
                  <strong>Recover</strong>
                  <span>Safe restores, snapshots and encrypted backups.</span>
                </div>
              </div>
              <Button
                primary
                icon={<ArrowRight size={17} />}
                onClick={() => setStep(1)}
              >
                Set up your vault
              </Button>
            </>
          ) : step === 1 ? (
            <>
              <h1>Create your admin.</h1>
              <p>
                This account manages your instance and its access permissions.
              </p>
              <AsyncForm
                submit="Continue"
                onSubmit={async () => {
                  if (password.length < 12)
                    throw new Error(
                      "Use at least 12 characters for your administrator password.",
                    );
                  setStep(2);
                }}
              >
                <Field label="Admin username" required>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    minLength={3}
                  />
                </Field>
                <Field
                  label="Admin password"
                  required
                  hint="At least 12 characters. Use a unique password."
                >
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={12}
                    autoComplete="new-password"
                  />
                </Field>
              </AsyncForm>
            </>
          ) : step === 2 ? (
            <>
              <h1>Your own instance.</h1>
              <p>
                Choose a name and the timezone used for your backup schedule.
              </p>
              <AsyncForm
                submit="Create vault"
                onSubmit={async () => {
                  const result = await post<{ user: User; csrf: string }>(
                    "/setup",
                    { username, password, instance_name: instance, timezone },
                  );
                  setCsrf(result.csrf);
                  setSession(result);
                  setPassword("");
                  setStep(3);
                }}
              >
                <Field label="Instance name" required>
                  <input
                    value={instance}
                    onChange={(e) => setInstance(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Timezone" required>
                  <input
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    required
                    placeholder="Europe/Moscow"
                  />
                </Field>
                <Notice>
                  Storage is managed by your Docker data volume. The browser
                  cannot change server filesystem locations.
                </Notice>
              </AsyncForm>
            </>
          ) : step === 3 ? (
            <>
              <h1>A recovery plan.</h1>
              <p>
                Scheduled backups keep configurations, users and history
                together.
              </p>
              <AsyncForm
                submit="Save backup plan"
                onSubmit={async () => {
                  await patch("/settings", {
                    backup_interval_hours: backupHours,
                    backup_retention: retention,
                  });
                  setStep(4);
                }}
              >
                <div className="form-grid">
                  <Field label="Backup frequency">
                    <select
                      value={backupHours}
                      onChange={(e) => setBackupHours(Number(e.target.value))}
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
                      min={1}
                      max={365}
                      required
                      value={retention}
                      onChange={(e) => setRetention(Number(e.target.value))}
                    />
                  </Field>
                </div>
                <Notice>
                  Automatic backups are encrypted with your instance key. Keep a
                  copy of the key outside this server.
                </Notice>
              </AsyncForm>
            </>
          ) : step === 4 ? (
            <>
              <h1>Add your first device.</h1>
              <p>
                A device can be a physical server, a laptop, or a logical
                target.
              </p>
              <AsyncForm
                submit="Add device"
                onSubmit={async () => {
                  setDevice(
                    await post<Device>("/devices", {
                      name: deviceName,
                      type: deviceType,
                      connection: "manual",
                      connection_data: {},
                      host: "",
                      os: "",
                    }),
                  );
                  setStep(5);
                }}
              >
                <Field label="Device name" required>
                  <input
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    required
                    placeholder="Debian Home Server"
                  />
                </Field>
                <Field label="Device type">
                  <select
                    value={deviceType}
                    onChange={(e) => setDeviceType(e.target.value)}
                  >
                    {[
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
                    ].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Notice>
                  You can configure local filesystem or SSH access from the
                  device connection page after setup.
                </Notice>
              </AsyncForm>
              <Button className="setup-skip" onClick={() => setStep(6)}>
                Add a device later
              </Button>
            </>
          ) : step === 5 ? (
            <>
              <h1>Your first configuration.</h1>
              <p>
                Paste a configuration to start its version history on{" "}
                {device?.name}.
              </p>
              <AsyncForm
                submit="Import configuration"
                onSubmit={async () => {
                  await post("/configs", {
                    name,
                    path,
                    device_id: device?.id,
                    format: detectFormat(name),
                    content,
                    tags: [],
                    policy: "manual",
                    message: "Initial import",
                  });
                  setStep(6);
                }}
              >
                <div className="form-grid">
                  <Field label="Filename" required>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="nginx.conf"
                    />
                  </Field>
                  <Field label="Source path" required>
                    <input
                      value={path}
                      onChange={(e) => setPath(e.target.value)}
                      required
                      placeholder="/etc/nginx/nginx.conf"
                    />
                  </Field>
                </div>
                <Field label="File contents" required>
                  <textarea
                    rows={8}
                    className="monospace"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    required
                    placeholder="Paste configuration here…"
                  />
                </Field>
                <Notice>
                  Potential secret values are automatically masked in the
                  interface.
                </Notice>
              </AsyncForm>
              <Button className="setup-skip" onClick={() => setStep(6)}>
                Import later
              </Button>
            </>
          ) : (
            <>
              <span className="setup-hero-icon success">
                <CheckCircle2 size={42} />
              </span>
              <h1>Your vault is ready.</h1>
              <p className="setup-description">
                {instance} is configured. Add more devices, import
                configurations, and take your first snapshot.
              </p>
              <Button
                primary
                icon={<ArrowRight size={17} />}
                onClick={() => onComplete(session!.user, session!.csrf)}
              >
                Open dashboard
              </Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
