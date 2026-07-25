import { FolderOpen, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

interface DirectoryPickerProps {
  directoryPaths?: string[];
  directoryOptions?: DirectoryPickerOption[];
  value?: string;
  placeholder: string;
  ariaLabel: string;
  compact?: boolean;
  allowClear?: boolean;
  onChange(path: string): void;
}

export interface DirectoryPickerOption {
  path: string;
  meta?: string;
}

/**
 * Searches directories already known to the library. It deliberately never
 * reads the file system, so opening it is safe for large or network folders.
 */
export function DirectoryPicker({
  directoryPaths = [],
  directoryOptions,
  value,
  placeholder,
  ariaLabel,
  compact = false,
  allowClear = false,
  onChange
}: DirectoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(
    () => {
      const candidates: DirectoryPickerOption[] = directoryOptions ?? directoryPaths.map((path) => ({ path }));
      const unique = [...new Map(candidates.map((option) => [normalizePath(option.path), option])).values()];
      if (!directoryOptions) unique.sort((left, right) => left.path.localeCompare(right.path));
      return unique.sort((left, right) => Number(normalizePath(right.path) === normalizePath(value ?? "")) - Number(normalizePath(left.path) === normalizePath(value ?? "")));
    },
    [directoryOptions, directoryPaths, value]
  );
  const matches = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return options;
    return options.filter((option) => option.path.toLocaleLowerCase().includes(keyword) || directoryName(option.path).toLocaleLowerCase().includes(keyword));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const choose = (path: string) => {
    onChange(path);
    setOpen(false);
  };
  const clear = () => {
    onChange("");
    setOpen(false);
  };

  return (
    <div className={`directory-picker${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="directory-picker-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        title={value || placeholder}
        onClick={() => setOpen((current) => !current)}
      >
        {compact ? <Search size={16} /> : <><FolderOpen size={15} /><span>{value ? directoryName(value) : placeholder}</span></>}
      </button>
      {open && (
        <div className="directory-picker-menu" role="dialog" aria-label={ariaLabel}>
          <div className="directory-picker-search">
            <Search size={15} />
            <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索目录名称或路径" aria-label="搜索目录" />
            <button type="button" aria-label="关闭目录选择" onClick={() => setOpen(false)}><X size={14} /></button>
          </div>
          <div className="directory-picker-results" role="listbox" aria-label="目录搜索结果">
            {allowClear && <button type="button" className="directory-picker-clear" onClick={clear}>全部资料库（自动推荐）</button>}
            {matches.map((option) => (
              <button type="button" role="option" aria-selected={normalizePath(option.path) === normalizePath(value ?? "")} key={option.path} title={option.path} onClick={() => choose(option.path)}>
                <FolderOpen size={15} />
                <span><strong>{directoryName(option.path)}</strong><small>{option.meta ? `${option.path} · ${option.meta}` : option.path}</small></span>
              </button>
            ))}
            {matches.length === 0 && <p>没有匹配的已入库目录</p>}
          </div>
          <p className="directory-picker-note">仅搜索资料库已有目录，不会读取磁盘或网盘。</p>
        </div>
      )}
    </div>
  );
}

function directoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function normalizePath(path: string): string {
  return path.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLocaleLowerCase();
}
