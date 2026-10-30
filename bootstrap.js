/* Kimi 划词助手 for Zotero 7-10
 * 划词 -> 浮出 Kimi 图标 -> 点击调用 Kimi API（可联网）显示解释
 */

const PREF_BRANCH = "extensions.zotero.kimiassist.";
const PLUGIN_ID = "kimiassist@kimi.local";

var G = {
  win: null,
  Zotero: null,
  timer: null,
  menuItem: null,
  pendingTimers: [],
};

function log(msg) {
  try { dump("[KimiAssist] " + msg + "\n"); } catch (e) {}
  try { if (G.Zotero) G.Zotero.debug("[KimiAssist] " + msg); } catch (e) {}
  try {
    const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    file.initWithPath("C:\\Users\\张岱\\Documents\\kimi\\workspace\\zotero-kimi\\plugin.log");
    const fos = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    fos.init(file, 0x02 | 0x08 | 0x10, 420, 0);
    const cos = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);
    cos.init(fos, "UTF-8");
    cos.writeString(new Date().toISOString() + " " + msg + "\n");
    cos.close();
    fos.close();
  } catch (e) {}
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    G.pendingTimers.push(timer); // 防止定时器被 GC 提前回收
    timer.initWithCallback({
      notify() {
        const i = G.pendingTimers.indexOf(timer);
        if (i >= 0) G.pendingTimers.splice(i, 1);
        resolve();
      },
    }, ms, Ci.nsITimer.TYPE_ONE_SHOT);
  });
}

function findMainWindow() {
  // Zotero 10 主窗口 windowtype 为 navigator:browser，老版本为 zotero:basic
  for (const type of ["zotero:basic", "navigator:browser"]) {
    const win = Services.wm.getMostRecentWindow(type);
    if (win && win.Zotero) return win;
  }
  const en = Services.wm.getEnumerator(null);
  while (en.hasMoreElements()) {
    const win = en.getNext();
    try { if (win && win.Zotero) return win; } catch (e) {}
  }
  return null;
}

async function waitForMainWindow() {
  let tries = 0;
  for (;;) {
    const win = findMainWindow();
    if (tries < 6 || tries % 20 === 0) {
      log("wait tries=" + tries + " win=" + !!win +
        " zotero=" + !!(win && win.Zotero) +
        " initialized=" + (win && win.Zotero ? String(win.Zotero.initialized) : "-") +
        " promise=" + !!(win && win.Zotero && win.Zotero.initializationPromise));
    }
    tries++;
    if (win && win.Zotero) {
      if (win.Zotero.initialized) return win;
      if (win.Zotero.initializationPromise) {
        log("awaiting initializationPromise");
        try {
          await Promise.race([
            win.Zotero.initializationPromise,
            delay(10000).then(() => { throw new Error("init promise timeout"); }),
          ]);
          log("initializationPromise resolved");
          return win;
        } catch (e) {
          log("init promise issue: " + e + "; 继续直接使用 Zotero 对象");
          return win;
        }
      }
      if (tries > 20) {
        log("Zotero 对象已存在，直接使用");
        return win;
      }
    }
    await delay(500);
  }
}

function getPref(name, fallback) {
  const branch = Services.prefs.getBranch(PREF_BRANCH);
  try {
    if (typeof fallback === "boolean") return branch.getBoolPref(name);
    return branch.getStringPref(name);
  } catch (e) {
    return fallback;
  }
}

function setPref(name, value) {
  const branch = Services.prefs.getBranch(PREF_BRANCH);
  if (typeof value === "boolean") branch.setBoolPref(name, value);
  else branch.setStringPref(name, value);
}

function startup(data, reason) {
  log("startup enter");
  waitForMainWindow()
    .then((win) => init(win))
    .catch((e) => log("startup failed: " + e));
}

function shutdown(data, reason) {
  try {
    if (G.win && G.timer) G.win.clearInterval(G.timer);
  } catch (e) {}
  try {
    if (G.menuItem) G.menuItem.remove();
  } catch (e) {}
  try {
    for (const reader of G.Zotero.Reader._readers || []) {
      const win = reader._iframeWindow;
      if (win && win.document) {
        for (const el of win.document.querySelectorAll(".kimi-assist-ui")) el.remove();
        win.__kimiAssistAttached = false;
      }
    }
  } catch (e) {}
  G.win = null;
  G.timer = null;
  G.menuItem = null;
}

function install(data, reason) {}
function uninstall(data, reason) {}

function init(win) {
  G.win = win;
  G.Zotero = win.Zotero;
  log("init");

  // Tools 菜单加设置入口
  const doc = win.document;
  const popup = doc.getElementById("menu_ToolsPopup");
  if (popup) {
    const item = doc.createXULElement
      ? doc.createXULElement("menuitem")
      : doc.createElement("menuitem");
    item.setAttribute("label", "Kimi 划词助手设置");
    item.setAttribute("id", "kimi-assist-settings");
    item.addEventListener("command", openSettings);
    popup.appendChild(item);
    G.menuItem = item;
  }

  G.timer = win.setInterval(scanReaders, 1500);
  scanReaders();
}

function openSettings() {
  try {
    log("openSettings enter");
    const doc = G.win.document;
  for (const el of doc.querySelectorAll("#kimi-assist-settings-overlay")) el.remove();

  const overlay = doc.createElement("div");
  overlay.id = "kimi-assist-settings-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483647;" +
    "display:flex;align-items:center;justify-content:center;font:14px/1.6 sans-serif;";

  const box = doc.createElement("div");
  box.style.cssText =
    "background:#fff;border-radius:12px;padding:18px 24px;width:420px;max-height:85vh;" +
    "overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);color:#222;";
  overlay.appendChild(box);

  const title = doc.createElement("div");
  title.textContent = "Kimi 划词助手设置";
  title.style.cssText = "font-size:17px;font-weight:bold;margin-bottom:6px;";
  box.appendChild(title);

  function addLabel(text) {
    const l = doc.createElement("div");
    l.textContent = text;
    l.style.cssText = "margin-top:10px;color:#444;";
    box.appendChild(l);
  }
  function addInput(value, type) {
    const i = doc.createElement("input");
    i.type = type || "text";
    i.value = value;
    i.style.cssText =
      "width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid #ccc;" +
      "border-radius:6px;font:13px sans-serif;";
    box.appendChild(i);
    return i;
  }
  function addHint(text) {
    const h = doc.createElement("div");
    h.textContent = text;
    h.style.cssText = "color:#888;font-size:12px;margin-top:3px;";
    box.appendChild(h);
  }
  function addCheckbox(text, checked, hint) {
    const label = doc.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:12px;cursor:pointer;";
    const cb = doc.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    const span = doc.createElement("span");
    span.textContent = text;
    label.appendChild(cb);
    label.appendChild(span);
    box.appendChild(label);
    if (hint) addHint(hint);
    return cb;
  }

  addLabel("服务商（选择后自动填入 API 地址和默认模型）");
  const providerSel = doc.createElement("select");
  providerSel.style.cssText = "width:100%;padding:5px 8px;border:1px solid #ccc;border-radius:6px;font:13px sans-serif;background:#fff;";
  const PROVIDERS = [
    { name: "Moonshot（Kimi）", baseurl: "https://api.moonshot.cn/v1", model: "kimi-k2.6" },
    { name: "DeepSeek", baseurl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { name: "OpenAI（GPT）", baseurl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
    { name: "自定义（其他兼容 OpenAI 格式的服务）", baseurl: "", model: "" },
  ];
  for (const p of PROVIDERS) {
    const opt = doc.createElement("option");
    opt.textContent = p.name;
    providerSel.appendChild(opt);
  }
  box.appendChild(providerSel);

  addLabel("API 地址（/v1 结尾，不要带 /chat/completions）");
  const baseurlInput = addInput(getPref("baseurl", "https://api.moonshot.cn/v1"));
  addLabel("API Key（在对应服务商的平台申请，sk- 开头）");
  const keyInput = addInput(getPref("apikey", ""), "password");
  addCheckbox("显示密钥", false).addEventListener("change", (e) => {
    keyInput.type = e.target.checked ? "text" : "password";
  });
  addLabel("模型名称");
  const modelInput = addInput(getPref("model", "kimi-k2.6"));

  providerSel.addEventListener("change", () => {
    const p = PROVIDERS[providerSel.selectedIndex];
    if (p.baseurl) baseurlInput.value = p.baseurl;
    if (p.model) modelInput.value = p.model;
  });

  const webCb = addCheckbox(
    "联网搜索（解释时检索网上资料）",
    getPref("web", true),
    "关闭后响应更快；仅 Moonshot（Kimi）支持，其他服务商会自动忽略"
  );
  const thinkCb = addCheckbox(
    "深度思考（模型先推理再回答）",
    getPref("thinking", true),
    "关闭后响应更快；仅对支持的模型生效，不支持时自动忽略"
  );

  const visionBtnCb = addCheckbox(
    "显示截图按钮 📷（公式 / 图表 / 特殊符号识别）",
    getPref("visionBtn", true),
    "开启后划词时 Kimi 图标旁会出现 📷，点它把选区截图+上下文发给视觉模型"
  );
  addLabel("视觉模型名称（截图识别用，需支持图像输入）");
  const visionModelInput = addInput(getPref("visionModel", "kimi-k2.6"));

  addLabel("上下文：划词位置之前截取的字符数");
  const beforeInput = addInput(getPref("ctxBefore", "3000"), "number");
  addLabel("上下文：划词位置之后截取的字符数");
  const afterInput = addInput(getPref("ctxAfter", "4000"), "number");
  addHint("上下文越大，解释越贴合原文，但更慢、更耗额度；0 表示不发送该侧内容。");

  const btnRow = doc.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:10px;margin-top:18px;";
  const cancelBtn = doc.createElement("button");
  cancelBtn.textContent = "取消";
  cancelBtn.style.cssText = "padding:6px 18px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;";
  cancelBtn.addEventListener("click", () => overlay.remove());
  const saveBtn = doc.createElement("button");
  saveBtn.textContent = "保存";
  saveBtn.style.cssText = "padding:6px 18px;border:none;border-radius:6px;background:#1c64f2;color:#fff;cursor:pointer;";
  saveBtn.addEventListener("click", () => {
    setPref("baseurl", baseurlInput.value.trim().replace(/\/+$/, "") || "https://api.moonshot.cn/v1");
    setPref("apikey", keyInput.value.trim());
    setPref("model", modelInput.value.trim() || "kimi-k2.6");
    setPref("web", webCb.checked);
    setPref("thinking", thinkCb.checked);
    setPref("visionBtn", visionBtnCb.checked);
    setPref("visionModel", visionModelInput.value.trim() || "kimi-k2.6");
    const before = Math.max(0, parseInt(beforeInput.value, 10) || 0);
    const after = Math.max(0, parseInt(afterInput.value, 10) || 0);
    setPref("ctxBefore", String(before));
    setPref("ctxAfter", String(after));
    overlay.remove();
    log("settings saved: web=" + webCb.checked + " thinking=" + thinkCb.checked +
      " before=" + before + " after=" + after);
  });
  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  box.appendChild(btnRow);

  (doc.body || doc.documentElement).appendChild(overlay);
    log("settings overlay appended");
  } catch (e) {
    log("openSettings error: " + e + " " + (e && e.stack));
  }
}

function scanReaders() {
  let readers;
  try { readers = G.Zotero.Reader._readers || []; } catch (e) { return; }
  for (const reader of readers) {
    try { attachReader(reader); } catch (e) { log("attach error: " + e); }
  }
}

function attachReader(reader) {
  const win = reader._iframeWindow;
  if (!win) return;
  attachWindow(win, reader, 0);
}

function attachWindow(win, reader, depth) {
  if (!win || depth > 4) return;
  try {
    if (win.document && win.document.body && !win.__kimiAssistAttached) {
      win.__kimiAssistAttached = true;
      log("attached depth=" + depth + " tab=" + reader.tabID + " url=" + String(win.location.href).slice(0, 90));
      win.document.addEventListener(
        "mouseup",
        (event) => {
          if (event.target && event.target.closest && event.target.closest(".kimi-assist-ui")) return;
          win.setTimeout(() => onMouseUp(win, reader), 60);
        },
        true
      );
    }
  } catch (e) {
    log("attachWindow error depth=" + depth + ": " + e);
  }
  // 递归处理内嵌 iframe（PDF 文本层在内层窗口里）
  try {
    for (let i = 0; i < win.frames.length; i++) {
      attachWindow(win.frames[i], reader, depth + 1);
    }
  } catch (e) {}
}

function clearUI(doc, selector) {
  for (const el of doc.querySelectorAll(selector)) el.remove();
}

function onMouseUp(win, reader) {
  try {
    const doc = win.document;
    const sel = win.getSelection();
    const text = sel ? sel.toString().trim() : "";
    log("mouseup url=" + String(win.location.href).slice(0, 60) + " textLen=" + text.length);
    clearUI(doc, ".kimi-assist-btn");
    if (!text || text.length > 3000 || sel.rangeCount === 0) return;

    let rect;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (e) { return; }
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

  // 取上下文：选区所在元素（通常是整段/整页文本层）的文字，截断到 4000 字
  let context = "";
  try {
    let node = sel.anchorNode;
    if (node && node.nodeType === 3) node = node.parentElement;
    if (node) context = (node.innerText || node.textContent || "").slice(0, 4000);
  } catch (e) {}

  const btn = doc.createElement("div");
  btn.className = "kimi-assist-ui kimi-assist-btn";
  btn.textContent = "Kimi";
  btn.style.cssText =
    "position:fixed;z-index:2147483647;background:#1c64f2;color:#fff;" +
    "padding:4px 12px;border-radius:14px;font:13px/1.4 sans-serif;cursor:pointer;" +
    "box-shadow:0 2px 8px rgba(0,0,0,.35);user-select:none;";
  btn.style.left = Math.max(4, Math.min(rect.left, win.innerWidth - 70)) + "px";
  btn.style.top = Math.max(4, rect.top - 34) + "px"; // 图标显示在划词上方
  btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.remove();
    showPanel(win, reader, text, context, rect);
  }, true);
  doc.body.appendChild(btn);
    log("button shown: " + text.slice(0, 40));

    // 旁边的 📷 截图按钮：把选区画面 + 上下文发给视觉模型（公式/图表/特殊符号）
    if (getPref("visionBtn", true)) {
      const shotBtn = doc.createElement("div");
      shotBtn.className = "kimi-assist-ui kimi-assist-btn";
      shotBtn.textContent = "📷";
      shotBtn.title = "截图识别（公式 / 图表 / 特殊符号）";
      shotBtn.style.cssText = btn.style.cssText;
      shotBtn.style.left = Math.max(4, Math.min(rect.left + 62, win.innerWidth - 50)) + "px";
      shotBtn.style.top = btn.style.top;
      shotBtn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      shotBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        shotBtn.remove();
        clearUI(doc, ".kimi-assist-btn");
        startRegionCapture(win, reader, text, context);
      }, true);
      doc.body.appendChild(shotBtn);
    }
  } catch (e) {
    log("onMouseUp error: " + e);
  }
}

// 矩形框选截图模式：全屏十字光标，拖出矩形后截取该区域
function startRegionCapture(win, reader, text, context) {
  const doc = win.document;
  const overlay = doc.createElement("div");
  overlay.className = "kimi-assist-ui";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.06);";
  const hint = doc.createElement("div");
  hint.textContent = "按住鼠标拖出矩形，框选要识别的公式 / 图表区域（Esc 取消）";
  hint.style.cssText =
    "position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#1c64f2;" +
    "color:#fff;padding:6px 14px;border-radius:8px;font:13px sans-serif;white-space:nowrap;";
  overlay.appendChild(hint);

  let startX = 0, startY = 0, box = null;
  const onKey = (e) => { if (e.key === "Escape") cleanup(); };
  function cleanup() {
    overlay.remove();
    doc.removeEventListener("keydown", onKey, true);
  }
  function updateBox(e) {
    const l = Math.min(startX, e.clientX), t = Math.min(startY, e.clientY);
    box.style.left = l + "px";
    box.style.top = t + "px";
    box.style.width = Math.abs(e.clientX - startX) + "px";
    box.style.height = Math.abs(e.clientY - startY) + "px";
  }
  overlay.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startY = e.clientY;
    box = doc.createElement("div");
    box.style.cssText =
      "position:fixed;border:2px dashed #1c64f2;background:rgba(28,100,242,.12);pointer-events:none;";
    overlay.appendChild(box);
    updateBox(e);
  }, true);
  overlay.addEventListener("mousemove", (e) => { if (box) updateBox(e); }, true);
  overlay.addEventListener("mouseup", (e) => {
    if (!box) return;
    e.preventDefault();
    e.stopPropagation();
    const l = Math.min(startX, e.clientX), t = Math.min(startY, e.clientY);
    const w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);
    cleanup();
    if (w < 8 || h < 8) return;
    const img = captureRegion(win, { left: l, top: t, width: w, height: h });
    if (!img) log("captureRegion 返回空，将使用文字模式");
    showPanel(win, reader, text, context, { left: l, bottom: t + h }, img, true);
  }, true);
  doc.addEventListener("keydown", onKey, true);
  doc.body.appendChild(overlay);
}

// 按视口矩形从 PDF 页面画布裁剪图片（dataURL）
function captureRegion(win, rect) {
  try {
    const doc = win.document;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let canvas = null;
    const pages = doc.querySelectorAll(".page");
    for (const page of pages) {
      const pr = page.getBoundingClientRect();
      if (cx >= pr.left && cx <= pr.right && cy >= pr.top && cy <= pr.bottom) {
        canvas = page.querySelector("canvas");
        break;
      }
    }
    if (!canvas) {
      // 矩形中心不在页内时，退而求其次：取第一个与矩形相交的页面
      for (const page of pages) {
        const pr = page.getBoundingClientRect();
        if (!(pr.right < rect.left || pr.left > rect.left + rect.width ||
              pr.bottom < rect.top || pr.top > rect.top + rect.height)) {
          canvas = page.querySelector("canvas");
          break;
        }
      }
    }
    if (!canvas || !canvas.width) { log("captureRegion: 未找到页面画布"); return null; }

    const cRect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / cRect.width;
    const scaleY = canvas.height / cRect.height;
    const sx = Math.max(0, Math.floor((rect.left - cRect.left) * scaleX));
    const sy = Math.max(0, Math.floor((rect.top - cRect.top) * scaleY));
    const sw = Math.min(canvas.width - sx, Math.ceil(rect.width * scaleX));
    const sh = Math.min(canvas.height - sy, Math.ceil(rect.height * scaleY));
    if (sw < 2 || sh < 2) { log("captureRegion: 裁剪尺寸无效"); return null; }

    const out = doc.createElement("canvas");
    out.width = sw;
    out.height = sh;
    out.getContext("2d").drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    log("captureRegion ok: " + sw + "x" + sh);
    return out.toDataURL("image/png");
  } catch (e) {
    log("captureRegion error: " + e);
    return null;
  }
}

async function showPanel(win, reader, text, context, rect, imageDataUrl, wantImage) {
  const doc = win.document;
  clearUI(doc, ".kimi-assist-panel");

  const panel = doc.createElement("div");
  panel.className = "kimi-assist-ui kimi-assist-panel";
  panel.style.cssText =
    "position:fixed;z-index:2147483647;background:#fff;color:#222;" +
    "border:1px solid #d0d0d0;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);" +
    "width:400px;max-width:92%;font:14px/1.65 sans-serif;overflow:hidden;";
  const left = Math.max(4, Math.min(rect.left, win.innerWidth - 420));
  const top = Math.min(rect.bottom + 6, Math.max(4, win.innerHeight - 200));
  panel.style.left = left + "px";
  panel.style.top = top + "px";

  const header = doc.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;" +
    "padding:6px 12px;background:#1c64f2;color:#fff;font-weight:bold;" +
    "cursor:move;user-select:none;";
  const headerTitle = doc.createElement("span");
  headerTitle.textContent = "Kimi 解释";
  header.appendChild(headerTitle);
  const headerBtns = doc.createElement("span");
  const collapseBtn = doc.createElement("span");
  collapseBtn.textContent = "—";
  collapseBtn.title = "收起 / 展开";
  collapseBtn.style.cssText = "cursor:pointer;padding:0 8px;";
  const close = doc.createElement("span");
  close.textContent = "✕";
  close.style.cssText = "cursor:pointer;padding:0 4px;";
  close.addEventListener("click", () => panel.remove());
  headerBtns.appendChild(collapseBtn);
  headerBtns.appendChild(close);
  header.appendChild(headerBtns);

  // 对话滚动区
  const body = doc.createElement("div");
  body.style.cssText =
    "padding:10px 12px;max-height:45vh;overflow-y:auto;" +
    "display:flex;flex-direction:column;gap:8px;";

  // 底部追问输入区
  const inputRow = doc.createElement("div");
  inputRow.style.cssText = "display:flex;gap:8px;padding:8px 12px;border-top:1px solid #e5e5e5;align-items:flex-end;";
  const input = doc.createElement("textarea");
  input.rows = 2;
  input.placeholder = "追问…（Enter 发送，Shift+Enter 换行）";
  input.style.cssText =
    "flex:1;resize:none;border:1px solid #ccc;border-radius:6px;padding:5px 8px;" +
    "font:13px/1.5 sans-serif;box-sizing:border-box;";
  const sendBtn = doc.createElement("button");
  sendBtn.textContent = "发送";
  sendBtn.style.cssText =
    "padding:6px 14px;border:none;border-radius:6px;background:#1c64f2;color:#fff;cursor:pointer;font-size:13px;";
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(inputRow);
  doc.body.appendChild(panel);

  // 右下角拖拽手柄：手动调整窗口大小
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  body.style.flex = "1 1 auto";
  body.style.minHeight = "60px";
  const resizeHandle = doc.createElement("div");
  resizeHandle.textContent = "◢";
  resizeHandle.title = "拖动调整大小";
  resizeHandle.style.cssText =
    "position:absolute;right:1px;bottom:0;width:18px;height:18px;line-height:18px;" +
    "text-align:center;color:#999;cursor:nwse-resize;user-select:none;font-size:12px;";
  panel.appendChild(resizeHandle);

  // 左下角拖拽手柄：向左拉宽、向下拉高
  const resizeHandleLeft = doc.createElement("div");
  resizeHandleLeft.textContent = "◣";
  resizeHandleLeft.title = "拖动调整大小";
  resizeHandleLeft.style.cssText =
    "position:absolute;left:1px;bottom:0;width:18px;height:18px;line-height:18px;" +
    "text-align:center;color:#999;cursor:sw-resize;user-select:none;font-size:12px;";
  panel.appendChild(resizeHandleLeft);
  resizeHandleLeft.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panel.offsetWidth;
    const startH = panel.offsetHeight;
    const startLeft = panel.offsetLeft;
    body.style.maxHeight = "none";
    const onMove = (ev) => {
      ev.preventDefault();
      const dx = ev.clientX - startX;
      const newW = Math.max(280, Math.min(startW - dx, win.innerWidth * 0.95));
      panel.style.width = newW + "px";
      panel.style.left = Math.max(0, startLeft + (startW - newW)) + "px";
      panel.style.height = Math.max(160, Math.min(startH + ev.clientY - startY, win.innerHeight * 0.9)) + "px";
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("mouseup", onUp, true);
    };
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
  }, true);
  resizeHandle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panel.offsetWidth;
    const startH = panel.offsetHeight;
    body.style.maxHeight = "none"; // 手动调整后由面板高度决定滚动区
    const onMove = (ev) => {
      ev.preventDefault();
      panel.style.width = Math.max(280, Math.min(startW + ev.clientX - startX, win.innerWidth * 0.95)) + "px";
      panel.style.height = Math.max(160, Math.min(startH + ev.clientY - startY, win.innerHeight * 0.9)) + "px";
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("mouseup", onUp, true);
    };
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
  }, true);

  // 收起 / 展开
  let collapsed = false;
  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? "none" : "flex";
    inputRow.style.display = collapsed ? "none" : "flex";
    collapseBtn.textContent = collapsed ? "＋" : "—";
    // 收起时收掉手动设置的高度，展开时恢复
    if (collapsed) {
      panel.__savedHeight = panel.style.height;
      panel.style.height = "auto";
    } else if (panel.__savedHeight) {
      panel.style.height = panel.__savedHeight;
    }
  });

  // 按住标题栏拖动面板（点在按钮上不拖）
  header.addEventListener("mousedown", (e) => {
    if (e.target === close || e.target === collapseBtn) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origLeft = panel.offsetLeft;
    const origTop = panel.offsetTop;
    const onMove = (ev) => {
      ev.preventDefault();
      panel.style.left = Math.max(0, origLeft + ev.clientX - startX) + "px";
      panel.style.top = Math.max(0, origTop + ev.clientY - startY) + "px";
    };
    const onUp = () => {
      doc.removeEventListener("mousemove", onMove, true);
      doc.removeEventListener("mouseup", onUp, true);
    };
    doc.addEventListener("mousemove", onMove, true);
    doc.addEventListener("mouseup", onUp, true);
  }, true);

  // 对话状态：baseMessages 含论文标题/划词/上下文，history 为后续问答（只保留纯文本消息）
  let baseMessages = null;
  const history = [];
  let busy = false;

  function scrollBottom() {
    body.scrollTop = body.scrollHeight;
  }

  function addBubble(role, content) {
    const b = doc.createElement("div");
    b.style.cssText =
      "max-width:92%;padding:7px 11px;border-radius:9px;white-space:pre-wrap;word-break:break-word;font-size:13.5px;" +
      (role === "user"
        ? "align-self:flex-end;background:#e3efff;"
        : "align-self:flex-start;background:#f4f4f4;");
    b.textContent = content;
    body.appendChild(b);
    scrollBottom();
    return b;
  }

  async function send(question) {
    if (busy || !baseMessages) return;
    const apiKey = getPref("apikey", "");
    if (!apiKey) {
      addBubble("assistant", "还没有配置 API Key。\n请在 Zotero 主窗口菜单：工具 → Kimi 划词助手设置 中填写。");
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    input.disabled = true;
    sendBtn.textContent = "…";
    if (question) {
      addBubble("user", question);
      history.push({ role: "user", content: question });
    }
    const thinking = addBubble("assistant", "Kimi 思考中…");
    try {
      const answer = await askKimi(apiKey, baseMessages.concat(history),
        imageDataUrl ? getPref("visionModel", "kimi-k2.6") : null);
      thinking.textContent = answer;
      history.push({ role: "assistant", content: answer });
      // 最多保留最近 20 条问答记录，避免越聊越慢越贵
      if (history.length > 20) history.splice(0, history.length - 20);
    } catch (e) {
      thinking.textContent = "出错了：" + (e && e.message ? e.message : String(e));
      if (question) history.pop();
    }
    busy = false;
    sendBtn.disabled = false;
    input.disabled = false;
    sendBtn.textContent = "发送";
    scrollBottom();
    input.focus();
  }

  function doSend() {
    const q = input.value.trim();
    if (!q || busy) return;
    input.value = "";
    send(q);
  }
  sendBtn.addEventListener("click", doSend);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // 准备全文上下文并发起首次解释
  let item = null;
  try {
    item = reader.item || (reader.itemID ? G.Zotero.Items.get(reader.itemID) : null);
  } catch (e) { log("get item error: " + e); }
  let title = "";
  try { title = item ? item.getField("title") : ""; } catch (e) {}
  let fullContext = context;
  try {
    let content = item ? await G.Zotero.FullText.getItemContent(item.id) : null;
    if (!item) log("reader.item/itemID 均不可用，无法读全文索引");
    if (content) {
      const norm = (s) => s.replace(/\s+/g, " ");
      const hay = norm(content);
      const needle = norm(text).slice(0, 80);
      const idx = hay.indexOf(needle);
      const center = idx >= 0 ? idx : 0;
      const before = Math.max(0, parseInt(getPref("ctxBefore", "3000"), 10) || 0);
      const after = Math.max(0, parseInt(getPref("ctxAfter", "4000"), 10) || 0);
      fullContext = hay.slice(Math.max(0, center - before), center + after);
      log("fulltext totalLen=" + hay.length + " matchIdx=" + idx + " ctx=" + before + "/" + after);
    }
  } catch (e) {
    log("fulltext error: " + e);
  }
  baseMessages = buildMessages(text, fullContext, title);
  if (imageDataUrl) {
    // 视觉模式：同一次请求同时发送选区截图与文字上下文
    baseMessages[1].content = [
      {
        type: "text",
        text: baseMessages[1].content +
          "\n\n（附划选区域截图：请主要依据截图识别其中的公式、符号或图表，" +
          "再结合论文标题与文字上下文解释它在本文中的含义和作用）",
      },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ];
  }
  addBubble("user", (imageDataUrl ? "截图解释：" : "解释：") + (text.length > 120 ? text.slice(0, 120) + "…" : text));
  if (wantImage && !imageDataUrl) {
    addBubble("assistant", "提示：未能从 PDF 画布截取选区（可能选区已失效），本次先用文字模式解释。可以重新划选后再点 📷。");
  }
  send(null);
}

function buildMessages(text, context, title) {
  return [
    {
      role: "system",
      content:
        "你是 Kimi，正在帮助用户阅读学术论文。用户用鼠标划选了一段内容，" +
        "请用简洁易懂的中文解释它：先说它是什么，再结合论文上下文说明它在文中的作用/含义；" +
        "如果是术语，给出英文全称（若适用）；如果是公式或方法，解释其直观意义。" +
        "不要冗长，200 字以内为主，必要时可用短列表。" +
        "之后用户可能针对你的解释继续追问，请结合论文上下文和已有对话回答。",
    },
    {
      role: "user",
      content:
        "论文标题：" + (title || "未知") +
        "\n\n划选内容：\n" + text +
        "\n\n论文全文中划选处附近的原文：\n" + (context || "（未获取到）"),
    },
  ];
}

async function askKimi(apiKey, messages, modelOverride) {
  const model = modelOverride || getPref("model", "kimi-k2.6");
  const baseurl = getPref("baseurl", "https://api.moonshot.cn/v1").replace(/\/+$/, "");
  const isMoonshot = /api\.moonshot\.cn/.test(baseurl);
  // 联网搜索、思考开关、温度限制是 Moonshot 特有行为，其他服务商走标准 OpenAI 兼容格式
  // 视觉（截图）请求不挂联网工具，直接图像+上下文一次回答
  const useWeb = getPref("web", true) && isMoonshot && !modelOverride;
  let disableReasoning = !getPref("thinking", true) && isMoonshot;
  const msgs = messages.slice();

  for (let round = 0; round < 6; round++) {
    const payload = { model, messages: msgs };
    if (isMoonshot) payload.temperature = 1;
    if (useWeb) payload.tools = [{ type: "builtin_function", function: { name: "$web_search" } }];
    if (disableReasoning) payload.reasoning_effort = "none";

    const resp = await G.win.fetch(baseurl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify(payload),
    });
    const raw = await resp.text();
    // 模型不支持关闭思考时，去掉该参数自动重试
    if (!resp.ok && disableReasoning && resp.status === 400) {
      log("reasoning_effort 不被支持，改为默认思考模式重试");
      disableReasoning = false;
      continue;
    }
    let json;
    try { json = JSON.parse(raw); } catch (e) { throw new Error("HTTP " + resp.status + ": " + raw.slice(0, 300)); }
    if (!resp.ok) throw new Error("HTTP " + resp.status + ": " + (json.error ? json.error.message : raw.slice(0, 300)));

    const msg = json.choices[0].message;
    if (msg.tool_calls && msg.tool_calls.length) {
      msgs.push(msg);
      for (const tc of msg.tool_calls) {
        // Moonshot 内置联网搜索：把参数原样回传即由服务端执行
        msgs.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: tc.function.arguments,
        });
      }
      continue;
    }
    return msg.content || "（空回复）";
  }
  throw new Error("联网搜索轮次过多，未得到回答");
}
