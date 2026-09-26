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
