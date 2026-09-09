// ============ J.A.R.V.I.S — web UI ============
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---- Live clock ----
  const clockEl = $("#clock");
  function tick() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    clockEl.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }
  tick();
  setInterval(tick, 1000);

  // ---- Mock CPU / RAM (periodic jitter) ----
  const topCpu = $("#topCpu"), topRam = $("#topRam");
  const cpuBar = $("#cpuBar"), ramBar = $("#ramBar");
  const cpuPct = $("#cpuPct"), ramPct = $("#ramPct");
  let cpu = 4, ram = 76;
  function jitter(val, lo, hi, step) {
    val += (Math.random() - 0.5) * step;
    return Math.max(lo, Math.min(hi, val));
  }
  function refreshStats() {
    cpu = Math.round(jitter(cpu, 2, 28, 6));
    ram = Math.round(jitter(ram, 60, 92, 4));
    topCpu.textContent = cpu;
    topRam.textContent = ram;
    cpuBar.style.width = cpu + "%";
    ramBar.style.width = ram + "%";
    cpuPct.textContent = cpu + "%";
    ramPct.textContent = ram + "%";
  }
  refreshStats();
  setInterval(refreshStats, 2500);

  // ---- Mute toggle ----
  let muted = false;
  $("#muteBtn").addEventListener("click", () => {
    muted = !muted;
    $("#muteIcon").textContent = muted ? "🔇" : "🔊";
  });

  // ---- Sidebar nav: switch views ----
  const navItems = $$(".nav-item");
  const views = {
    HOME: $("#view-HOME"),
    CHAT: $("#view-CHAT"),
    VISION: $("#view-VISION"),
    MEMORY: $("#view-MEMORY"),
    SETTINGS: $("#view-SETTINGS"),
  };
  function activate(view) {
    navItems.forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    Object.entries(views).forEach(([k, el]) => el.classList.toggle("active", k === view));
  }
  navItems.forEach((n) => n.addEventListener("click", (e) => {
    e.preventDefault();
    activate(n.dataset.view);
  }));

  // ---- Recent list (one entry per session, not per message) ----
  const recentList = $("#recentList");
  const seedRecent = ["write a program to build a spa...", "hi"];
  let recent = seedRecent.slice();
  let currentSessionTitle = null; // title of the active session, or null if none yet

  function renderRecent(items) {
    recentList.innerHTML = "";
    items.forEach((t) => {
      const li = document.createElement("li");
      li.textContent = t;
      li.title = t;
      li.addEventListener("click", () => {
        activate("CHAT");
        $("#chatInput").value = t;
        $("#chatInput").focus();
      });
      recentList.appendChild(li);
    });
  }
  renderRecent(recent);

  // ---- Timestamps ----
  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // ---- Very small markdown renderer (headers, bold, inline code, code fences, lists) ----
  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderMarkdown(raw) {
    const escaped = escapeHtml(raw);
    // code fences ```...```
    const parts = escaped.split(/```/);
    let html = "";
    parts.forEach((chunk, i) => {
      if (i % 2 === 1) {
        const code = chunk.replace(/^\n/, "").replace(/\n$/, "");
        html += `<pre><code>${code}</code></pre>`;
      } else {
        // headings, lists, bold, inline code on plain chunks
        const lines = chunk.split("\n");
        let inList = false;
        lines.forEach((line) => {
          const h = line.match(/^(#{1,3})\s+(.*)$/);
          const ol = line.match(/^\s*\d+\.\s+(.*)$/);
          const ul = line.match(/^\s*[-*]\s+(.*)$/);
          if (h) {
            if (inList) { html += "</ol>"; inList = false; }
            const lvl = h[1].length;
            html += `<h${lvl}>${inline(h[2])}</h${lvl}>`;
          } else if (ol) {
            if (!inList) { html += "<ol>"; inList = true; }
            html += `<li>${inline(ol[1])}</li>`;
          } else if (ul) {
            if (!inList) { html += "<ul>"; inList = true; }
            html += `<li>${inline(ul[1])}</li>`;
          } else if (line.trim() === "") {
            if (inList) { html += "</ol>"; inList = false; }
          } else {
            if (inList) { html += "</ol>"; inList = false; }
            html += `<p>${inline(line)}</p>`;
          }
        });
        if (inList) html += "</ol>";
      }
    });
    return html;
  }
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  const chatScroll = $("#chatScroll");
  function appendMsg(role, text) {
    const msg = document.createElement("div");
    msg.className = "msg " + role;
    const head = document.createElement("div");
    head.className = "msg-head";
    head.textContent = (role === "user" ? "YOU" : "J.A.R.V.I.S") + " · " + stamp();
    const body = document.createElement("div");
    body.className = "msg-body";
    body.innerHTML = role === "user" ? `<p>${escapeHtml(text)}</p>` : renderMarkdown(text);
    msg.appendChild(head);
    msg.appendChild(body);
    chatScroll.appendChild(msg);
    chatScroll.scrollTop = chatScroll.scrollHeight;
  }

  // ---- New chat (start a fresh session) ----
  $("#newChatBtn").addEventListener("click", () => {
    // Clear the whole conversation (including the greeting) for a clean session.
    chatScroll.innerHTML = "";
    currentSessionTitle = null;
    activate("CHAT");
    $("#chatInput").focus();
  });

  // ---- Send / simulate response ----
  const input = $("#chatInput");
  const readyStatus = $("#readyStatus");
  let busy = false;

  function simulateReply(userText) {
    busy = true;
    readyStatus.textContent = "JARVIS is thinking...";

    // Only register ONE recent entry per session: the first message sent.
    if (!currentSessionTitle) {
      currentSessionTitle = userText.length > 32 ? userText.slice(0, 32) + "..." : userText;
      recent = [currentSessionTitle, ...recent.filter((t) => t !== currentSessionTitle)].slice(0, 8);
      renderRecent(recent);
    }

    const replies = [
      "Understood, Sir. Here is what I found:\n\n1. The system is **operational**\n2. All cores are responding\n3. Latency nominal\n\nYou can review the `status` block above.",
      "Processing your request.\n\n```\ndef greet(name):\n    return f\"Hello, {name}\"\n```\n\nLet me know if you'd like me to **execute** it.",
      "Affirmative. I've logged that to **memory** and will factor it into future responses.",
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];

    setTimeout(() => {
      busy = false;
      readyStatus.textContent = "Ready";
      appendMsg("assist", reply);
    }, 750 + Math.random() * 700);
  }

  function send() {
    const text = input.value.trim();
    if (!text || busy) return;
    appendMsg("user", text);
    input.value = "";
    simulateReply(text);
  }

  $("#sendBtn").addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });

  // ---- Mode pill click (demo) ----
  $(".mode-pill").addEventListener("click", () => {
    const modes = ["auto", "fast", "smart", "code"];
    const cur = $(".mode-pill").childNodes[0].textContent.trim();
    const next = modes[(modes.indexOf(cur) + 1) % modes.length];
    $(".mode-pill").childNodes[0].textContent = next + " ";
  });

  // init timestamps on the seed message
  $$(".msg-head .ts").forEach((el) => (el.textContent = stamp()));
})();
