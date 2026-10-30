#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createReadStream, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { DEFAULT_STACK, findTool, getStudent, run, s3, stackOutputs, usageError, videosPrefix } from './lib.mjs';

const usage = `Usage: node scripts/upload-videos.mjs --username <username> <file-or-folder> [...] [--overwrite] [--stack <name>]
  Uploads videos to the student's private folder. Folders are expanded to the video files they contain.
  With ffmpeg installed, videos larger than 480p are re-encoded to 480p H.264 with +faststart first;
  videos that are already 480p or smaller are uploaded unchanged. Existing files are skipped unless --overwrite.
  The recording date stored in the video (if any) is kept so the page can group videos by month.`;

const CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
};

const TARGET_HEIGHT = 480;

function expandInputs(inputs) {
  return inputs.flatMap((p) =>
    statSync(p).isDirectory()
      ? readdirSync(p)
          .filter((f) => CONTENT_TYPES[extname(f).toLowerCase()])
          .sort()
          .map((f) => join(p, f))
      : [p],
  );
}

/** Shorter side of the first video stream (480 for both 854x480 and 480x854). */
function shortSide(ffprobe, file) {
  const res = spawnSync(
    ffprobe,
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file],
    { encoding: 'utf8' },
  );
  const [w, h] = res.stdout.trim().split('x').map(Number);
  return w && h ? Math.min(w, h) : null;
}

/** Recording date from the video's own metadata (phones and cameras store it), or null. */
function recordingDate(ffprobe, file) {
  const res = spawnSync(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format_tags=creation_time,com.apple.quicktime.creationdate', '-of', 'json', file],
    { encoding: 'utf8' },
  );
  let tags = {};
  try {
    tags = JSON.parse(res.stdout).format?.tags ?? {};
  } catch {}
  for (const value of [tags['com.apple.quicktime.creationdate'], tags.creation_time]) {
    const date = new Date(value ?? '');
    // Some cameras write placeholder dates such as 1970-01-01 or 1904-01-01.
    if (!Number.isNaN(date.getTime()) && date.getFullYear() >= 2000) return date.toISOString();
  }
  return null;
}

function transcode(ffmpeg, input, output) {
  const scale = `scale=w='if(gt(iw,ih),-2,${TARGET_HEIGHT})':h='if(gt(iw,ih),${TARGET_HEIGHT},-2)'`;
  const res = spawnSync(
    ffmpeg,
    ['-y', '-hide_banner', '-loglevel', 'error', '-stats', '-i', input,
      '-vf', scale, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', output],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (res.status !== 0) throw new Error(`ffmpeg failed for ${input}`);
}

async function exists(Bucket, Key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket, Key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

run(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      username: { type: 'string' },
      overwrite: { type: 'boolean', default: false },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.username || !positionals.length) throw usageError();

  const files = expandInputs(positionals);
  if (!files.length) throw new Error('No video files found.');

  const { BucketName } = await stackOutputs(values.stack);
  const { sub, username } = await getStudent({ stack: values.stack, username: values.username });
  console.log(`Student: ${username} (sub ${sub})`);

  const ffmpeg = findTool('ffmpeg');
  const ffprobe = findTool('ffprobe');
  if (!ffmpeg || !ffprobe) console.warn('ffmpeg/ffprobe not found: uploading files unchanged.');

  const workDir = mkdtempSync(join(tmpdir(), 'laguitarrita-upload-'));
  try {
    for (const file of files) {
      let source = file;
      let fileName = basename(file);
      const side = ffmpeg && ffprobe ? shortSide(ffprobe, file) : null;
      const recorded = ffprobe ? recordingDate(ffprobe, file) : null;
      if (side && side > TARGET_HEIGHT) {
        fileName = `${basename(file, extname(file))}.mp4`;
        source = join(workDir, fileName);
        console.log(`Re-encoding ${basename(file)} (${side}p -> ${TARGET_HEIGHT}p)...`);
        transcode(ffmpeg, file, source);
      } else if (side) {
        console.log(`${basename(file)} is already ${side}p, uploading unchanged.`);
      }

      const Key = `${videosPrefix(sub)}${fileName}`;
      if (!values.overwrite && (await exists(BucketName, Key))) {
        console.log(`Skipped ${fileName}: already uploaded (use --overwrite to replace it).`);
        continue;
      }
      const size = statSync(source).size;
      await new Upload({
        client: s3,
        params: {
          Bucket: BucketName,
          Key,
          Body: createReadStream(source),
          ContentType: CONTENT_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream',
          Metadata: recorded ? { recorded } : undefined,
        },
      }).done();
      console.log(`Uploaded ${fileName} (${mb(size)}, recorded ${recorded ?? 'unknown: upload date is used'})`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}, usage);
