import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve("dist/cli");
await rm(target, { recursive: true, force: true });
await mkdir(resolve(target, "plugins/lucene-9"), { recursive: true });
await cp(resolve("cli/cli-core/target/lucene-lens-cli.jar"), resolve(target, "lucene-lens-cli.jar"));
await cp(
  resolve("cli/cli-plugin-lucene-9/target/lucene-plugin.jar"),
  resolve(target, "plugins/lucene-9/lucene-plugin.jar")
);
