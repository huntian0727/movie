import { useMemo, useState } from "react";
import type { DuplicateDirectoryOption } from "../../shared/videoTypes";
import { formatBytes } from "./formatters";

export function DuplicateDirectoryRanking({ options, onSelect }: {
  options: DuplicateDirectoryOption[];
  onSelect?(path: string): void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const matches = useMemo(() => options.filter((option) => option.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [options, search]);
  const pages = Math.max(1, Math.ceil(matches.length / 20));
  const currentPage = Math.min(page, pages);
  return <section className="duplicate-directory-ranking" aria-label="目录清理排行">
    <header><div><h3>目录清理排行</h3><p>选择要保留的目录，查看涉及的全部候选。目录包含子目录，各行数量不能相加。</p></div>
      <input aria-label="搜索排行目录" placeholder="搜索目录名称或路径" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></header>
    <div className="duplicate-ranking-scroll"><table>
      <thead><tr><th>目录</th><th>候选清理文件</th><th>候选释放空间</th><th>操作</th></tr></thead>
      <tbody>{matches.slice((currentPage - 1) * 20, currentPage * 20).map((option) => <tr key={option.path}>
        <td title={option.path}>{option.path}</td><td>{option.estimatedCleanupFileCount.toLocaleString()}</td><td>{formatBytes(option.estimatedReclaimableBytes)}</td>
        <td><button type="button" disabled={!onSelect} aria-label={`从排行优先保留 ${option.path}`} onClick={() => onSelect?.(option.path)}>优先保留此目录</button></td>
      </tr>)}</tbody>
    </table></div>
    {matches.length === 0 && <p>没有符合条件的目录，请调整筛选或搜索。</p>}
    <footer><span>共 {matches.length.toLocaleString()} 个目录 · {currentPage} / {pages} 页</span>
      <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>上一页目录</button>
      <button type="button" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>下一页目录</button></footer>
  </section>;
}
