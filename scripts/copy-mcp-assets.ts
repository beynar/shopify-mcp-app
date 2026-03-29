import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOT = path.resolve(process.cwd(), "shopify-mcp/assets");
const TARGET_ROOT = path.resolve(process.cwd(), "build/client");
const PUBLIC_ROOT = path.resolve(process.cwd(), "public");

async function copyDirectory(sourceDir: string, targetDir: string) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
          await copyDirectory(sourcePath, targetPath);
          return;
        }

        if (entry.isFile()) {
          await fs.copyFile(sourcePath, targetPath);
        }
      }),
  );
}

async function main() {
  await copyDirectory(SOURCE_ROOT, TARGET_ROOT);
  await fs.copyFile(path.join(PUBLIC_ROOT, "favicon.svg"), path.join(TARGET_ROOT, "favicon.svg"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
