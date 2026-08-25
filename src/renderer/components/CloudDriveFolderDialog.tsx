import { ArrowLeft, Cloud, Folder, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CloudDriveBrowseDirectory,
  CloudDriveBrowseRoot,
  CloudDriveSourceSelection,
  SourceFolder
} from "../../shared/videoTypes";

interface CloudDriveFolderDialogProps {
  onClose(): void;
  listRoots(): Promise<CloudDriveBrowseRoot[]>;
  browse(selection: CloudDriveSourceSelection): Promise<CloudDriveBrowseDirectory>;
  add(selection: CloudDriveSourceSelection): Promise<SourceFolder>;
  onAdded(folder: SourceFolder): void | Promise<void>;
}

export function CloudDriveFolderDialog(props: CloudDriveFolderDialogProps) {
  const [roots, setRoots] = useState<CloudDriveBrowseRoot[]>([]);
  const [current, setCurrent] = useState<CloudDriveBrowseDirectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void props.listRoots().then((items) => {
      if (disposed) return;
      setRoots(items);
      setLoading(false);
      if (items.length === 1) void openDirectory(items[0]!.mountPoint, items[0]!.remotePath);
    }, (cause) => {
      if (disposed) return;
      setError(toMessage(cause));
      setLoading(false);
    });
    return () => { disposed = true; };
  }, []);

  const openDirectory = async (mountPoint: string, remotePath: string) => {
    setLoading(true);
    setError(null);
    try {
      setCurrent(await props.browse({ mountPoint, remotePath }));
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (!current) return;
    if (current.parentRemotePath) void openDirectory(current.mountPoint, current.parentRemotePath);
    else setCurrent(null);
  };

  const addCurrent = async () => {
    if (!current || adding) return;
    setAdding(true);
    setError(null);
    try {
      const folder = await props.add({ mountPoint: current.mountPoint, remotePath: current.remotePath });
      await props.onAdded(folder);
      props.onClose();
    } catch (cause) {
      setError(toMessage(cause));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !adding) props.onClose();
    }}>
      <section className="dialog clouddrive-folder-dialog" role="dialog" aria-modal="true" aria-labelledby="clouddrive-folder-title">
        <header>
          <span className="clouddrive-folder-mark"><Cloud size={19} /></span>
          <div>
            <h3 id="clouddrive-folder-title">通过 API 添加网盘目录</h3>
            <p>只读取目录和文件元数据，扫描结果会保存到本地资料库。</p>
          </div>
        </header>

        <div className="clouddrive-folder-location">
          {current && <button type="button" aria-label="返回上一级" onClick={goBack} disabled={loading}><ArrowLeft size={16} /></button>}
          <span title={current?.remotePath}>{current?.remotePath ?? "选择 CloudDrive 挂载来源"}</span>
        </div>

        <div className="clouddrive-folder-list" aria-busy={loading}>
          {loading && <div className="clouddrive-folder-loading"><LoaderCircle className="spin" size={21} />正在读取目录…</div>}
          {!loading && !current && roots.map((root) => (
            <button type="button" key={`${root.mountPoint}\n${root.remotePath}`} onClick={() => void openDirectory(root.mountPoint, root.remotePath)}>
              <Cloud size={18} /><span><strong>{root.name}</strong><small>{root.remotePath} · {root.mountPoint}</small></span>
            </button>
          ))}
          {!loading && current && current.directories.map((directory) => (
            <button type="button" key={directory.remotePath} onClick={() => void openDirectory(current.mountPoint, directory.remotePath)}>
              <Folder size={18} /><span><strong>{directory.name}</strong><small>{directory.remotePath}</small></span>
            </button>
          ))}
          {!loading && !current && roots.length === 0 && <div className="clouddrive-folder-empty">没有可用的已挂载 CloudDrive 来源。</div>}
          {!loading && current && current.directories.length === 0 && <div className="clouddrive-folder-empty">当前目录没有子目录，可以直接添加。</div>}
        </div>

        {current && <div className="clouddrive-folder-summary">
          当前层包含 {current.directVideoCount} 个视频文件、{current.directories.length} 个子目录；添加后会递归扫描全部子目录。
        </div>}
        {error && <small className="dialog-error" role="alert">{error}</small>}
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose} disabled={adding}>取消</button>
          <button type="button" className="primary" onClick={() => void addCurrent()} disabled={!current || loading || adding}>
            {adding ? "正在添加…" : "添加并扫描此目录"}
          </button>
        </div>
      </section>
    </div>
  );
}

function toMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
