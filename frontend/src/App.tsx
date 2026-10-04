import { createContext, useContext, useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileCode2,
  FolderKanban,
  GitCompareArrows,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import {
  api,
  post,
  setCsrf,
  type User,
  type Dashboard,
  type Activity as ActivityType,
  date,
  relative,
} from "./api";
import {
  Button,
  Empty,
  ErrorNotice,
  Loading,
  PageHead,
  Status,
  useLoad,
} from "./components";
import { Login, Setup } from "./Auth";
import { Devices, DeviceDetail } from "./Devices";
import { Configurations, ConfigDetail, ImportPage } from "./Configs";
import {
  Snapshots,
  Compare,
  Backups,
  GroupsPage,
  UsersPage,
  SettingsPage,
} from "./Management";
interface VaultContext {
  user: User;
  refresh: number;
  changed: () => void;
  notify: (message: string) => void;
}
const Context = createContext<VaultContext>(null!);
export function useVault() {
  return useContext(Context);
}
const navigation = [
  { to: "/", name: "Dashboard", icon: LayoutDashboard },
  { to: "/devices", name: "Devices", icon: Server },
  { to: "/configs", name: "Configurations", icon: FileCode2 },
  { to: "/services", name: "Services", icon: FolderKanban },
  { to: "/snapshots", name: "Snapshots", icon: Clock3 },
  { to: "/compare", name: "Compare", icon: GitCompareArrows },
  { to: "/import", name: "Import", icon: Upload },
  { to: "/backups", name: "Backups", icon: Archive },
  { to: "/activity", name: "Activity", icon: Activity },
  { to: "/users", name: "Users", icon: Users },
  { to: "/settings", name: "Settings", icon: Settings },
];
export default function App() {
  const [initialized, setInitialized] = useState<boolean>(),
    [user, setUser] = useState<User | null>(null),
    [error, setError] = useState<unknown>(),
    [checking, setChecking] = useState(true),
    [refresh, setRefresh] = useState(0),
    [toast, setToast] = useState(""),
    [menu, setMenu] = useState(false),
    [search, setSearch] = useState("");
  const location = useLocation(),
    navigate = useNavigate();
  const boot = () => {
    setChecking(true);
    setError(undefined);
    api<{ initialized: boolean }>("/setup/status")
      .then(async (status) => {
        setInitialized(status.initialized);
        if (status.initialized) {
          try {
            setUser(await api<User>("/auth/me"));
          } catch (e: any) {
            if (e.status !== 401) throw e;
          }
        }
      })
      .catch(setError)
      .finally(() => setChecking(false));
  };
  useEffect(boot, []);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setCsrf("");
    };
    window.addEventListener("vault:unauthorized", expired);
    return () => window.removeEventListener("vault:unauthorized", expired);
  }, []);
  useEffect(() => {
    setMenu(false);
  }, [location.pathname]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const loggedIn = (user: User, csrf: string) => {
    setUser(user);
    setCsrf(csrf);
    setInitialized(true);
    navigate("/");
  };
  if (checking)
    return (
      <div className="boot">
        <Brand />
        <Loading />
      </div>
    );
  if (error)
    return (
      <div className="boot">
        <Brand />
        <ErrorNotice error={error} onRetry={boot} />
      </div>
    );
  if (!initialized) return <Setup onComplete={loggedIn} />;
  if (!user) return <Login onComplete={loggedIn} />;
  const section = navigation.find((item) =>
    item.to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(item.to),
  );
  const admin = user.role === "admin";
  return (
    <Context.Provider
      value={{
        user,
        refresh,
        changed: () => setRefresh((v) => v + 1),
        notify: setToast,
      }}
    >
      <div className="app-shell">
        <aside className={`sidebar ${menu ? "open" : ""}`}>
          <Link to="/" className="brand">
            <Brand />
          </Link>
          <div className="workspace-label">
            YOUR WORKSPACE <span>SELF-HOSTED</span>
          </div>
          <nav>
            {navigation
              .filter(
                (item) =>
                  admin ||
                  !["Users", "Settings", "Backups"].includes(item.name),
              )
              .map((item) => (
                <NavLink key={item.name} to={item.to} end={item.to === "/"}>
                  <item.icon size={19} />
                  <span>{item.name}</span>
                  <ChevronRight size={14} className="nav-chevron" />
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="private-vault">
              <ShieldCheck size={17} />
              <div>
                <strong>Private by design</strong>
                <span>Your server. Your configurations.</span>
              </div>
            </div>
            <div className="user-profile">
              <span className="avatar">
                {user.username.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{user.username}</strong>
                <small>{user.role}</small>
              </div>
              <button
                title="Sign out"
                className="icon-button"
                onClick={async () => {
                  try {
                    await post("/auth/logout", {});
                    setUser(null);
                  } catch (e) {
                    setToast(String(e));
                  }
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        {menu && (
          <div className="sidebar-scrim" onClick={() => setMenu(false)} />
        )}
        <main className="main">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setMenu(true)}
              >
                <Menu size={20} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>{section?.name || "Config Vault"}</strong>
            </div>
            <form
              className="global-search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`/configs?q=${encodeURIComponent(search)}`);
              }}
            >
              <Search size={16} />
              <input
                aria-label="Search vault"
                placeholder="Search configurations, devices, content…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            <div className="topbar-right">
              <span className="secure-label">
                <i />
                Private vault
              </span>
              <Link
                to="/activity"
                className="icon-button"
                aria-label="View activity"
              >
                <Bell size={18} />
              </Link>
            </div>
          </header>
          <div className="page-content">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/devices" element={<Devices />} />
              <Route path="/devices/:id" element={<DeviceDetail />} />
              <Route path="/configs" element={<Configurations />} />
              <Route path="/configs/:id" element={<ConfigDetail />} />
              <Route path="/services" element={<GroupsPage />} />
              <Route path="/snapshots" element={<Snapshots />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/import" element={<ImportPage />} />
              <Route
                path="/backups"
                element={admin ? <Backups /> : <AccessDenied />}
              />
              <Route path="/activity" element={<ActivityPage />} />
              <Route
                path="/users"
                element={admin ? <UsersPage /> : <AccessDenied />}
              />
              <Route
                path="/settings"
                element={admin ? <SettingsPage /> : <AccessDenied />}
              />
              <Route
                path="*"
                element={
                  <Empty
                    title="Page not found"
                    description="This location does not exist in your vault."
                    action={
                      <Link to="/" className="button primary">
                        Back to dashboard
                      </Link>
                    }
                  />
                }
              />
            </Routes>
          </div>
          <footer className="footer">
            <span>
              Config Vault <b>1.0</b>
            </span>
            <span>
              <ShieldCheck size={12} />
              Stored on your infrastructure
            </span>
          </footer>
        </main>
        {toast && (
          <div className="toast" role="status">
            <ShieldCheck size={18} />
            <span>{toast}</span>
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>
    </Context.Provider>
  );
}
export function Brand() {
  return (
    <>
      <span className="brand-mark">
        <Archive size={23} strokeWidth={1.7} />
      </span>
      <span className="brand-name">
        config<span>vault</span>
        <sup>•</sup>
      </span>
    </>
  );
}
function AccessDenied() {
  return (
    <Empty
      title="Administrator access required"
      description="Your role does not allow access to this section."
      icon="secure"
    />
  );
}
export function ActivityList({
  entries,
  compact = false,
}: {
  entries: ActivityType[];
  compact?: boolean;
}) {
  return entries.length ? (
    <div className={`activity-list ${compact ? "compact" : ""}`}>
      {entries.map((item) => (
        <div className="activity-row" key={item.id}>
          <span className="activity-icon">
            <FileCode2 size={17} />
          </span>
          <div className="activity-main">
            <div>
              <strong>{item.target || item.action}</strong>
              <span className="activity-action">
                {item.action.replaceAll("_", " ")}
              </span>
            </div>
            <small>
              {item.actor}
              {item.details && <> · {item.details}</>}
            </small>
          </div>
          <time title={date(item.created_at)}>{relative(item.created_at)}</time>
        </div>
      ))}
    </div>
  ) : (
    <Empty
      title="Your history starts here"
      description="Edits, restores, imports and syncs appear here as they happen."
    />
  );
}
function DashboardPage() {
  const { refresh, user } = useVault();
  const { data, error, loading, reload } = useLoad(
    () => api<Dashboard>("/dashboard"),
    [refresh],
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNotice error={error} onRetry={reload} />;
  if (!data) return null;
  const stats = [
    {
      label: "Devices",
      value: data.devices,
      icon: Server,
      detail: "Connected to your vault",
      to: "/devices",
    },
    {
      label: "Configurations",
      value: data.configurations,
      icon: FileCode2,
      detail: "Versioned and organized",
      to: "/configs",
    },
    {
      label: "Changes today",
      value: data.changes_today,
      icon: Activity,
      detail: "Every change, remembered",
      to: "/activity",
    },
    {
      label: "Snapshots",
      value: data.snapshots,
      icon: Clock3,
      detail: "Points you can return to",
      to: "/snapshots",
    },
  ];
  return (
    <>
      <PageHead
        eyebrow="YOUR CONFIGURATION COMMAND CENTER"
        title="Everything, in its place."
        description="Keep your systems organized. Know what changed. Get back to what worked."
        actions={
          <>
            <Link to="/import" className="button">
              <Upload size={16} />
              Import configs
            </Link>
            {user.role === "admin" && (
              <Link to="/devices?add=true" className="button primary">
                <Plus size={16} />
                Add device
              </Link>
            )}
          </>
        }
      />
      <div className="overview-title">
        <span>
          <i />
          Vault overview
        </span>
        <small>Live from your instance</small>
      </div>
      <div className="stats-grid">
        {stats.map((stat, i) => (
          <Link className="stat-card" key={stat.label} to={stat.to}>
            <div className="stat-top">
              <span>{stat.label}</span>
              <stat.icon size={19} />
            </div>
            <div className="stat-value">
              {stat.value}
              <ArrowUpRight size={19} />
            </div>
            <p>{stat.detail}</p>
            <span className={`stat-rule rule-${i}`} />
          </Link>
        ))}
      </div>
      {data.alerts.length > 0 && (
        <div className="alerts">
          {data.alerts.map((alert, i) => (
            <div className={`alert ${alert.level}`} key={i}>
              <Bell size={15} />
              {alert.message}
              <Link
                to={
                  alert.message.toLowerCase().includes("backup")
                    ? "/backups"
                    : "/devices"
                }
              >
                Review
                <ChevronRight size={13} />
              </Link>
            </div>
          ))}
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel recent-panel">
          <div className="panel-head">
            <div>
              <h2>Recent changes</h2>
              <p>A clear trail of what happened.</p>
            </div>
            <Link className="text-link" to="/activity">
              View activity
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <ActivityList entries={data.recent_changes} compact />
        </section>
        <section className="panel fleet-panel">
          <div className="panel-head">
            <div>
              <h2>Your devices</h2>
              <p>One place for every system.</p>
            </div>
            <Link to="/devices" className="text-link">
              View all
              <ArrowUpRight size={14} />
            </Link>
          </div>
          {data.device_health.length ? (
            <div className="health-list">
              {data.device_health.slice(0, 5).map((device) => (
                <Link key={device.id} to={`/devices/${device.id}`}>
                  <span className="device-symbol">
                    <Server size={19} />
                  </span>
                  <div>
                    <strong>{device.name}</strong>
                    <small>
                      {device.host || device.type} · {device.config_count}{" "}
                      configs
                    </small>
                  </div>
                  <Status value={device.status} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="Meet your first device"
              description="Add a server, a laptop, or a logical target to start organizing your configurations."
              icon="device"
              action={
                user.role === "admin" && (
                  <Link to="/devices?add=true" className="button">
                    <Plus size={15} />
                    Add first device
                  </Link>
                )
              }
            />
          )}
        </section>
      </div>
      <div className="bottom-cards">
        <div className="backup-banner">
          <div className="round-icon">
            <HardDrive size={23} />
          </div>
          <div>
            <div className="eyebrow">RECOVERY YOU CAN RELY ON</div>
            <h3>
              {data.last_backup
                ? "Your vault has a backup."
                : "A backup is your safety net."}
            </h3>
            <p>
              {data.last_backup
                ? `Last backup ${relative(data.last_backup)}. Configurations, history and metadata, together.`
                : "Create an encrypted backup to protect your configurations, history and devices."}
            </p>
          </div>
          {user.role === "admin" && (
            <Link to="/backups" className="button">
              Manage backups
              <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
        <div className="workflow-note">
          <span className="round-icon">
            <Clock3 size={22} />
          </span>
          <h3>Every version stays.</h3>
          <p>
            Restoring an older configuration adds a new version. Your history
            remains intact.
          </p>
        </div>
      </div>
    </>
  );
}
function ActivityPage() {
  const { refresh } = useVault();
  const { data, error, loading, reload } = useLoad(
    () => api<ActivityType[]>("/activity"),
    [refresh],
  );
  const [filter, setFilter] = useState("");
  return (
    <>
      <PageHead
        eyebrow="THE FULL PICTURE"
        title="Activity"
        description="A transparent record of access, changes and recovery operations."
      />
      <div className="toolbar">
        <div className="filter-search">
          <Search size={16} />
          <input
            placeholder="Filter actor, action, device or path…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <Button icon={<Activity size={15} />} onClick={reload}>
          Refresh
        </Button>
      </div>
      <ErrorNotice error={error} onRetry={reload} />
      {loading && !data ? (
        <Loading />
      ) : (
        <section className="panel">
          <ActivityList
            entries={(data || []).filter((item) =>
              `${item.actor} ${item.action} ${item.target} ${item.details}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
            )}
          />
        </section>
      )}
    </>
  );
}
