// Writing desk behaviour: preview tab, unsaved-change guard, Ctrl+S and a
// per-browser backup of the text in case the tab closes before saving.
(() => {
  const form = document.getElementById("editor");
  if (!form) return;
  const body = document.getElementById("editor-body");
  const preview = document.getElementById("editor-preview");
  const count = document.getElementById("editor-count");
  const tabs = [...form.querySelectorAll(".editor-tab")];
  const backupKey = `devlog-editor:${form.dataset.slug}`;
  const snapshot = () => JSON.stringify([...new FormData(form)].filter(([key]) => key !== "action"));
  const saved = snapshot();
  let submitting = false;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(backupKey) || "null"); } catch { return null; } },
    set(value) { try { localStorage.setItem(backupKey, JSON.stringify(value)); } catch { /* storage unavailable */ } },
    clear() { try { localStorage.removeItem(backupKey); } catch { /* storage unavailable */ } },
  };

  // A fresh page load after a successful save means the server has the text.
  if (/[?&]saved=/.test(location.search)) store.clear();
  const backup = store.get();
  if (backup && backup.body !== body.value && backup.body?.trim()) {
    const note = document.createElement("p");
    note.className = "admin-flash";
    note.setAttribute("role", "status");
    note.innerHTML = '저장하지 않은 글이 이 브라우저에 남아 있습니다. <button type="button" class="admin-link">불러오기</button> <button type="button" class="admin-link">버리기</button>';
    const [restore, discard] = note.querySelectorAll("button");
    restore.addEventListener("click", () => {
      for (const name of ["title", "summary", "body"]) if (typeof backup[name] === "string") form.elements[name].value = backup[name];
      note.remove(); update();
    });
    discard.addEventListener("click", () => { store.clear(); note.remove(); });
    form.querySelector(".editor-field").before(note);
  }

  const update = () => {
    const chars = body.value.replace(/\s/g, "").length;
    count.textContent = `${body.value.length.toLocaleString("ko-KR")}자 · 약 ${Math.max(1, Math.ceil(body.value.length / 500))}분 읽기${chars ? "" : " · 아직 비어 있음"}`;
    if (snapshot() !== saved) store.set({ title: form.elements.title.value, summary: form.elements.summary.value, body: body.value, at: Date.now() });
  };
  form.addEventListener("input", update);
  update();

  // Grow the textarea with the text so the page scrolls, not the box.
  const grow = () => { body.style.height = "auto"; body.style.height = `${Math.max(body.scrollHeight + 4, 480)}px`; };
  body.addEventListener("input", grow);
  grow();

  const show = async (tab) => {
    for (const item of tabs) {
      const active = item.dataset.tab === tab;
      item.classList.toggle("is-on", active);
      item.setAttribute("aria-selected", String(active));
    }
    const previewing = tab === "preview";
    body.hidden = previewing;
    preview.hidden = !previewing;
    if (!previewing) return body.focus();
    preview.innerHTML = '<p class="admin-muted">미리보기를 만드는 중…</p>';
    try {
      const data = new FormData();
      data.set("body", body.value);
      const response = await fetch("/devlog/admin/preview", { method: "POST", body: data, credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      // The server escapes all text; the fragment only contains its own markup.
      preview.innerHTML = (await response.text()) || '<p class="admin-muted">아직 쓴 내용이 없습니다.</p>';
    } catch {
      preview.innerHTML = '<p class="admin-flash admin-flash-error">미리보기를 불러오지 못했습니다. 로그인이 끊겼다면 다시 로그인하세요.</p>';
    }
  };
  for (const tab of tabs) tab.addEventListener("click", () => show(tab.dataset.tab));

  // Adds a "## <repo>" heading for every repo of the day that the body does not have yet.
  const addHeadings = document.getElementById("add-repo-headings");
  addHeadings?.addEventListener("click", () => {
    let names = [];
    try { names = JSON.parse(addHeadings.dataset.repos || "[]"); } catch { /* keep empty */ }
    const present = new Set([...body.value.matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1].toLowerCase()));
    const missing = names.filter((name) => !present.has(String(name).toLowerCase()));
    if (!missing.length) { addHeadings.textContent = "모든 저장소 소제목이 있습니다"; return; }
    const text = body.value.trimEnd();
    body.value = `${text}${text ? "\n\n" : ""}${missing.map((name) => `## ${name}\n\n`).join("\n").trimEnd()}\n\n`;
    update();
    grow();
    body.focus();
  });

  // Rewrites title, summary and body from the day's commits. Nothing is saved until the author saves.
  const rewrite = document.getElementById("ai-rewrite");
  rewrite?.addEventListener("click", async () => {
    if (body.value.replace(/^##\s+.*$/gm, "").trim() && !window.confirm("지금 쓴 제목·요약·본문을 AI가 쓴 글로 바꿀까요? 저장하기 전까지는 되돌릴 수 있습니다(새로고침).")) return;
    const label = rewrite.textContent;
    rewrite.disabled = true;
    rewrite.textContent = "AI가 쓰는 중… (1분 안팎)";
    try {
      const response = await fetch(rewrite.dataset.url, { method: "POST", credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "AI가 본문을 쓰지 못했습니다.");
      form.elements.title.value = result.title;
      form.elements.summary.value = result.summary;
      body.value = result.body;
      update();
      grow();
    } catch (error) {
      window.alert(error.message);
    } finally {
      rewrite.disabled = false;
      rewrite.textContent = label;
    }
  });

  // Spelling review: the server suggests, the author applies one change at a time.
  const spell = {
    run: document.getElementById("spell-run"),
    panel: document.getElementById("spell-panel"),
    title: document.getElementById("spell-title"),
    list: document.getElementById("spell-list"),
    applyAll: document.getElementById("spell-apply-all"),
    close: document.getElementById("spell-close"),
  };
  const FIELD_LABEL = { title: "제목", summary: "요약", body: "본문" };
  const pending = () => [...spell.list.querySelectorAll("li[data-state='open']")];
  const refreshSpell = () => {
    const left = pending().length;
    spell.applyAll.hidden = left < 2;
    spell.title.textContent = left ? `맞춤법 검토 · 남은 제안 ${left}건` : "맞춤법 검토 · 모두 확인했습니다";
  };
  const settle = (item, state, note) => {
    item.dataset.state = state;
    item.querySelector(".spell-actions").replaceChildren(Object.assign(document.createElement("span"), { className: "spell-note", textContent: note }));
  };
  const applyIssue = (item, issue) => {
    const field = form.elements[issue.field];
    const at = field.value.indexOf(issue.original);
    if (at < 0) return settle(item, "stale", "원문이 바뀌어 적용하지 못했습니다");
    field.value = field.value.slice(0, at) + issue.suggestion + field.value.slice(at + issue.original.length);
    settle(item, "applied", "적용함");
    update();
    if (field === body) grow();
  };
  const renderIssues = (issues) => {
    spell.list.replaceChildren();
    for (const issue of issues) {
      const item = document.createElement("li");
      item.dataset.state = "open";
      const head = document.createElement("p");
      head.className = "spell-change";
      head.append(
        Object.assign(document.createElement("span"), { className: "admin-tag", textContent: FIELD_LABEL[issue.field] || issue.field }),
        Object.assign(document.createElement("del"), { textContent: issue.original }),
        document.createTextNode(" → "),
        Object.assign(document.createElement("ins"), { textContent: issue.suggestion }),
      );
      const reason = Object.assign(document.createElement("p"), { className: "admin-muted", textContent: issue.reason });
      const actions = document.createElement("p");
      actions.className = "spell-actions";
      const apply = Object.assign(document.createElement("button"), { type: "button", className: "admin-button", textContent: "적용" });
      const skip = Object.assign(document.createElement("button"), { type: "button", className: "admin-button admin-button-quiet", textContent: "무시" });
      apply.addEventListener("click", () => { applyIssue(item, issue); refreshSpell(); });
      skip.addEventListener("click", () => { settle(item, "skipped", "무시함"); refreshSpell(); });
      actions.append(apply, skip);
      item.append(head, reason, actions);
      item.issue = issue;
      spell.list.append(item);
    }
    refreshSpell();
  };
  spell.run?.addEventListener("click", async () => {
    spell.panel.hidden = false;
    spell.run.disabled = true;
    spell.applyAll.hidden = true;
    spell.title.textContent = "맞춤법 검토 · 검사하는 중…";
    spell.list.replaceChildren();
    try {
      const data = new FormData();
      for (const name of ["title", "summary", "body"]) data.set(name, form.elements[name].value);
      const response = await fetch("/devlog/admin/spellcheck", { method: "POST", body: data, credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "맞춤법 검사를 하지 못했습니다. 로그인이 끊겼다면 다시 로그인하세요.");
      if (!result.issues.length) spell.title.textContent = "맞춤법 검토 · 고칠 곳을 찾지 못했습니다";
      else renderIssues(result.issues);
    } catch (error) {
      spell.title.textContent = "맞춤법 검토";
      spell.list.replaceChildren(Object.assign(document.createElement("li"), { className: "admin-flash admin-flash-error", textContent: error.message }));
    } finally {
      spell.run.disabled = false;
    }
  });
  spell.applyAll?.addEventListener("click", () => {
    for (const item of pending()) applyIssue(item, item.issue);
    refreshSpell();
  });
  spell.close?.addEventListener("click", () => { spell.panel.hidden = true; });

  form.addEventListener("submit", (event) => {
    const confirmText = event.submitter?.dataset.confirm;
    if (confirmText && !window.confirm(confirmText)) { event.preventDefault(); return; }
    submitting = true;
  });
  window.addEventListener("beforeunload", (event) => {
    if (!submitting && snapshot() !== saved) { event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      form.querySelector('button[name="action"][value="save"]')?.click();
    }
  });
})();
