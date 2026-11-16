import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, "dist");
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });

for (const name of readdirSync(root)) {
  if (name.endsWith(".html")) {
    cpSync(join(root, name), join(output, name));
  }
}

const cssDirectory = join(root, "css");
if (existsSync(cssDirectory)) {
  cpSync(cssDirectory, join(output, "css"), { recursive: true });
}

const scriptsOutput = join(output, "scripts");
mkdirSync(scriptsOutput, { recursive: true });
for (const name of ["app.js", "auth.js", "image-crop.js", "mobile-preview.js", "settings.js"]) {
  cpSync(join(root, "scripts", name), join(scriptsOutput, name));
}
