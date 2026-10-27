import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url))
);

const sourceDirectory = path.join(projectRoot, "src", "media");
const cacheDirectory = path.join(
  projectRoot,
  ".cache",
  "responsive-cache"
);
const outputDirectory = path.join(
  projectRoot,
  ".cache",
  "responsive-media"
);
const manifestPath = path.join(
  projectRoot,
  ".cache",
  "media-variants.json"
);
const cacheVersionPath = path.join(
  cacheDirectory,
  ".cache-version"
);

/**
 * Responsive widths generated for each source image, in pixels.
 *
 * Only widths strictly smaller than the original are generated. The original
 * image is not included in the generated srcsets.
 */
const targetWidths = [
  48, 96, 160, 240, 320, 480,
  640, 960, 1280, 1600, 1920, 2560
];

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/**
 * Increment when changing encoding settings, image transformations, or
 * cache-key semantics. This prevents reuse of derivatives from older
 * pipeline implementations.
 */
const pipelineVersion = "3";

/**
 * FFmpeg version is included in cache identity because encoder behavior and
 * output can change between builds.
 */
const ffmpegVersion = execFileSync("ffmpeg", ["-version"], {
  encoding: "utf8"
}).split("\n", 1)[0];

const cacheVersion = `${pipelineVersion}\n${ffmpegVersion}`;

/**
 * Expected FFprobe codec names for each output format.
 */
const expectedCodecs = {
  webp: "webp",
  jpg: "mjpeg",
  png: "png"
};

/**
 * Hash strings or buffers with SHA-256.
 */
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Execute a subprocess, preserving its output for useful CI diagnostics.
 */
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status}` +
      (result.signal ? ` (signal: ${result.signal})` : "")
    );
  }
}

/**
 * Write a file through a uniquely named temporary file and atomically rename
 * it into place. The temporary file is created exclusively to prevent
 * accidental reuse of an existing temporary path.
 *
 * The temporary file must reside in the destination directory so the rename
 * does not cross filesystem boundaries.
 *
 * This protects readers from partially written files. It does not, by itself,
 * provide a transaction across the entire image pipeline.
 */
function writeFileAtomically(filePath, contents) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );

  let fileDescriptor;

  try {
    fileDescriptor = openSync(temporaryPath, "wx");
    writeFileSync(fileDescriptor, contents);
    closeSync(fileDescriptor);
    fileDescriptor = undefined;

    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      closeSync(fileDescriptor);
    }

    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

/**
 * Probe an image and return its width, height, and codec.
 *
 * Invalid input or missing video streams cause an error.
 */
function probeImage(imagePath) {
  const output = execFileSync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,codec_name",
    "-of", "json",
    imagePath
  ], {
    encoding: "utf8"
  });

  const result = JSON.parse(output);
  const stream = result.streams?.[0];

  if (
    !stream ||
    !Number.isInteger(stream.width) ||
    stream.width < 1 ||
    !Number.isInteger(stream.height) ||
    stream.height < 1 ||
    typeof stream.codec_name !== "string"
  ) {
    throw new Error(`Could not read image metadata: ${imagePath}`);
  }

  return {
    width: stream.width,
    height: stream.height,
    codec: stream.codec_name
  };
}

/**
 * Return true if a path refers to a nonempty regular file.
 *
 * A single stat call avoids a separate existence check. ENOENT is treated as
 * an ordinary cache miss; other filesystem errors are propagated.
 */
function isNonEmptyFile(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() && stats.size > 0;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

/**
 * Validate a cached or freshly encoded derivative.
 *
 * Checking file size alone cannot detect truncated files or files with the
 * wrong codec or dimensions. FFprobe must successfully parse the file, and
 * its metadata must match the requested output.
 *
 * Invalid derivatives are treated as cache misses and regenerated.
 */
function isValidDerivative(filePath, width, format) {
  if (!isNonEmptyFile(filePath)) {
    return false;
  }

  try {
    const image = probeImage(filePath);

    return (
      image.width === width &&
      image.height > 0 &&
      image.codec === expectedCodecs[format]
    );
  } catch {
    return false;
  }
}

/**
 * Encode one derivative at the requested width.
 *
 * Lanczos resampling is used. WebP uses the
 * configured quality and compression settings; JPEG uses FFmpeg's quality
 * scale, and PNG uses maximum compression.
 *
 * The caller supplies a temporary output path. The result is promoted to the
 * persistent cache only after successful encoding and validation.
 */
function encodeImage(sourcePath, outputPath, width, format) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", sourcePath,
    "-vf", `scale=${width}:-2:flags=lanczos`,
    "-frames:v", "1"
  ];

  if (format === "webp") {
    args.push(
      "-c:v", "libwebp",
      "-quality", "78",
      "-compression_level", "6",
      "-preset", "picture"
    );
  } else if (format === "jpg") {
    args.push("-q:v", "3");
  } else {
    args.push("-compression_level", "9");
  }

  args.push(outputPath);
  run("ffmpeg", args);
}

/**
 * Sort input filenames to make manifest generation deterministic.
 */
const imageFiles = readdirSync(sourceDirectory)
  .filter((filename) =>
    imageExtensions.has(path.extname(filename).toLowerCase())
  )
  .sort();

/**
 * Ensure the cache and output directories exist.
 *
 * Cache identity is derived from the pipeline version, FFmpeg version,
 * source content, target width, and output format. Therefore, a change in
 * any of these inputs naturally produces a different cache key.
 *
 * The version marker is retained for diagnostics but is deliberately not
 * read to decide whether to delete the cache. Deleting the whole cache based
 * on a separate version check is unnecessary and introduces avoidable
 * check-then-use and destructive-operation concerns.
 *
 * Concurrency contract: this script expects a single writer per workspace.
 * Concurrent invocations sharing these directories require a lock or
 * separate per-run directories.
 */
mkdirSync(cacheDirectory, { recursive: true });
mkdirSync(outputDirectory, { recursive: true });

/**
 * Record the current pipeline and encoder versions for debugging.
 */
writeFileAtomically(cacheVersionPath, cacheVersion);

/**
 * The output directory is rebuilt from scratch, while valid cached
 * derivatives are reused across invocations.
 */
rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const manifest = {};
const activeCacheFiles = new Set();

let generatedVariants = 0;
let reusedVariants = 0;
let removedVariants = 0;

for (const filename of imageFiles) {
  const sourcePath = path.join(sourceDirectory, filename);
  const sourceImage = probeImage(sourcePath);
  const sourceWidth = sourceImage.width;

  // Generate only derivatives smaller than the original image.
  const widths = targetWidths.filter((width) => width < sourceWidth);

  if (widths.length === 0) {
    throw new Error(
      `Image is too small for a responsive derivative: ${filename}`
    );
  }

  const extension = path.extname(filename).toLowerCase();

  /**
   * Preserve the original fallback policy:
   * - PNG and WebP sources use PNG fallbacks.
   * - JPEG sources use JPEG fallbacks.
   *
   * WebP is emitted for every source regardless of its original format.
   */
  const fallbackFormat =
    extension === ".png" || extension === ".webp" ? "png" : "jpg";

  // Hash the contents rather than relying on filename or modification time.
  const sourceHash = hash(readFileSync(sourcePath));

  /**
   * Select the first available width at or above each preferred target.
   * If no such width exists, use the largest generated derivative.
   */
  const fallbackWidth =
    widths.find((width) => width >= 960) ?? widths.at(-1);

  const socialWidth =
    widths.find((width) => width >= 1920) ?? widths.at(-1);

  const webpFiles = [];
  const fallbackFiles = [];
  let fallbackSrc;
  let socialSrc;

  for (const width of widths) {
    const variants = {};

    for (const format of ["webp", fallbackFormat]) {
      /**
       * Every input that affects derivative identity participates in the
       * cache key. Identical inputs can reuse the same cached artifact.
       */
      const variantHash = hash(
        `${pipelineVersion}\n${ffmpegVersion}\n` +
        `${sourceHash}\n${width}\n${format}`
      );

      const cacheFilename = `${variantHash}.${format}`;
      const cachePath = path.join(cacheDirectory, cacheFilename);

      const outputFilename = `${variantHash}-${width}.${format}`;
      const outputPath = path.join(outputDirectory, outputFilename);

      const temporaryPath = path.join(
        cacheDirectory,
        `${variantHash}.tmp-${process.pid}.${format}`
      );

      if (isValidDerivative(cachePath, width, format)) {
        reusedVariants += 1;
      } else {
        // Remove invalid cache entries and abandoned temp files for this key.
        rmSync(cachePath, { force: true });
        rmSync(temporaryPath, { force: true });

        try {
          encodeImage(sourcePath, temporaryPath, width, format);

          if (!isValidDerivative(temporaryPath, width, format)) {
            throw new Error(
              `FFmpeg produced an invalid derivative: ${filename} ` +
              `(${width}px, ${format})`
            );
          }

          // Publish only after the encoded file has been validated.
          renameSync(temporaryPath, cachePath);
          generatedVariants += 1;
        } catch (error) {
          rmSync(temporaryPath, { force: true });
          throw error;
        }
      }

      activeCacheFiles.add(cacheFilename);

      copyFileSync(cachePath, outputPath);
      variants[format] = outputFilename;
    }

    const webpFilename = variants.webp;
    const fallbackFilename = variants[fallbackFormat];

    webpFiles.push(
      `/media/${encodeURIComponent(webpFilename)} ${width}w`
    );

    fallbackFiles.push(
      `/media/${encodeURIComponent(fallbackFilename)} ${width}w`
    );

    if (width === fallbackWidth) {
      fallbackSrc = `/media/${encodeURIComponent(fallbackFilename)}`;
    }

    if (width === socialWidth) {
      socialSrc = `/media/${encodeURIComponent(fallbackFilename)}`;
    }
  }

  /**
   * Preserve the manifest schema consumed by the application.
   */
  manifest[filename] = {
    webpSrcset: webpFiles.join(", "),
    fallbackSrcset: fallbackFiles.join(", "),
    fallbackSrc,
    socialSrc
  };
}

/**
 * Remove obsolete derivative cache entries.
 *
 * Restrict cleanup to recognized cache filenames. This avoids deleting the
 * version marker, unrelated files, or temporary files that may be present
 * after an interrupted invocation.
 *
 * Under the documented single-writer contract, no other active invocation
 * should be producing derivatives in this directory.
 */
const cachedDerivativePattern = /^[a-f0-9]{64}\.(?:webp|jpg|png)$/;

for (const filename of readdirSync(cacheDirectory)) {
  if (
    !cachedDerivativePattern.test(filename) ||
    activeCacheFiles.has(filename)
  ) {
    continue;
  }

  rmSync(path.join(cacheDirectory, filename), { force: true });
  removedVariants += 1;
}

/**
 * Publish a complete manifest atomically. Readers see either the previous
 * manifest or the new manifest, rather than partially written JSON.
 */
mkdirSync(path.dirname(manifestPath), { recursive: true });

writeFileAtomically(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`
);

console.log(
  `Responsive images: ${generatedVariants} generated, ` +
  `${reusedVariants} reused, ` +
  `${removedVariants} stale cache files removed.`
);
