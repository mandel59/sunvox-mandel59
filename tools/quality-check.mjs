#!/usr/bin/env node
import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const isWindows = process.platform === "win32";

const CHECKS = [
  ["License notices", npmCommand, ["run", "licenses:check"]],
  ["Regenerate SunVox fixtures", npmCommand, ["run", "sunvox:fixtures:generate"]],
  ["SunVox lib compatibility", npmCommand, ["run", "sunvox:lib:check"]],
  ["Node tests", npmCommand, ["test"]],
  ["SunVox metrics", npmCommand, ["run", "sunvox:metrics"]],
  ["Code metrics", npmCommand, ["run", "code:metrics"]],
  ["SunVox DB structure", npmCommand, ["run", "sunvox:inspect", "--", "check"]],
  ["SunVox coverage gate", npmCommand, ["run", "sunvox:coverage:check"]],
  ["SunVox controller metadata", npmCommand, ["run", "sunvox:controller-diff"]],
  ["SunVox validation gate", npmCommand, ["run", "sunvox:validate:all"]],
  ["SunVox round-trip samples", npmCommand, ["run", "sunvox:verify:all"]],
  ["Frontend build", npmCommand, ["run", "build"]],
  ["Built license notices", npmCommand, ["run", "licenses:check:dist"]],
  ["Whitespace check", "git", ["diff", "--check"]],
];

function runCheck([label, command, args]) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`);
    const startedAt = performance.now();
    const child = spawn(...spawnArgs(command, args), {
      env: process.env,
      shell: false,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`==> ${label} passed in ${elapsedSeconds}s`);
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

function quoteWindowsArg(arg) {
  return /^[A-Za-z0-9_:/=.\-]+$/u.test(arg) ? arg : `"${arg.replace(/"/gu, '\\"')}"`;
}

function spawnArgs(command, args) {
  if (!isWindows) {
    return [command, args];
  }
  const shellCommand = [command, ...args].map(quoteWindowsArg).join(" ");
  return [process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", shellCommand]];
}

async function main() {
  for (const check of CHECKS) {
    await runCheck(check);
  }
  console.log(`\nQuality check passed (${CHECKS.length} checks).`);
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
