#!/usr/bin/env node
import { CopyObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, getStudent, run, s3, stackOutputs, usageError, videosPrefix } from './lib.mjs';

const usage = `Usage: node scripts/order-videos.mjs --username <username> <file> [<file> ...] [--date YYYY-MM-DD] [--stack <name>]
  Sets the recording date of the named files so the student sees them in exactly this order: the first
  file on top, then the next, and so on. Only the date metadata changes — the files are not re-uploaded.
  Pass the file names exactly as uploaded, including the extension. By default the files are dated today
  (so they appear as the newest); --date puts them on another day and month. Files you do not name are
  left untouched. Run this after uploading, since a re-upload resets a file's date from its own metadata.`;

// One minute between files, counting down from noon UTC so the first file is the newest (top).
const BASE_HOUR_UTC = 'T12:00:00.000Z';
const STEP_MS = 60 * 1000;

run(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      username: { type: 'string' },
      date: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.username || !positionals.length) throw usageError();

  const day = values.date ?? new Date().toISOString().slice(0, 10);
  const base = Date.parse(`${day}${BASE_HOUR_UTC}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(base)) throw new Error('--date must be a valid YYYY-MM-DD.');

  const { BucketName } = await stackOutputs(values.stack);
  const { sub } = await getStudent({ stack: values.stack, username: values.username });
  const prefix = videosPrefix(sub);

  // Validate every file first, so a typo never leaves a half-applied order.
  const files = [];
  for (const name of positionals) {
    const Key = `${prefix}${name}`;
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BucketName, Key }));
      files.push({ name, Key, contentType: head.ContentType });
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`No file named "${name}" for ${values.username}. Pass the name exactly as uploaded.`);
      }
      throw err;
    }
  }

  for (let i = 0; i < files.length; i++) {
    const { name, Key, contentType } = files[i];
    const recorded = new Date(base - i * STEP_MS).toISOString();
    const CopySource = `${BucketName}/` + Key.split('/').map(encodeURIComponent).join('/');
    await s3.send(
      new CopyObjectCommand({
        Bucket: BucketName,
        Key,
        CopySource,
        MetadataDirective: 'REPLACE',
        Metadata: { recorded },
        ContentType: contentType,
      }),
    );
    console.log(`${String(i + 1).padStart(2)}. ${name}`);
  }
  console.log(`\nDone: ${files.length} file(s) dated ${day}. The student sees them in this order, first on top.`);
}, usage);
