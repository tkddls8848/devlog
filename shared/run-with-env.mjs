// Run a Node CLI with the single repository-root environment file.
import "./load-env.mjs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
if (!args.length) throw Error("Node CLI path is required");
const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
child.on("error", () => { console.error("CLI 실행 실패"); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
