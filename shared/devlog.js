const query = document.getElementById("journal-query");
const toc = document.querySelector("[data-article-toc]");
if (toc) {
  const headings = [...document.querySelectorAll(".journal-prose h2, .journal-prose h3")];
  for (const [index, heading] of headings.entries()) {
    heading.id ||= `section-${index + 1}`;
    const li = document.createElement("li");
    li.className = `toc-level-${heading.tagName.slice(1)}`;
    const link = document.createElement("a");
    link.href = `#${heading.id}`;
    link.textContent = heading.textContent;
    li.append(link);
    toc.querySelector("ol").append(li);
  }
  toc.hidden = !headings.length;
}
if (query) {
  const entries = [...document.querySelectorAll("[data-journal-entry]")];
  const count = document.getElementById("journal-count");
  const empty = document.getElementById("journal-empty");
  const apply = () => {
    const term = query.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const entry of entries) {
      const text = `${entry.querySelector("h3")?.textContent || ""} ${entry.querySelector("p")?.textContent || ""}`;
      entry.hidden = !text.toLocaleLowerCase().includes(term);
      if (!entry.hidden) visible++;
    }
    count.textContent = `${visible}편의 기록`;
    empty.hidden = visible > 0;
  };
  query.addEventListener("input", apply);
  apply();
}
