import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./license-admin.css";

const EMPTY_DATA = { max: 3, used: 0, hasKey: false, machines: [] };

/** 授权签发可视化工具：粘贴用户机器码 → 填归属 → 一键签发 / 复制 / 解绑 */
function LicenseAdminApp() {
  const [data, setData] = useState(EMPTY_DATA);
  const [machineId, setMachineId] = useState("");
  const [owner, setOwner] = useState("");
  const [issuedCode, setIssuedCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await window.licenseAdmin.list());
    } catch (_error) {
      setMessage("读取台账失败，请确认 keys/ 目录可访问");
      setMessageOk(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const notify = (text, ok) => {
    setMessage(text);
    setMessageOk(Boolean(ok));
  };

  const handleIssue = async () => {
    if (busy) return;
    if (!machineId.trim()) {
      notify("请填写用户发来的机器码", false);
      return;
    }
    setBusy(true);
    setIssuedCode("");
    try {
      const result = await window.licenseAdmin.issue({ machineId: machineId.trim(), owner: owner.trim() });
      if (!result.ok) {
        notify(result.message || "签发失败", false);
      } else {
        setIssuedCode(result.code);
        notify(`签发成功，名额占用 ${result.used}/${result.max}。请复制激活码发给用户`, true);
        setOwner("");
      }
      await refresh();
    } catch (_error) {
      notify("签发失败，请重试", false);
    }
    setBusy(false);
  };

  const handleRevoke = async (target) => {
    if (busy) return;
    if (!window.confirm(`确定解绑机器 ${target} 吗？该机器上的软件将回到未激活状态。`)) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.licenseAdmin.revoke(target);
      notify(result.ok ? `已解绑 ${target}，名额占用 ${result.used}/${result.max}` : result.message || "解绑失败", result.ok);
      await refresh();
    } catch (_error) {
      notify("解绑失败，请重试", false);
    }
    setBusy(false);
  };

  const handleCopy = async (text, hint) => {
    try {
      await window.licenseAdmin.copy(text);
      notify(hint || "已复制到剪贴板", true);
    } catch (_error) {
      notify("复制失败", false);
    }
  };

  const handleKeygen = async () => {
    if (!window.confirm("重新生成密钥会使已签发的激活码全部失效，确定继续吗？")) {
      return;
    }
    const result = await window.licenseAdmin.keygen();
    if (result.ok) {
      notify("已重新生成密钥，请把新公钥写入 electron/license.js 的 PUBLIC_KEY_PEM", true);
      await refresh();
    } else {
      notify(result.message || "生成失败", false);
    }
  };

  const formatTime = (value) => (value ? new Date(value).toLocaleString() : "—");

  return (
    <div className="adm-root">
      <header className="adm-header">
        <span className="adm-logo">牛</span>
        <div className="adm-title">
          <h1>牛来 · 授权签发工具</h1>
          <p>粘贴用户的机器码即可签发激活码，同一份授权最多 3 台机器</p>
        </div>
        <div className="adm-quota">
          <span className="adm-quota-num">
            {data.used}/{data.max}
          </span>
          <span className="adm-quota-label">名额占用</span>
        </div>
      </header>

      {!data.hasKey ? (
        <div className="adm-warn">
          未检测到私钥 <code>keys/private.pem</code>。
          <button type="button" className="adm-btn" onClick={handleKeygen}>
            生成密钥
          </button>
          <span className="adm-warn-tip">（重新生成会让已发出的激活码全部失效）</span>
        </div>
      ) : null}

      <section className="adm-body">
        <div className="adm-panel">
          <h2>签发激活码</h2>
          <label className="adm-field">
            <span>机器码</span>
            <input
              className="adm-input"
              value={machineId}
              placeholder="例如 8A8C-1D19-50A7-D05E"
              onChange={(event) => setMachineId(event.target.value)}
            />
          </label>
          <label className="adm-field">
            <span>归属（中文可直接输入，界面传输不走命令行编码）</span>
            <input
              className="adm-input"
              value={owner}
              placeholder="例如 张三"
              onChange={(event) => setOwner(event.target.value)}
            />
          </label>
          <button type="button" className="adm-btn adm-btn--primary" onClick={handleIssue} disabled={busy}>
            {busy ? "处理中…" : "签发激活码"}
          </button>

          {issuedCode ? (
            <div className="adm-result">
              <div className="adm-result-head">
                <span>本次签发的激活码</span>
                <button type="button" className="adm-btn adm-btn--tiny" onClick={() => handleCopy(issuedCode, "激活码已复制")}>
                  复制
                </button>
              </div>
              <code className="adm-code">{issuedCode}</code>
            </div>
          ) : null}
        </div>

        <div className="adm-panel adm-panel--list">
          <div className="adm-list-head">
            <h2>已签发机器</h2>
            <button type="button" className="adm-btn adm-btn--tiny" onClick={refresh}>
              刷新
            </button>
          </div>
          {data.machines.length ? (
            <div className="adm-table-wrap">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>机器码</th>
                    <th>归属</th>
                    <th>签发时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.machines.map((item) => (
                    <tr key={item.machineId}>
                      <td>
                        <code>{item.machineId}</code>
                      </td>
                      <td>{item.owner}</td>
                      <td>{formatTime(item.issuedAt)}</td>
                      <td>
                        <button
                          type="button"
                          className="adm-btn adm-btn--tiny"
                          onClick={() => handleCopy(item.code, "激活码已复制")}
                        >
                          复制激活码
                        </button>
                        <button
                          type="button"
                          className="adm-btn adm-btn--tiny adm-btn--danger"
                          onClick={() => handleRevoke(item.machineId)}
                          disabled={busy}
                        >
                          解绑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="adm-empty">暂无签发记录。用户打开软件后，在激活窗口里能看到机器码。</p>
          )}
        </div>
      </section>

      {message ? <div className={`adm-message${messageOk ? " adm-message--ok" : ""}`}>{message}</div> : null}

      <footer className="adm-footer">
        私钥仅存于本机 <code>keys/private.pem</code>，已排除在版本库与安装包之外，请自行备份。
      </footer>
    </div>
  );
}

const container = document.getElementById("root");
createRoot(container).render(<LicenseAdminApp />);
