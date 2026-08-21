// devlog/archive/news 세 사이트가 공유하는 테마 파일을 각 프로젝트 소스로 복사한다.
// 각 사이트를 독립적으로 빌드 가능한 별도 저장소 취급으로 유지하면서도, 다크모드
// 토글 같은 공통 요소는 이 폴더 하나에서만 고치면 되게 하려는 목적이다.
// 프로젝트별 사본(예: devlog/src/assets/css/theme.css)은 빌드 산출물이므로 직접
// 고치지 말 것 — 다음 빌드에서 여기 내용으로 덮어써진다.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const sharedDir = dirname(fileURLToPath(import.meta.url));

const FILES = [
  ["theme.css", "src/assets/css/theme.css"],
  ["theme-init.js", "src/assets/js/theme-init.js"],
  ["theme-toggle.js", "src/assets/js/theme-toggle.js"],
  ["theme-toggle.njk", "src/_includes/partials/theme-toggle.njk"],
];

export function syncSharedTheme(projectDir) {
  for (const [src, dest] of FILES) {
    const destPath = join(projectDir, dest);
    mkdirSync(dirname(destPath), { recursive: true });
    writeFileSync(destPath, readFileSync(join(sharedDir, src)));
  }
}
