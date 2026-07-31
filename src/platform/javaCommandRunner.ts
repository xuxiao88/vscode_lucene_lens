import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {access} from "node:fs/promises";
import {join} from "node:path";
import * as vscode from "vscode";
import {parseCliResponse} from "../protocol/validation";
import type {CliResponse} from "../protocol/types";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false
  ) {
    super(message);
  }
}

export class JavaCommandRunner implements vscode.Disposable {
  private cachedJava: Promise<string> | undefined;
  private active = new Set<ReturnType<typeof spawn>>();

  constructor(
    private readonly extensionPath: string,
    private readonly output: vscode.OutputChannel
  ) {}

  dispose(): void {
    for (const child of this.active) child.kill();
    this.active.clear();
  }

  resetJava(): void {
    this.cachedJava = undefined;
  }

  async run<T>(
    command: string,
    args: readonly string[],
    token?: vscode.CancellationToken,
    timeoutOverride?: number
  ): Promise<T> {
    const java = await (this.cachedJava ??= this.resolveJava());
    const config = vscode.workspace.getConfiguration("luceneLens");
    const heap = config.get<string>("cli.maxHeap", "512m");
    const timeout = timeoutOverride ?? config.get<number>("requestTimeout", 30000);
    const cliJar = join(this.extensionPath, "dist", "cli", "lucene-lens-cli.jar");
    const pluginJar = join(
      this.extensionPath,
      "dist",
      "cli",
      "plugins",
      "lucene-9",
      "lucene-plugin.jar"
    );
    const requestId = randomUUID();
    const started = Date.now();
    this.output.appendLine(`[${requestId}] ${command} started`);
    const response = await this.spawnJson(
      java,
      [`-Xmx${heap}`, "-jar", cliJar, "--plugin", pluginJar, command, ...args, "--output", "json"],
      timeout,
      token
    );
    const parsed = parseCliResponse<T>(response.stdout.trim());
    if (response.stderr.trim()) {
      this.output.appendLine(`[${requestId}] stderr: ${response.stderr.trim()}`);
    }
    this.output.appendLine(
      `[${requestId}] ${command} finished in ${Date.now() - started}ms with exit ${response.exitCode}`
    );
    if ("error" in parsed) {
      this.output.appendLine(`[${requestId}] ${parsed.error.code}`);
      throw new CliError(parsed.error.code, parsed.error.message, parsed.error.retryable);
    }
    if (response.exitCode !== 0) {
      throw new CliError("PROCESS_EXIT_ERROR", `CLI exited with code ${response.exitCode}.`);
    }
    return parsed.result;
  }

  private async resolveJava(): Promise<string> {
    const configuredHome = vscode.workspace.getConfiguration("luceneLens").get<string>("java.home", "").trim();
    const java = configuredHome
      ? join(configuredHome, "bin", process.platform === "win32" ? "java.exe" : "java")
      : "java";
    if (configuredHome) {
      try {
        await access(java, constants.X_OK);
      } catch {
        throw new CliError("JAVA_HOME_INVALID", "Lucene Lens: Java Home does not contain an executable java.");
      }
    }
    let versionOutput: string;
    try {
      const result = await this.spawnJson(java, ["-version"], 10000);
      versionOutput = `${result.stderr}\n${result.stdout}`;
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("JAVA_NOT_FOUND", "Lucene Lens: Java was not found. Configure luceneLens.java.home.");
    }
    const match = versionOutput.match(/version\s+"(?:(\d+)\.)?(\d+)/i);
    const major = match ? Number(match[1] ?? match[2]) : NaN;
    if (!Number.isFinite(major) || major < 11) {
      throw new CliError(
        "JAVA_VERSION_UNSUPPORTED",
        "Lucene Lens requires Java 11 or newer. Configure luceneLens.java.home."
      );
    }
    this.output.appendLine(`Using Java ${major}: ${java}`);
    return java;
  }

  private spawnJson(
    executable: string,
    args: readonly string[],
    timeout: number,
    token?: vscode.CancellationToken
  ): Promise<{stdout: string; stderr: string; exitCode: number}> {
    return new Promise((resolve, reject) => {
      const child = spawn(executable, [...args], {shell: false, windowsHide: true});
      this.active.add(child);
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let cancellation: vscode.Disposable | undefined;

      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancellation?.dispose();
        this.active.delete(child);
        action();
      };
      const terminate = (error: CliError): void => {
        child.kill();
        finish(() => reject(error));
      };
      const timer = setTimeout(
        () => terminate(new CliError("REQUEST_TIMEOUT", "The Lucene CLI request timed out.")),
        timeout
      );
      cancellation = token?.onCancellationRequested(() =>
        terminate(new CliError("REQUEST_CANCELLED", "The Lucene CLI request was cancelled."))
      );

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          terminate(new CliError("PROCESS_OUTPUT_LIMIT", "CLI output exceeded the size limit."));
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes <= MAX_STDERR_BYTES) stderr.push(chunk);
      });
      child.on("error", (error) =>
        finish(() => reject(new CliError("JAVA_NOT_FOUND", `Unable to start Java: ${error.message}`)))
      );
      child.on("close", (code) =>
        finish(() =>
          resolve({
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            exitCode: code ?? 10
          })
        )
      );
    });
  }
}
