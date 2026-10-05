import { useEffect, useState } from "react";
import type { SubtitleApi, SubtitleConfigStatus, SubtitleCredentials } from "../../shared/subtitles";

export function SubtitleSettings({ api }: { api: Pick<SubtitleApi, "openSubtitleWebsite" | "getSubtitleConfig" | "saveSubtitleConfig"> }) {
  const [status, setStatus] = useState<SubtitleConfigStatus | null>(null);
  const [draft, setDraft] = useState<SubtitleCredentials>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => { let alive = true; void api.getSubtitleConfig().then(value => { if (alive) setStatus(value); }).catch(() => { if (alive) { setFailed(true); setMessage("字幕账号配置无法读取；可重新填写并保存。"); } }); return () => { alive = false; }; }, [api]);
  const input = (key: keyof SubtitleCredentials, title: string, type = "password") => <label>{title}<input type={type} autoComplete="off" value={draft[key] ?? ""} maxLength={key === "openSubtitlesUsername" ? 128 : 512} placeholder="留空保留已保存的值" disabled={busy} onChange={e => setDraft({ ...draft, [key]: e.target.value || undefined })} /></label>;
  return <section id="settings-subtitles" className="settings-section subtitle-settings"><h2>在线字幕</h2>
    <p className="subtitle-note">在播放窗口按“查找字幕”，从字幕网站搜索、下载并选用已有字幕。</p>
    <div className="subtitle-provider-settings"><h3>ASSRT 射手网 <small>{status?.assrtConfigured ? "已配置" : "未配置"}</small></h3>
      <p className="subtitle-note">在 ASSRT 注册并登录后，从用户面板获取自己的 API Token。</p>
      <button onClick={() => void api.openSubtitleWebsite("assrt").catch(() => { setFailed(true); setMessage("无法打开网站，请在浏览器访问 assrt.net"); })}>打开 ASSRT 网站</button>
      {input("assrtToken", "API Token")}
      <button disabled={busy || !status?.assrtConfigured} onClick={() => setDraft({ ...draft, assrtToken: "" })}>清除 ASSRT 配置</button>
      {draft.assrtToken === "" && <small>保存后将清除此来源。</small>}
    </div>
    <div className="subtitle-provider-settings"><h3>OpenSubtitles <small>{status?.openSubtitlesConfigured ? "已配置 API" : "未配置"}{status?.openSubtitlesAccountConfigured ? " · 已配置下载账号" : ""}</small></h3>
      <p className="subtitle-note">在 opensubtitles.com 注册账号；在账户的 API Consumers 页面申请 API Key。搜索需要 API Key，下载还需要用户名和密码，下载额度由网站决定。</p>
      <button onClick={() => void api.openSubtitleWebsite("opensubtitles").catch(() => { setFailed(true); setMessage("无法打开网站，请在浏览器访问 opensubtitles.com"); })}>打开 OpenSubtitles 网站</button>
      {input("openSubtitlesApiKey", "API Key")}{input("openSubtitlesUsername", "用户名", "text")}{input("openSubtitlesPassword", "密码")}
      <button disabled={busy || !status?.openSubtitlesConfigured && !status?.openSubtitlesAccountConfigured} onClick={() => setDraft({ ...draft, openSubtitlesApiKey: "", openSubtitlesUsername: "", openSubtitlesPassword: "" })}>清除 OpenSubtitles 配置</button>
      {draft.openSubtitlesApiKey === "" && <small>保存后将清除此来源。</small>}
    </div>
    <p className="subtitle-note">账号信息由 Windows 安全存储加密；已保存的密钥不会显示在界面。填写新值可替换原值。</p>
    {status && !status.storageAvailable && <p role="alert" className="subtitle-error">系统安全存储不可用，暂时无法保存账号。</p>}
    <button className="primary-button" disabled={busy || status?.storageAvailable === false || !Object.values(draft).some(v => v !== undefined)} onClick={async () => {
      setBusy(true); setMessage(null);
      try { const patch = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)); setStatus(await api.saveSubtitleConfig(patch)); setDraft({}); setFailed(false); setMessage("字幕来源配置已保存。可到播放窗口搜索字幕。"); }
      catch (cause) { setFailed(true); setMessage(cause instanceof Error ? cause.message : "保存失败，请重试"); }
      finally { setBusy(false); }
    }}>{busy ? "保存中…" : "保存字幕配置"}</button>
    {message && <p role={failed ? "alert" : "status"} className={failed ? "subtitle-error" : "subtitle-note"}>{message}</p>}
  </section>;
}
