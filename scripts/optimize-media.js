import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDirectory = path.join(projectRoot, "src", "media");
const siteDirectory = path.join(projectRoot, "_site");
const cacheDirectory = path.join(projectRoot, ".cache", "responsive-cache");
const outputDirectory = path.join(projectRoot, ".cache", "responsive-media");
const manifestPath = path.join(projectRoot, ".cache", "media-variants.json");
const targetWidths = [48, 96, 160, 240, 320, 480, 640, 960, 1280, 1600, 1920, 2560];
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const pipelineVersion = "2";
const ffmpegVersion = execFileSync("ffmpeg", ["-version"], { encoding: "utf8" }).split("\n", 1)[0];
const cacheVersionPath = path.join(cacheDirectory, ".cache-version");

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function probeWidth(sourcePath) {
  const output = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width",
    "-of", "default=noprint_wrappers=1:nokey=1",
    sourcePath
  ], { encoding: "utf8" });
  const width = Number(output.trim());

  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`Could not read image width: ${sourcePath}`);
  }

  return width;
}

function encodeImage(sourcePath, outputPath, width, format) {
  const args = [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", sourcePath,
    "-vf", `scale=${width}:-2:flags=lanczos`,
    "-frames:v", "1"
  ];

  if (format === "webp") {
    args.push("-c:v", "libwebp", "-quality", "78", "-compression_level", "6", "-preset", "picture");
  } else if (format === "jpg") {
    args.push("-q:v", "3");
  } else {
    args.push("-compression_level", "9");
  }

  args.push(outputPath);
  run("ffmpeg", args);
}

const imageFiles = readdirSync(sourceDirectory)
  .filter((filename) => imageExtensions.has(path.extname(filename).toLowerCase()));

rmSync(outputDirectory, { recursive: true, force: true });

const cacheVersion = `${pipelineVersion}\n${ffmpegVersion}`;

if (existsSync(cacheVersionPath) && readFileSync(cacheVersionPath, "utf8") !== cacheVersion) {
  rmSync(cacheDirectory, { recursive: true, force: true });
}

mkdirSync(cacheDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(cacheVersionPath, cacheVersion);

const manifest = {};
const activeCacheFiles = new Set();
let generatedVariants = 0;
let reusedVariants = 0;

for (const filename of imageFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const sourceWidth = probeWidth(sourcePath);
  const widths = targetWidths.filter((width) => width < sourceWidth);

  if (widths.length === 0) {
    throw new Error(`Image is too small for a responsive derivative: ${filename}`);
  }

  const extension = path.extname(filename).toLowerCase();
  const fallbackFormat = extension === ".png" || extension === ".webp" ? "png" : "jpg";
  const sourceHash = hash(readFileSync(sourcePath));
  const fallbackWidth = widths.find((width) => width >= 960) ?? widths.at(-1);
  const socialWidth = widths.find((width) => width >= 1920) ?? widths.at(-1);
  const webpFiles = [];
  const fallbackFiles = [];
  let fallbackSrc;
  let socialSrc;

  for (const width of widths) {
    const variantNames = [];

    for (const format of ["webp", fallbackFormat]) {
      const variantHash = hash(`${pipelineVersion}\n${ffmpegVersion}\n${sourceHash}\n${width}\n${format}`);
      const cacheFilename = `${variantHash}.${format}`;
      const cachePath = path.join(cacheDirectory, cacheFilename);
      const outputFilename = `${variantHash}-${width}.${format}`;
      const outputPath = path.join(outputDirectory, outputFilename);
      const temporaryPath = path.join(cacheDirectory, `${variantHash}.tmp-${process.pid}.${format}`);

      if (existsSync(cachePath) && statSync(cachePath).size > 0) {
        reusedVariants += 1;
      } else {
        rmSync(cachePath, { force: true });
        encodeImage(sourcePath, temporaryPath, width, format);
        renameSync(temporaryPath, cachePath);
        generatedVariants += 1;
      }

      activeCacheFiles.add(cacheFilename);
      copyFileSync(cachePath, outputPath);
      variantNames.push({ filename: outputFilename, format });
    }

    const webpVariant = variantNames.find((variant) => variant.format === "webp");
    const fallbackVariant = variantNames.find((variant) => variant.format === fallbackFormat);
    const webpFilename = webpVariant.filename;
    const fallbackFilename = fallbackVariant.filename;
    webpFiles.push(`/media/${encodeURIComponent(webpFilename)} ${width}w`);
    fallbackFiles.push(`/media/${encodeURIComponent(fallbackFilename)} ${width}w`);

    if (width === fallbackWidth) {
      fallbackSrc = `/media/${encodeURIComponent(fallbackFilename)}`;
    }

    if (width === socialWidth) {
      socialSrc = `/media/${encodeURIComponent(fallbackFilename)}`;
    }
  }

  manifest[filename] = {
    webpSrcset: webpFiles.join(", "),
    fallbackSrcset: fallbackFiles.join(", "),
    fallbackSrc,
    socialSrc
  };
}

let removedVariants = 0;

for (const filename of readdirSync(cacheDirectory)) {
  if (filename.startsWith(".") || activeCacheFiles.has(filename)) {
    continue;
  }

  rmSync(path.join(cacheDirectory, filename), { force: true });
  removedVariants += 1;
}

mkdirSync(path.dirname(manifestPath), { recursive: true });
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Responsive images: ${generatedVariants} generated, ${reusedVariants} reused, ${removedVariants} stale cache files removed.`);
