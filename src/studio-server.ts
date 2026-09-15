import { spawn } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "./exec.ts";
import { customFontKey } from "./fonts.ts";
import { translateTexts } from "./translate.ts";
import { zipDirs } from "./zip.ts";

/**
 * The studio's HTTP surface, shared by `goldie studio` (a static server over
 * the prebuilt studio/dist) and the Vite dev server (studio/vite.config.ts).
 *
 * GET/PUT /api/design - the design choices saved next to the config as
 * goldie.design.json ({ background?, frame?, fontFamily?, copy?, order? }).
 * The CLI's loadConfig() applies the file, so a saved choice also shapes plain
 * `goldie frame` runs. The UI debounces its PUTs; the server writes the file
 * atomically so a half-written JSON never reaches the CLI.
 *
 * POST /api/fonts - uploads a font file for one family and weight (raw body,
 * `X-Font-Family`, `X-Font-Weight` and `X-Font-Filename` headers). The file
 * lands in goldie-fonts/<family>/ next to the config, is listed under
 * `fonts` in goldie.design.json so the CLI registers it, and is copied into
 * out/web so the studio can declare it at once. Responds with the manifest's
 * font entry for the family.
 *
 * POST /api/translate - translates copy with the local Claude Code CLI.
 * Body: { from, to, appName, texts: { "<id>.<field>": text } }; responds with
 * the same keys translated. The UI applies them as edits (undoable, saved
 * with the rest of the design).
 *
 * POST /api/export - renders the final assets from the raw captures with the
 * chosen background and frame (goldie frame + preview + manifest), zips
 * out/screenshots and out/previews, and streams the CLI log as plain text.
 * Body: { background?, frame?, font?, template?, layout?, screenOnly? };
 * per-scene layouts ride on goldie.design.json, which the CLI reads on its
 * own. The response ends with "[done]" on success or "[failed]" otherwise; on
 * "[done]" the UI downloads GET /api/export/download.
 */

export type StudioPaths = {
  configPath: string;
  configDir: string;
  outDir: string;
  webDir: string;
  designFile: string;
  exportZip: string;
};

/** Every path the studio touches derives from the config file's location. */
export function studioPaths(configPath: string): StudioPaths {
  const configDir = dirname(resolve(configPath));
  const outDir = join(configDir, "out");
  return {
    configPath: resolve(configPath),
    configDir,
    outDir,
    webDir: join(outDir, "web"),
    designFile: join(configDir, "goldie.design.json"), // mirrors designPath() in config.ts
    exportZip: join(outDir, "export.zip"),
  };
}

export type ExportOptions = {
  background?: string;
  frame?: string;
  font?: string;
  template?: string;
  layout?: string;
  screenOnly?: boolean;
};

export type StudioApi = {
  paths: StudioPaths;
  /** Command prefix that runs the goldie CLI, e.g. ["node", ".../dist/cli.js"]. */
  cli: string[];
};

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/** Largest font upload accepted; CJK OTFs run around 10-20MB. */
const MAX_FONT_BYTES = 40 * 1024 * 1024;

const FONT_EXTENSIONS = [".ttf", ".otf", ".ttc", ".woff", ".woff2"];

function readBytes(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        done(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done(Buffer.concat(chunks)));
    req.on("error", fail);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => done(body));
  });
}

/** Handles /api/design. */
export function designHandler({ paths }: StudioApi): Handler {
  return (req, res) => {
    if (req.method === "GET") {
      readFile(paths.designFile, "utf8").then(
        (json) => {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(json);
        },
        () => {
          res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end("{}");
        },
      );
      return;
    }
    if (req.method !== "PUT") {
      res.statusCode = 405;
      res.end("GET or PUT only");
      return;
    }
    readBody(req).then(async (body) => {
      let design: Record<string, unknown>;
      try {
        design = JSON.parse(body);
        if (!design || typeof design !== "object") throw new Error();
      } catch {
        res.statusCode = 400;
        res.end("Body must be a JSON object.");
        return;
      }
      try {
        // Uploaded fonts are written by /api/fonts, not by the UI's autosave;
        // a body without them keeps the ones on disk.
        if (!("fonts" in design)) {
          const onDisk = await readDesignFile(paths.designFile);
          if (onDisk.fonts) design.fonts = onDisk.fonts;
        }
        await writeDesignFile(paths.designFile, design);
        res.statusCode = 204;
        res.end();
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
  };
}

async function readDesignFile(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Written atomically so a half-written JSON never reaches the CLI. */
async function writeDesignFile(file: string, design: Record<string, unknown>): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(design, null, 2)}\n`);
  await rename(tmp, file);
}

type SavedFont = { family: string; files: Record<string, string>; fallback?: string };

/** Handles POST /api/fonts. */
export function fontsHandler({ paths }: StudioApi): Handler {
  return (req, res) => {
    const fail = (status: number, message: string) => {
      res.statusCode = status;
      res.end(message);
    };
    if (req.method !== "POST") return fail(405, "POST only");
    const header = (name: string) => {
      const v = req.headers[name];
      return decodeURIComponent((Array.isArray(v) ? v[0] : v) ?? "").trim();
    };
    const family = header("x-font-family").replace(/["\\]/g, "");
    const weight = Number(header("x-font-weight") || 400);
    const filename = basename(header("x-font-filename")).replace(/[^\w.-]+/g, "_");
    const ext = extname(filename).toLowerCase();
    if (!family) return fail(400, "X-Font-Family is required.");
    if (!Number.isInteger(weight) || weight < 100 || weight > 900)
      return fail(400, "X-Font-Weight must be 100-900.");
    if (!FONT_EXTENSIONS.includes(ext))
      return fail(400, `Unsupported font file "${filename}". Use ${FONT_EXTENSIONS.join(", ")}.`);

    readBytes(req, MAX_FONT_BYTES).then(async (bytes) => {
      if (!bytes) return fail(413, "Font file too large.");
      if (bytes.length === 0) return fail(400, "Empty font file.");
      try {
        const key = customFontKey(family);
        const rel = `goldie-fonts/${key}/${filename}`;
        const file = join(paths.configDir, rel);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
        const webFile = join(paths.webDir, "fonts", "custom", key, filename);
        await mkdir(dirname(webFile), { recursive: true });
        await copyFile(file, webFile);

        const design = await readDesignFile(paths.designFile);
        const fonts = (Array.isArray(design.fonts) ? design.fonts : []) as SavedFont[];
        let entry = fonts.find((f) => f.family === family);
        if (!entry) {
          entry = { family, files: {}, fallback: "sans-serif" };
          fonts.push(entry);
        }
        entry.files[String(weight)] = rel;
        design.fonts = fonts;
        await writeDesignFile(paths.designFile, design);

        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(
          JSON.stringify({
            key,
            family,
            fallback: entry.fallback ?? "sans-serif",
            custom: true,
            faces: Object.entries(entry.files).map(([w, f]) => ({
              weight: Number(w),
              url: `fonts/custom/${key}/${encodeURIComponent(basename(f))}`,
            })),
          }),
        );
      } catch (err) {
        fail(500, err instanceof Error ? err.message : String(err));
      }
    });
  };
}

/** Handles POST /api/translate. */
export function translateHandler(): Handler {
  return (req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    readBody(req).then(async (body) => {
      try {
        const { from, to, appName, texts } = JSON.parse(body || "{}");
        if (
          typeof from !== "string" ||
          typeof to !== "string" ||
          !texts ||
          typeof texts !== "object"
        )
          throw new Error("Body needs from, to and texts.");
        const out = await translateTexts(texts, from, to, { appName: String(appName ?? "") });
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.statusCode = 500;
        res.end(err instanceof Error ? err.message : String(err));
      }
    });
  };
}

/** Handles /api/export and /api/export/download. `sub` is the path after /api/export. */
export function exportHandler({ paths, cli }: StudioApi): (sub: string) => Handler {
  let busy = false;

  return (sub) => (req, res) => {
    if (req.method === "GET" && sub === "/download") {
      if (!existsSync(paths.exportZip)) {
        res.statusCode = 404;
        res.end("No export yet. POST /api/export first.");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Length": statSync(paths.exportZip).size,
        "Content-Disposition": 'attachment; filename="appstore-assets.zip"',
        "Cache-Control": "no-store",
      });
      createReadStream(paths.exportZip).pipe(res);
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.end("POST only");
      return;
    }
    if (busy) {
      res.statusCode = 409;
      res.end("An export is already running.");
      return;
    }
    busy = true;

    readBody(req).then(async (body) => {
      let opts: ExportOptions;
      try {
        opts = JSON.parse(body || "{}");
      } catch {
        busy = false;
        res.statusCode = 400;
        res.end("Body must be JSON.");
        return;
      }

      const flags: string[] = [];
      if (opts.background) flags.push("--background", opts.background);
      if (opts.frame) flags.push("--frame", opts.frame);
      if (opts.font) flags.push("--font", opts.font);
      if (opts.template) flags.push("--template", opts.template);
      if (opts.layout) flags.push("--layout", opts.layout);
      if (opts.screenOnly) flags.push("--screen-only");

      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });

      const [bin, ...prefix] = cli;
      try {
        for (const command of ["frame", "preview", "manifest"]) {
          res.write(`$ goldie ${command}\n`);
          await stream(bin!, [...prefix, command, ...flags], paths.configDir, res, {
            GOLDIE_CONFIG: paths.configPath,
          });
        }
        res.write("$ zip screenshots + previews\n");
        await rm(paths.exportZip, { force: true });
        const count = await zipDirs(
          paths.outDir,
          ["screenshots", "previews", "feature-graphic"],
          paths.exportZip,
        );
        res.write(`  ${count} files\n`);
        res.write("[done]\n");
      } catch (err) {
        res.write(`[failed] ${err instanceof Error ? err.message : err}\n`);
      } finally {
        busy = false;
        res.end();
      }
    });
  };
}

function stream(
  cmd: string,
  args: string[],
  cwd: string,
  res: ServerResponse,
  env: Record<string, string> = {},
): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    child.stdout.on("data", (d) => res.write(d));
    child.stderr.on("data", (d) => res.write(d));
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done() : fail(new Error(`exit code ${code}`))));
  });
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** Serve `file` with Range support, so the preview video seeks in the browser. */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, {
      "Content-Type": type,
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}

/** Resolve a URL path inside `root`, or null when it escapes or is missing. */
function fileIn(root: string, urlPath: string): string | null {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, rel);
  if (!file.startsWith(root)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

/** The studio bundle Vite emits; shipped in the npm package. */
export const STUDIO_DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "studio", "dist");

/**
 * Serve the prebuilt studio plus the app's out/web at `/`, with the API on top.
 * Resolves with the URL once listening.
 */
export function serveStudio(api: StudioApi, port = 4321): Promise<string> {
  if (!existsSync(join(STUDIO_DIST, "index.html"))) {
    throw new Error(
      `No studio build at ${STUDIO_DIST}. In a source checkout run: bun run studio:build`,
    );
  }
  const design = designHandler(api);
  const exp = exportHandler(api);
  const fonts = fontsHandler(api);
  const translate = translateHandler();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    if (path === "/api/design") return design(req, res);
    if (path === "/api/fonts") return fonts(req, res);
    if (path === "/api/translate") return translate(req, res);
    if (path.startsWith("/api/export")) return exp(path.slice("/api/export".length))(req, res);

    const file = fileIn(api.paths.webDir, path) ?? fileIn(STUDIO_DIST, path);
    if (file) return sendFile(req, res, file);
    if (path === "/store.json") {
      res.statusCode = 404;
      res.end("No out/web/store.json. Run: goldie manifest");
      return;
    }
    sendFile(req, res, join(STUDIO_DIST, "index.html"));
  });

  return new Promise((done, fail) => {
    server.on("error", fail);
    server.listen(port, "127.0.0.1", () => done(`http://localhost:${port}`));
  });
}

/** Open a URL in the default browser; best effort. */
export async function openInBrowser(url: string): Promise<void> {
  // `start` is a cmd.exe builtin, not a program; the empty string is its window title.
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];
  await exec(cmd, args, { quiet: true });
}
