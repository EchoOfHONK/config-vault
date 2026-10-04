import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  drawSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { tags } from "@lezer/highlight";
import { diffLines } from "diff";
import { message } from "./api";

export function Loading({ text = "Loading your vault…" }: { text?: string }) {
  return (
    <div className="loading">
      <Loader2 className="spin" size={22} />
      <span>{text}</span>
    </div>
  );
}
export function ErrorNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  return error ? (
    <div className="notice danger" role="alert">
      <AlertTriangle size={18} />
      <span>{message(error)}</span>
      {onRetry && (
        <button className="text-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  ) : null;
}
export function Notice({
  children,
  kind = "info",
}: {
  children: ReactNode;
  kind?: string;
}) {
  return (
    <div className={`notice ${kind}`}>
      <ShieldCheck size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
  icon = "file",
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        {icon === "device" ? (
          <Server size={28} />
        ) : icon === "secure" ? (
          <LockKeyhole size={28} />
        ) : (
          <FileCode2 size={28} />
        )}
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Button({
  children,
  primary = false,
  danger = false,
  busy = false,
  icon,
  onClick,
  type = "button",
  disabled,
  className = "",
}: {
  children?: ReactNode;
  primary?: boolean;
  danger?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${primary ? "primary" : ""} ${danger ? "destructive" : ""} ${className}`}
      onClick={onClick}
      disabled={disabled || busy}
    >
      {busy ? <Loader2 size={16} className="spin" /> : icon}
      {children}
    </button>
  );
}
export function Status({ value }: { value: string | undefined }) {
  const state = (value || "manual").toLowerCase().replaceAll("_", " ");
  const color = /online|success|ready|completed|same/.test(state)
    ? "green"
    : /offline|failed|error|conflict/.test(state)
      ? "red"
      : /sync|change|different|pending/.test(state)
        ? "orange"
        : "neutral";
  return (
    <span className={`status ${color}`}>
      <i />
      {state}
    </span>
  );
}
export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}
export function Field({
  label,
  children,
  hint,
  required = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span>
        {label}
        {required && <b> *</b>}
      </span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}
export function Modal({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const focusable = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,a[href],[tabindex="0"]',
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", close);
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
    return () => {
      document.removeEventListener("keydown", close);
      document.body.style.overflow = "";
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Confirm({
  title,
  description,
  label = "Confirm",
  onConfirm,
  onClose,
  danger = false,
}: {
  title: string;
  description: ReactNode;
  label?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">
        <div className="confirm-copy">{description}</div>
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          primary={!danger}
          danger={danger}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await onConfirm();
              onClose();
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {label}
        </Button>
      </div>
    </Modal>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.label}
          {item.count !== undefined && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>(),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    loader()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) setError(error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [...deps, revision]);
  return {
    data,
    error,
    loading,
    reload: () => setRevision((value) => value + 1),
  };
}
export function AsyncForm({
  onSubmit,
  children,
  submit = "Save",
  cancel,
  onDone,
}: {
  onSubmit: () => Promise<void>;
  children: ReactNode;
  submit?: string;
  cancel?: () => void;
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  return (
    <form
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(undefined);
        try {
          await onSubmit();
          onDone?.();
        } catch (e) {
          setError(e);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="modal-body">
        {children}
        <ErrorNotice error={error} />
      </div>
      <div className="modal-actions">
        {cancel && <Button onClick={cancel}>Cancel</Button>}
        <Button primary type="submit" busy={busy}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
const codeTheme = EditorView.theme(
  {
    "&": { backgroundColor: "#131514", color: "#cbd1cc", fontSize: "13px" },
    ".cm-content": {
      fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
      padding: "18px 0",
      caretColor: "#edb58c",
    },
    ".cm-line": { padding: "0 20px" },
    ".cm-gutters": {
      backgroundColor: "#131514",
      color: "#555e57",
      borderRight: "1px solid #272c28",
      paddingRight: "8px",
      minWidth: "52px",
    },
    ".cm-activeLineGutter": { backgroundColor: "#20251f", color: "#b8c2bb" },
    ".cm-activeLine": { backgroundColor: "#1c221d" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#414a3a",
    },
    ".cm-cursor": { borderLeftColor: "#f3b08a" },
    ".cm-scroller": { overflow: "auto" },
    ".cm-search": { background: "#202521" },
    ".cm-panels": { color: "#d2d8d1" },
    ".cm-textfield": {
      background: "#111511",
      border: "1px solid #41473c",
      color: "#eee",
    },
    ".cm-button": { background: "#333b31", color: "#eee" },
    "&.cm-focused": { outline: "none" },
  },
  { dark: true },
);
const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#c49ccb" },
  { tag: [tags.name, tags.propertyName], color: "#c6d6d3" },
  { tag: [tags.string, tags.special(tags.string)], color: "#a2c28a" },
  { tag: [tags.number, tags.bool], color: "#deab78" },
  { tag: tags.comment, color: "#6e7d71", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#a5aca7" },
  { tag: tags.function(tags.variableName), color: "#9fbed0" },
  { tag: tags.typeName, color: "#ccb989" },
]);
function language(format: string): Extension[] {
  switch (format) {
    case "json":
      return [json()];
    case "yaml":
      return [yaml()];
    case "javascript":
      return [javascript()];
    case "typescript":
      return [javascript({ typescript: true })];
    case "python":
      return [python()];
    case "xml":
      return [xml()];
    case "toml":
      return [StreamLanguage.define(toml)];
    case "shell":
      return [StreamLanguage.define(shell)];
    case "dockerfile":
      return [StreamLanguage.define(dockerFile)];
    case "lua":
      return [StreamLanguage.define(lua)];
    case "properties":
    case "ini":
    case "wireguard":
    case "systemd":
    case "env":
      return [StreamLanguage.define(properties)];
    default:
      return [StreamLanguage.define(shell)];
  }
}
export function CodeEditor({
  value,
  onChange,
  format = "text",
  readOnly = false,
  height = "420px",
}: {
  value: string;
  onChange?: (value: string) => void;
  format?: string;
  readOnly?: boolean;
  height?: string;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(null),
    change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          codeTheme,
          syntaxHighlighting(codeHighlight),
          ...language(format),
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              change.current?.(update.state.doc.toString());
          }),
          EditorView.theme({
            "&": { height },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [format, readOnly, height]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value },
      });
  }, [value]);
  return (
    <div
      ref={host}
      className="code-editor"
      aria-label={`${format} ${readOnly ? "viewer" : "editor"}`}
    />
  );
}
export function DiffViewer({
  left,
  right,
  leftLabel = "Previous version",
  rightLabel = "Current version",
}: {
  left: string;
  right: string;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const [mode, setMode] = useState("split");
  const changes = diffLines(left, right);
  let leftLine = 0,
    rightLine = 0;
  const rows: {
    left?: string;
    right?: string;
    ln?: number;
    rn?: number;
    kind: string;
  }[] = [];
  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const lines = c.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if (c.removed && changes[i + 1]?.added) {
      const add = changes[++i].value.split("\n");
      if (add.at(-1) === "") add.pop();
      for (let j = 0; j < Math.max(lines.length, add.length); j++)
        rows.push({
          left: lines[j],
          right: add[j],
          ln: lines[j] === undefined ? undefined : ++leftLine,
          rn: add[j] === undefined ? undefined : ++rightLine,
          kind: "changed",
        });
    } else
      for (const line of lines)
        rows.push({
          left: c.added ? undefined : line,
          right: c.removed ? undefined : line,
          ln: c.added ? undefined : ++leftLine,
          rn: c.removed ? undefined : ++rightLine,
          kind: c.added ? "added" : c.removed ? "removed" : "same",
        });
  }
  return (
    <div className="diff">
      <div className="diff-toolbar">
        <span className="diff-stats">
          <b className="green-text">
            +
            {changes
              .filter((c) => c.added)
              .reduce((n, c) => n + (c.count || 0), 0)}
          </b>
          <b className="red-text">
            −
            {changes
              .filter((c) => c.removed)
              .reduce((n, c) => n + (c.count || 0), 0)}
          </b>
          <span>lines</span>
        </span>
        <div className="segmented">
          <button
            onClick={() => setMode("split")}
            className={mode === "split" ? "active" : ""}
          >
            Side by side
          </button>
          <button
            onClick={() => setMode("unified")}
            className={mode === "unified" ? "active" : ""}
          >
            Unified
          </button>
        </div>
      </div>
      <div className="diff-labels">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>
      <div className={`diff-code ${mode}`}>
        {rows.length ? (
          rows.map((row, i) =>
            mode === "split" ? (
              <div className={`diff-row ${row.kind}`} key={i}>
                <div
                  className={`diff-half ${row.kind === "changed" ? "removed" : row.kind}`}
                >
                  <span className="line-no">{row.ln}</span>
                  <pre>{row.left ?? " "}</pre>
                </div>
                <div
                  className={`diff-half ${row.kind === "changed" ? "added" : row.kind}`}
                >
                  <span className="line-no">{row.rn}</span>
                  <pre>{row.right ?? " "}</pre>
                </div>
              </div>
            ) : (
              <div key={i}>
                {row.kind === "changed" ? (
                  <>
                    <div className="unified-line removed">
                      <span className="line-no">{row.ln}</span>
                      <span>−</span>
                      <pre>{row.left ?? " "}</pre>
                    </div>
                    <div className="unified-line added">
                      <span className="line-no">{row.rn}</span>
                      <span>+</span>
                      <pre>{row.right ?? " "}</pre>
                    </div>
                  </>
                ) : (
                  <div className={`unified-line ${row.kind}`}>
                    <span className="line-no">
                      {row.kind === "removed" ? row.ln : row.rn}
                    </span>
                    <span>
                      {row.kind === "removed"
                        ? "−"
                        : row.kind === "added"
                          ? "+"
                          : " "}
                    </span>
                    <pre>{row.left ?? row.right ?? " "}</pre>
                  </div>
                )}
              </div>
            ),
          )
        ) : (
          <div className="same-file">
            <CheckCircle2 size={20} />
            These versions are identical.
          </div>
        )}
      </div>
    </div>
  );
}
export function CheckList({
  options,
  selected,
  onChange,
}: {
  options: { id: number; label: string; detail?: string }[];
  selected: number[];
  onChange: (ids: number[]) => void;
}) {
  return (
    <div className="check-list">
      {options.map((option) => (
        <label key={option.id} className="check-row">
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id),
              )
            }
          />
          <div>
            <strong>{option.label}</strong>
            {option.detail && <small>{option.detail}</small>}
          </div>
        </label>
      ))}
    </div>
  );
}
export const Icons = {
  AlertTriangle,
  Check,
  ChevronRight,
  FileCode2,
  Plus,
  RefreshCw,
  Search,
  Server,
};
