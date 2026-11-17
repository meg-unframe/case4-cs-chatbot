/*
 * BOTANICA チャットウィジェット 埋め込みスクリプト
 *
 * 使い方（ECサイトの HTML に1行貼るだけ）:
 *   <script src="https://<ホスト>/widget-embed.js" defer></script>
 *
 * - 右下にチャットボタンを表示し、クリックで <ホスト>/widget を iframe で開閉する
 * - PC は幅 380px・高さ 600px のパネル、スマホ幅（480px 以下）は全画面
 * - ホストはこのスクリプト自身の src から求める
 * - グローバル変数は作らない（IIFE）。二重読み込み時は何もしない
 */
(function () {
  "use strict";

  var PREFIX = "botanica-chat";
  var LAUNCHER_ID = PREFIX + "-launcher";
  var CLOSE_MESSAGE = "botanica-widget:close";

  if (document.getElementById(LAUNCHER_ID)) return;

  // ---- ホストの決定（script 自身の src から） ----
  function findScriptSrc() {
    var current = document.currentScript;
    if (current && current.src) return current.src;
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (/\/widget-embed\.js(\?|#|$)/.test(src)) return src;
    }
    return null;
  }

  var scriptSrc = findScriptSrc();
  if (!scriptSrc) return;
  var origin;
  try {
    origin = new URL(scriptSrc, window.location.href).origin;
  } catch {
    return;
  }
  var widgetUrl = origin + "/widget";

  var mobileQuery = window.matchMedia("(max-width: 480px)");
  var isOpen = false;
  var frame = null;
  var panel = null;
  var launcher = null;

  var CHAT_ICON =
    '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">' +
    '<path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-4.5 3.6A.9.9 0 0 1 3 20.9V6a2 2 0 0 1 1-2Zm3 6.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Zm5 0a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 0 0 0-2.4Z"/>' +
    "</svg>";
  var CLOSE_ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">' +
    '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    "</svg>";

  function setStyles(el, styles) {
    for (var key in styles) {
      if (Object.prototype.hasOwnProperty.call(styles, key)) el.style.setProperty(key, styles[key]);
    }
  }

  // ---- パネルの配置（PC: 右下の小窓 / スマホ: 全画面） ----
  function layoutPanel() {
    if (!panel) return;
    if (mobileQuery.matches) {
      setStyles(panel, {
        top: "0",
        left: "0",
        right: "0",
        bottom: "0",
        width: "100%",
        height: "100%",
        "max-height": "none",
        "border-radius": "0",
      });
    } else {
      setStyles(panel, {
        top: "auto",
        left: "auto",
        right: "20px",
        bottom: "92px",
        width: "380px",
        height: "600px",
        "max-height": "calc(100vh - 112px)",
        "border-radius": "16px",
      });
    }
    // スマホの全画面表示中はボタンを隠す（ウィジェット内の閉じるボタンで閉じる）
    launcher.style.setProperty("display", isOpen && mobileQuery.matches ? "none" : "flex");
  }

  function createPanel() {
    panel = document.createElement("div");
    panel.id = PREFIX + "-panel";
    setStyles(panel, {
      position: "fixed",
      "z-index": "2147483000",
      overflow: "hidden",
      background: "#f6f8f3",
      "box-shadow": "0 12px 40px rgba(20, 50, 35, 0.28)",
      display: "none",
    });

    frame = document.createElement("iframe");
    frame.src = widgetUrl;
    frame.title = "BOTANICA サポートチャット";
    frame.setAttribute("allow", "clipboard-write");
    setStyles(frame, { width: "100%", height: "100%", border: "0", display: "block" });

    panel.appendChild(frame);
    document.body.appendChild(panel);
  }

  function render() {
    if (panel) panel.style.setProperty("display", isOpen ? "block" : "none");
    launcher.innerHTML = isOpen ? CLOSE_ICON : CHAT_ICON;
    launcher.setAttribute("aria-label", isOpen ? "チャットを閉じる" : "チャットで問い合わせる");
    launcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
    layoutPanel();
  }

  function setOpen(next) {
    isOpen = next;
    // iframe は初回に開いたときだけ作る（開かない訪問者に匿名サインインさせない）
    if (isOpen && !panel) createPanel();
    render();
    if (isOpen && frame) {
      try {
        frame.focus();
      } catch {
        // フォーカスできなくても開閉には影響しない
      }
    } else if (!isOpen) {
      launcher.focus();
    }
  }

  function init() {
    launcher = document.createElement("button");
    launcher.id = LAUNCHER_ID;
    launcher.type = "button";
    launcher.setAttribute("aria-controls", PREFIX + "-panel");
    setStyles(launcher, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      "z-index": "2147483001",
      width: "60px",
      height: "60px",
      "border-radius": "50%",
      border: "none",
      padding: "0",
      cursor: "pointer",
      background: "#2f6b4f",
      color: "#ffffff",
      "box-shadow": "0 6px 20px rgba(20, 50, 35, 0.35)",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
    });
    launcher.addEventListener("click", function () {
      setOpen(!isOpen);
    });
    document.body.appendChild(launcher);
    render();

    // ウィジェット（iframe）からの「閉じる」依頼。送信元を自分の iframe とホストに限定する
    window.addEventListener("message", function (event) {
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== origin) return;
      var data = event.data;
      if (data && typeof data === "object" && data.type === CLOSE_MESSAGE) setOpen(false);
    });

    // Esc で閉じる（親ページにフォーカスがあるとき）
    document.addEventListener("keydown", function (event) {
      if (isOpen && (event.key === "Escape" || event.key === "Esc")) setOpen(false);
    });

    var onChange = function () {
      layoutPanel();
    };
    if (mobileQuery.addEventListener) mobileQuery.addEventListener("change", onChange);
    else if (mobileQuery.addListener) mobileQuery.addListener(onChange);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
