import { ArrowDownAZ, ArrowDownWideNarrow, ArrowLeft, Grid2X2, List, Minus, Plus, RefreshCw, Search } from "lucide-react";
import type { SortDirection, SortField, ViewMode } from "../../shared/videoTypes";

interface ToolbarProps {
  title: string;
  count: number;
  countLabel?: string;
  search: string;
  sortField: SortField;
  sortDirection: SortDirection;
  viewMode: ViewMode;
  loading: boolean;
  showBrowseControls?: boolean;
  gridCardSizeIndex?: number;
  gridCardSizeMaxIndex?: number;
  onBack?(): void;
  onSearch(value: string): void;
  onSortField(value: SortField): void;
  onToggleDirection(): void;
  onViewMode(value: ViewMode): void;
  onGridCardSizeIndex?(value: number): void;
  onRefresh(): void;
}

export function Toolbar(props: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-title">
        {props.onBack && <button type="button" className="toolbar-back" aria-label="返回全部视频" title="返回全部视频" onClick={props.onBack}><ArrowLeft size={17} /></button>}
        <div>
          <h2>{props.title}</h2>
          <span>{props.count} {props.countLabel ?? "部视频"}</span>
        </div>
      </div>
      <div className="toolbar-actions">
        {props.showBrowseControls !== false && (
          <>
            <label className="search-field">
              <Search size={17} aria-hidden="true" />
              <input
                aria-label="搜索文件名"
                placeholder="搜索文件名"
                value={props.search}
                onChange={(event) => props.onSearch(event.target.value)}
              />
            </label>
            <select
              className="sort-select"
              aria-label="排序方式"
              value={props.sortField}
              onChange={(event) => props.onSortField(event.target.value as SortField)}
            >
              <option value="filename">文件名</option>
              <option value="sizeBytes">文件大小</option>
              <option value="durationMs">视频时长</option>
              <option value="modifiedAt">修改时间</option>
            </select>
            <button className="icon-button" title="切换排序方向" aria-label="切换排序方向" onClick={props.onToggleDirection}>
              {props.sortDirection === "asc" ? <ArrowDownAZ size={18} /> : <ArrowDownWideNarrow size={18} />}
            </button>
            <div className="segmented" aria-label="显示方式">
              <button title="网格视图" aria-label="网格视图" aria-pressed={props.viewMode === "grid"} onClick={() => props.onViewMode("grid")}>
                <Grid2X2 size={17} />
              </button>
              <button title="列表视图" aria-label="列表视图" aria-pressed={props.viewMode === "table"} onClick={() => props.onViewMode("table")}>
                <List size={18} />
              </button>
            </div>
            {props.viewMode === "grid" && props.onGridCardSizeIndex && typeof props.gridCardSizeIndex === "number" && typeof props.gridCardSizeMaxIndex === "number" && (
              <div className="grid-size-control" aria-label="网格预览大小">
                <button
                  type="button"
                  aria-label="缩小预览卡片"
                  title="缩小预览卡片"
                  disabled={props.gridCardSizeIndex <= 0}
                  onClick={() => props.onGridCardSizeIndex?.(props.gridCardSizeIndex! - 1)}
                >
                  <Minus size={15} />
                </button>
                <input
                  type="range"
                  aria-label="预览卡片大小"
                  min="0"
                  max={props.gridCardSizeMaxIndex}
                  step="1"
                  value={props.gridCardSizeIndex}
                  onChange={(event) => props.onGridCardSizeIndex?.(Number(event.target.value))}
                />
                <button
                  type="button"
                  aria-label="放大预览卡片"
                  title="放大预览卡片"
                  disabled={props.gridCardSizeIndex >= props.gridCardSizeMaxIndex}
                  onClick={() => props.onGridCardSizeIndex?.(props.gridCardSizeIndex! + 1)}
                >
                  <Plus size={15} />
                </button>
              </div>
            )}
          </>
        )}
        <button className="icon-button" title="扫描全盘" aria-label="扫描全盘" disabled={props.loading} onClick={props.onRefresh}>
          <RefreshCw size={18} className={props.loading ? "spin" : undefined} />
        </button>
      </div>
    </header>
  );
}
