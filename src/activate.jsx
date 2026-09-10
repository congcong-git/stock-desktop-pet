import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./activate.css";

/**
 * 授权激活窗口
 * - 首次打开（或授权失效）时由主进程弹出，未激活不进入应用主体；
 * - 机器码在现场添加到 IPC 剪贴板，避免渲染层依赖剪贴板 API 被拦截。
 */
function ActivateApp() {
  const [status, setStatus] = useState(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    window.stockWatcher
      .getLicenseStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        if (alive) setStatus({ ok: false, reason: "no-license" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleActivate = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await window.stockWatcher.activateLicense(code.trim());
      if (!result.ok) {
        setMessage(result.message || "激活失败，请检查激活码");
        setBusy(false);
        return;
      }
      setMessage("激活成功，正在进入应用…");
    } catch (_error) {
      setMessage("激活失败，请重试");
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await window.stockWatcher.copyLicenseMachineId(status && status.machineId);
      setMessage("机器码已复制，发给作者即可获取激活码");
    } catch (_error) {
      setMessage("复制失败，请手动选中机器码复制");
    }
  };

  return (
    <div className="act-root">
      <header className="act-header">
        <span className="act-logo">牛</span>
        <div>
          <h1>牛来 · 授权激活</h1>
          <p>本软件为授权使用，首次打开需要激活，一次激活永久有效</p>
        </div>
      </header>

      <section className="act-body">
        <div className="act-block">
          <span className="act-label">本机机器码</span>
          <div className="act-machine-row">
            <code className="act-machine">{status ? status.machineId : "读取中…"}</code>
            <button type="button" className="act-btn" onClick={handleCopy} disabled={!status}>
              复制
            </button>
          </div>
          <p className="act-hint">把这段机器码发给作者，即可获得绑定本机的激活码</p>
        </div>

        <div className="act-block">
          <span className="act-label">激活码</span>
          <textarea
            className="act-input"
            rows={4}
            value={code}
            placeholder="粘贴作者提供的激活码"
            onChange={(event) => setCode(event.target.value)}
            disabled={busy}
          />
        </div>

        {message ? <div className={`act-message${/\u6210\u529f/.test(message) ? " act-message--ok" : ""}`}>{message}</div> : null}

        <div className="act-actions">
          <button type="button" className="act-btn act-btn--primary" onClick={handleActivate} disabled={busy || !code.trim()}>
            {busy ? "激活中…" : "激活并使用"}
          </button>
        </div>

        <div className="act-notes">
          <p>· 激活码绑定本机，换机器需重新申请；</p>
          <p>· 同一份授权最多 3 台机器，超出需先解绑旧机器；</p>
          <p>· 请保留好激活码，重装系统后可用同一码重新激活。</p>
        </div>
      </section>
    </div>
  );
}

const container = document.getElementById("root");
createRoot(container).render(<ActivateApp />);
