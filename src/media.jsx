import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./media.css";

/**
 * 宠物素材库管理窗口（V2.1）
 * - 浏览 / 批量导入素材（图片、动图、视频），可视化素材网格
 * - 三个情绪槽位（待机 / 开心 / 沮丧）绑定与解除绑定，恢复默认
 * - 选中素材后可"试穿"到宠物上实时预览，也可重命名 / 删除
 * 数据源：绑定存于主进程 Data/mood-bindings.json，素材目录为 userData/mood-media
 */

const MOOD_META = [
  { key: "idle", label: "待机", desc: "行情持平 / 空仓" },
  { key: "happy", label: "开心", desc: "今日盈利" },
  { key: "sad", label: "沮丧", desc: "今日亏损" }
];

const MOOD_COLORS = { idle: "#38bdf8", happy: "#fbbf24", sad: "#f87171" };
const KIND_NAMES = { image: "图片", video: "视频" };

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 素材缩略图：图片直接显示；视频在 active（悬停/选中）时循环静音播放 */
function MediaThumb({ item, active }) {
  if (item.kind === "video") {
    return (
      <video
        key={item.name}
        className="ml-thumb-video"
        src={item.url}
        muted
        loop
        playsInline
        disablePictureInPicture
        preload={active ? "auto" : "none"}
        ref={(el) => {
          if (!el) return;
          if (active) {
            el.play().catch(() => {});
          } else {
            el.pause();
          }
        }}
      />
    );
  }
  return <img key={item.name} className="ml-thumb-img" src={item.url} alt={item.name} loading="lazy" draggable={false} />;
}

function App() {
  const [items, setItems] = useState(null);
  const [bindings, setBindings] = useState({});
  const [selectedName, setSelectedName] = useState("");
  const [hoverName, setHoverName] = useState("");
  const [previewing, setPreviewing] = useState(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const noticeTimerRef = useRef(null);
  const deleteTimerRef = useRef(null);

  const showNotice = useCallback((text) => {
    setNotice(text);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3600);
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [list, bound] = await Promise.all([
        window.stockWatcher.getMedia(),
        window.stockWatcher.getMoodBindings()
      ]);
      setItems(list || []);
      setBindings(bound && typeof bound === "object" ? bound : {});
    } catch (_error) {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 主进程广播：绑定 / 素材目录变化时自动同步
  useEffect(() => {
    const offBindings = window.stockWatcher.onMoodBindingsChanged((bound) => {
      setBindings(bound && typeof bound === "object" ? bound : {});
    });
    const offLibrary = window.stockWatcher.onMediaLibraryChanged((list) => {
      setItems(list || []);
    });
    return () => {
      offBindings();
      offLibrary();
    };
  }, []);

  // 素材被删除/改名后收敛选中与重命名状态
  useEffect(() => {
    if (!items) return;
    if (selectedName && !items.some((item) => item.name === selectedName)) {
      setSelectedName("");
      setRenaming(false);
      setDeleteArmed(false);
    }
  }, [items, selectedName]);

  const selectedItem = items ? items.find((item) => item.name === selectedName) : null;

  const boundNameOf = (moodKey) => bindings[moodKey] || "";
  const moodKeysOf = (fileName) => MOOD_META.filter((meta) => bindings[meta.key] === fileName).map((meta) => meta.key);

  const handleImport = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.stockWatcher.pickMediaImport();
      if (result && result.items && result.items.length) {
        showNotice(`成功导入 ${result.items.length} 个素材`);
      } else if (result && result.rejected) {
        showNotice(`${result.rejected} 个文件因格式不支持或超过 300MB 被跳过`);
      }
      await loadAll();
    } catch (_error) {
      showNotice("导入失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [busy, loadAll, showNotice]);

  const bindTo = useCallback(
    async (moodKey) => {
      if (!selectedItem || busy) return;
      const meta = MOOD_META.find((m) => m.key === moodKey);
      const next = { ...bindings, [moodKey]: selectedItem.name };
      setBusy(true);
      try {
        await window.stockWatcher.setMoodBindings(next);
        showNotice(`已把「${selectedItem.name}」设为「${meta.label}」显示`);
      } catch (_error) {
        showNotice("绑定失败，请重试");
      } finally {
        setBusy(false);
      }
    },
    [selectedItem, busy, bindings, showNotice]
  );

  const unbindMood = useCallback(
    async (moodKey) => {
      if (busy) return;
      const meta = MOOD_META.find((m) => m.key === moodKey);
      const next = { ...bindings };
      delete next[moodKey];
      setBusy(true);
      try {
        await window.stockWatcher.setMoodBindings(next);
        showNotice(`「${meta.label}」已恢复默认形象`);
      } catch (_error) {
        showNotice("解除失败，请重试");
      } finally {
        setBusy(false);
      }
    },
    [busy, bindings, showNotice]
  );

  const togglePreview = useCallback(async () => {
    if (!selectedItem || busy) return;
    if (previewing === selectedItem.name) {
      setPreviewing(null);
      await window.stockWatcher.previewMedia(null).catch(() => {});
      showNotice("已结束试穿");
      return;
    }
    try {
      await window.stockWatcher.previewMedia(selectedItem);
      setPreviewing(selectedItem.name);
      showNotice(`试穿中：${selectedItem.name}，宠物窗口已即时显示`);
    } catch (_error) {
      showNotice("试穿失败，请确认素材可播放");
    }
  }, [selectedItem, busy, previewing, showNotice]);

  const handleDelete = useCallback(async () => {
    if (!selectedItem || busy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      showNotice(`再次点击「确认删除」删除 ${selectedItem.name}（不可恢复）`);
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = window.setTimeout(() => setDeleteArmed(false), 4000);
      return;
    }
    if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    setDeleteArmed(false);
    setBusy(true);
    try {
      const result = await window.stockWatcher.deleteMediaItem(selectedItem.name);
      if (result && result.ok) {
        if (previewing === selectedItem.name) {
          setPreviewing(null);
          window.stockWatcher.previewMedia(null).catch(() => {});
        }
        setSelectedName("");
        showNotice(`已删除 ${selectedItem.name}（原绑定已同步解除）`);
        await loadAll();
      } else {
        showNotice((result && result.message) || "删除失败，文件可能被占用");
      }
    } catch (_error) {
      showNotice("删除失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [selectedItem, busy, deleteArmed, previewing, loadAll, showNotice]);

  const beginRename = useCallback(() => {
    if (!selectedItem) return;
    setRenameDraft(selectedItem.name);
    setRenaming(true);
  }, [selectedItem]);

  const saveRename = useCallback(async () => {
    if (!selectedItem) return;
    const newName = (renameDraft || "").trim();
    setRenaming(false);
    if (!newName || newName === selectedItem.name) return;
    setBusy(true);
    try {
      const result = await window.stockWatcher.renameMediaItem(selectedItem.name, newName);
      if (result && result.ok) {
        const renamed = result.item ? result.item.name : newName;
        setSelectedName(renamed);
        if (previewing === selectedItem.name && result.item) {
          setPreviewing(renamed);
          window.stockWatcher.previewMedia(result.item).catch(() => {});
        }
        showNotice(`已重命名为 ${renamed}`);
        await loadAll();
      } else {
        showNotice((result && result.message) || "重命名失败");
      }
    } catch (_error) {
      showNotice("重命名失败，请重试");
    } finally {
      setBusy(false);
    }
  }, [selectedItem, renameDraft, busy, previewing, loadAll, showNotice]);

  return (
    <div className="ml-root">
      <header className="ml-header">
        <div className="ml-brand">
          <span className="ml-logo">牛</span>
          <div className="ml-brand-text">
            <h1>宠物素材库</h1>
            <p>按情绪槽位搭配形象，支持图片 / 动图 / 视频。选中素材后可试穿、绑定或管理</p>
          </div>
        </div>
        <div className="ml-header-actions">
          <button type="button" className="ml-btn" onClick={loadAll} title="重新读取素材目录与绑定">
            刷新
          </button>
          <button type="button" className="ml-btn ml-btn--primary" onClick={handleImport} disabled={busy}>
            导入素材…
          </button>
        </div>
      </header>

      <section className="ml-slots">
        {MOOD_META.map((meta) => {
          const boundName = boundNameOf(meta.key);
          const boundItem = items && items.find((item) => item.name === boundName);
          return (
            <div key={meta.key} className="ml-slot" style={{ "--accent": MOOD_COLORS[meta.key] }}>
              <div className="ml-slot-head">
                <span className="ml-slot-dot" />
                <span className="ml-slot-title">{meta.label}</span>
                <span className="ml-slot-desc">{meta.desc}</span>
              </div>
              <div
                className="ml-slot-body"
                onClick={() => {
                  if (boundItem) {
                    setSelectedName(boundItem.name);
                    setDeleteArmed(false);
                  }
                }}
              >
                {boundItem ? (
                  <MediaThumb item={boundItem} active={false} />
                ) : (
                  <div className="ml-slot-empty">{boundName ? "原文件已缺失" : "默认形象"}</div>
                )}
              </div>
              <div className="ml-slot-foot">
                {boundItem ? (
                  <>
                    <span className="ml-slot-name" title={boundItem.name}>
                      {truncate(boundItem.name, 26)}
                    </span>
                    <button type="button" className="ml-btn ml-btn--tiny" onClick={() => unbindMood(meta.key)} disabled={busy}>
                      移除
                    </button>
                  </>
                ) : (
                  <span className="ml-slot-muted">{boundName ? "原文件已被删除" : "未自定义（内置形象）"}</span>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="ml-grid">
        <div className="ml-grid-head">
          <h2>全部素材</h2>
          <span className="ml-count">{items === null ? "读取中…" : `${items.length} 个`}</span>
        </div>

        {items === null ? (
          <div className="ml-state">正在读取素材库…</div>
        ) : items.length === 0 ? (
          <div className="ml-state ml-state--empty">
            <p className="ml-state-title">素材库还是空的</p>
            <p className="ml-state-sub">
              点击右上角「导入素材…」选择图片 / 动图 / 视频；也可以把文件直接放进素材目录后点「刷新」。
            </p>
          </div>
        ) : (
          <div className="ml-cards">
            {items.map((item) => {
              const isSelected = selectedName === item.name;
              const isHover = hoverName === item.name;
              const showVideo = item.kind === "video" && (isSelected || isHover);
              const tags = moodKeysOf(item.name);
              return (
                <div
                  key={item.name}
                  className={`ml-card${isSelected ? " ml-card--selected" : ""}`}
                  title={item.name}
                  onClick={() => {
                    setSelectedName(item.name);
                    setDeleteArmed(false);
                  }}
                  onMouseEnter={() => setHoverName(item.name)}
                  onMouseLeave={() => setHoverName("")}
                >
                  <div className="ml-card-thumb">
                    {item.kind === "image" ? (
                      <MediaThumb item={item} active={false} />
                    ) : (
                      <>
                        <MediaThumb item={item} active={showVideo} />
                        {!showVideo && <span className="ml-video-hint" />}
                      </>
                    )}
                  </div>
                  <div className="ml-card-meta">
                    <span className={`ml-kind ml-kind--${item.kind}`}>{KIND_NAMES[item.kind]}</span>
                    <span className="ml-name" title={item.name}>
                      {item.name}
                    </span>
                  </div>
                  {tags.length > 0 && (
                    <div className="ml-tags">
                      {tags.map((moodKey) => {
                        const meta = MOOD_META.find((m) => m.key === moodKey);
                        return (
                          <span key={moodKey} className="ml-tag" style={{ color: MOOD_COLORS[moodKey] }}>
                            {meta ? meta.label : moodKey}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="ml-actions">
        {selectedItem ? (
          <>
            <div className="ml-actions-info">
              <strong className="ml-actions-name" title={selectedItem.name}>
                {truncate(selectedItem.name, 30)}
              </strong>
              <span className={`ml-kind ml-kind--${selectedItem.kind}`}>{KIND_NAMES[selectedItem.kind]}</span>
              {previewing && previewing !== selectedItem.name && (
                <span className="ml-previewing">宠物正在试穿：{truncate(previewing, 24)}</span>
              )}
            </div>
            <div className="ml-actions-buttons">
              {MOOD_META.map((meta) => {
                const boundHere = bindings[meta.key] === selectedItem.name;
                return (
                  <button
                    key={meta.key}
                    type="button"
                    className="ml-btn ml-btn--bind"
                    style={boundHere ? { color: MOOD_COLORS[meta.key], borderColor: MOOD_COLORS[meta.key] } : undefined}
                    disabled={boundHere || busy}
                    title={boundHere ? `该素材已是「${meta.label}」显示` : `把该素材设为「${meta.label}」显示`}
                    onClick={() => bindTo(meta.key)}
                  >
                    {boundHere ? `已设${meta.label}` : `设为${meta.label}`}
                  </button>
                );
              })}
              <button
                type="button"
                className={`ml-btn ml-btn--accent${previewing === selectedItem.name ? " ml-btn--active" : ""}`}
                onClick={togglePreview}
                disabled={busy}
              >
                {previewing === selectedItem.name ? "停止试穿" : "试穿到宠物"}
              </button>
              <button type="button" className="ml-btn" onClick={beginRename} disabled={busy}>
                重命名
              </button>
              <button
                type="button"
                className={`ml-btn ml-btn--danger${deleteArmed ? " ml-btn--armed" : ""}`}
                onClick={handleDelete}
                disabled={busy}
              >
                {deleteArmed ? "确认删除" : "删除素材"}
              </button>
            </div>
          </>
        ) : (
          <div className="ml-actions-hint">点击下方素材卡片，可设为各情绪显示 / 试穿 / 重命名 / 删除</div>
        )}
      </footer>

      {renaming && selectedItem && (
        <div className="ml-rename-bar">
          <span className="ml-rename-label">重命名为：</span>
          <input
            className="ml-input"
            value={renameDraft}
            spellCheck={false}
            autoFocus
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") saveRename();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
          <button type="button" className="ml-btn ml-btn--primary" onClick={saveRename} disabled={busy}>
            保存
          </button>
          <button type="button" className="ml-btn" onClick={() => setRenaming(false)} disabled={busy}>
            取消
          </button>
        </div>
      )}

      {notice && <div className="ml-toast">{notice}</div>}
    </div>
  );
}

function main() {
  const container = document.getElementById("root");
  const root = createRoot(container);
  root.render(<App />);
}

main();
