import type { DataStorageStatus } from "../../shared/dataStorage";

const dataEntries = [
  ["library.sqlite", "资料库", "保存视频索引、收藏、播放记录等。它不包含原视频；重新扫描不能完整恢复个人记录，请保留并备份。"],
  ["library.sqlite-wal / library.sqlite-shm", "数据库配套文件", "程序运行时可能出现，含正在使用的数据库状态。不要单独删除；备份前请正常退出程序。"],
  ["library.sqlite.backups/", "升级备份", "保存数据库升级前的副本，供恢复时使用。这里只备份数据库，不包含字幕、设置和原视频。"],
  ["settings.json", "应用设置", "保存扫描、播放、快捷键及网盘连接等设置，建议随资料库备份。部分界面偏好保存在默认位置。"],
  ["subtitles/", "下载的字幕", "保存应用下载的字幕、选择记录和时间偏移。建议保留；删除后不保证还能下载到相同字幕。视频旁的原有字幕不在这里。"],
  ["media-cache/covers/", "封面与缩略图", "保存视频封面和图片缩略图。可从原文件重新生成，清理后首次显示可能变慢。"],
  ["media-cache/timeline/", "时间轴预览", "保存视频不同时间位置的预览图片。可重新生成；网盘视频重建时会再次读取网络数据。"],
  ["logs/", "运行日志", "帮助排查错误，由程序自动轮换。可能包含私人路径，分享前请检查，不代替资料库备份。"],
  ["clouddrive-credentials.bin / subtitle-credentials.bin", "加密凭据", "保存已配置服务的受保护登录材料。不要分享；换电脑或 Windows 用户后可能需要重新登录。未配置服务时可能没有这些文件。"],
  [".data-directory-owner.json", "目录归属", "帮助程序识别这份数据。恢复或重新定位时需要，请勿删除或修改。"],
  [".data-directory.lock / database-unclean-shutdown.marker", "运行状态", "程序运行期间用于保护资料库和检查异常退出。出现这些文件通常正常，交给程序处理。"],
  [".data-migration-receipt.json", "迁移校验记录", "迁移后可能保留，帮助程序恢复迁移或核对旧文件。迁移尚未结束时不要删除或修改。"]
];

export function DataStorageHelp({ status }: { status: DataStorageStatus | null }) {
  return <article className="storage-help" aria-labelledby="storage-help-title">
    <header><h3 id="storage-help-title">数据目录使用说明</h3><p>了解这里存了什么，以及怎样更换位置、备份和清理。</p></header>
    <section aria-labelledby="storage-help-location">
      <h4 id="storage-help-location">数据放在哪里？</h4>
      {status && <dl className="storage-help-paths">
        <div><dt>当前数据目录</dt><dd>{status.currentDirectory}</dd></div>
        <div><dt>默认运行环境位置</dt><dd>{status.defaultDirectory}</dd></div>
      </dl>}
      <p>第一次使用时按默认位置保存。更改位置后，资料库等主要数据保存在新位置；原默认位置仍保留目录定位记录和程序运行环境。两处目录相同，表示尚未分开存放。</p>
      <p>原视频留在你添加的硬盘、网盘或 NAS 目录中。移动程序文件夹或升级同一发行身份的绿色包后，仍会继续使用已选的数据位置。</p>
    </section>
    <section aria-labelledby="storage-help-contents">
      <h4 id="storage-help-contents">各目录和文件存什么？</h4>
      <p>文件按需生成，不一定每项都有。名称很长的缓存或字幕子目录通常是程序生成的标识，不需要手工改名。</p>
      <div className="storage-help-table"><table><caption>当前数据目录中的常见内容</caption><thead><tr><th scope="col">目录或文件</th><th scope="col">用途与维护</th></tr></thead><tbody>
        {dataEntries.map(([name, title, description]) => <tr key={name}><th scope="row"><code>{name}</code></th><td><strong>{title}</strong><p>{description}</p></td></tr>)}
      </tbody></table></div>
    </section>
    <section aria-labelledby="storage-help-default">
      <h4 id="storage-help-default">为什么默认位置还有文件？</h4>
      <p><code>data-location.json</code> 记录当前数据在哪里，是迁移后的重要定位文件，请保持原位。<code>Local Storage</code> 保存目录排序、菜单折叠等界面偏好；<code>Network</code>、<code>Local State</code>、<code>Preferences</code> 等由运行环境管理。</p>
      <p><code>Cache</code>、<code>Code Cache</code>、<code>GPUCache</code>、<code>ShaderCache</code> 及其他图形缓存也可能留在这里。它们与 <code>media-cache</code> 中的视频预览不同，不要为了腾空间直接删除整个默认目录。旧版留下的自建文档或非标准备份需单独确认用途。</p>
    </section>
    <section aria-labelledby="storage-help-move">
      <h4 id="storage-help-move">怎样更换存放位置？</h4>
      <ol>
        <li>点击“更改位置”，选择一个有足够空间、可长期使用的文件夹。程序会在其中新建专用数据目录；已有同名目录时不会覆盖或合并。</li>
        <li>核对原位置、新位置和数据大小，保存当前操作并结束播放，再点击“迁移并重启”。迁移期间保持磁盘连接，不要断电。</li>
        <li>程序复制并校验后启用新位置，再清理已核对的原应用数据；失败时保留原数据。旧文件有变化或被占用时，可能保留并提示。</li>
      </ol>
      <p>会迁移资料库、设置、应用下载的字幕、媒体缓存、日志和数据库升级备份。原视频、视频旁的字幕、导出文件和手工放入的其他文档不会一起移动，请按需另行整理。</p>
    </section>
    <section aria-labelledby="storage-help-maintain">
      <h4 id="storage-help-maintain">怎样备份和清理？</h4>
      <ul>
        <li><strong>备份：</strong>正常关闭程序后，复制整个当前数据目录；迁移后另保留默认位置的 <code>data-location.json</code>。原视频和旁置字幕另做备份，想保留全部界面偏好时也保留默认位置的运行数据。</li>
        <li><strong>清理：</strong>优先使用“设置 → 缓存”中的清理功能。缓存可以重建，资料库、字幕、凭据、定位记录与运行标记不应当作普通缓存删除。</li>
        <li><strong>数据盘离线：</strong>先恢复磁盘连接；需要时用启动提示中的“重新定位已有资料库”，选择原有数据目录，不要新建空库代替。</li>
        <li><strong>分享程序：</strong>只分享程序包，不附带个人数据目录、日志、字幕或凭据。迁移后避免再运行不支持新目录位置的旧程序。</li>
      </ul>
    </section>
    <p className="storage-help-note">此说明随程序提供，离线可查看。阅读说明不会更改设置或开始迁移。</p>
  </article>;
}
