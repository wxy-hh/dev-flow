import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type VerificationProcessResult = {
  exitCode: number;
  output: string;
  exitReason: "success" | "non-zero-exit" | "timeout" | "output-limit" | "spawn-failure";
};

export interface VerificationProcessInput {
  executable: string;
  args: string[];
  cwd?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

/** 执行验证命令的宿主适配器；verification.ts 只消费稳定的退出结果。 */
export async function runVerificationProcess(root: string, input: VerificationProcessInput): Promise<VerificationProcessResult> {
  try {
    const result = await run(input.executable, input.args, {
      cwd: path.resolve(root, input.cwd ?? "."),
      timeout: input.timeoutMs,
      maxBuffer: input.maxOutputBytes,
    });
    return { exitCode: 0, output: `${result.stdout}${result.stderr}`, exitReason: "success" };
  } catch (error) {
    const failure = error as { code?: unknown; killed?: boolean; stdout?: string; stderr?: string; message: string };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? failure.message}`;
    if (failure.killed === true || failure.code === "ETIMEDOUT") {
      return { exitCode: 1, output: `${output}\n[command timed out after ${input.timeoutMs}ms]`, exitReason: "timeout" };
    }
    if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      return { exitCode: 1, output: `${output}\n[command output exceeded ${input.maxOutputBytes} bytes]`, exitReason: "output-limit" };
    }
    if (typeof failure.code === "number") {
      return { exitCode: failure.code, output, exitReason: "non-zero-exit" };
    }
    return { exitCode: 1, output, exitReason: "spawn-failure" };
  }
}

export async function writeVerificationOutput(root: string, featureId: string, outputPath: string, output: string): Promise<void> {
  const file = path.join(root, ".dev-flow", "features", featureId, outputPath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, output);
}
