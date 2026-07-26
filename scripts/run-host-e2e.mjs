import { spawn } from "node:child_process";

const child = spawn(
  process.execPath,
  ["--test", "tests/e2e/native-cross-host.test.mjs", "tests/e2e/native-install-upgrade.test.mjs"],
  {
    env: { ...process.env, HOST_E2E: "1" },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
