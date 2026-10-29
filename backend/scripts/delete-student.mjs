#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, deleteStudent, normalizeEmail, run, usageError } from './lib.mjs';

const usage = `Usage: node scripts/delete-student.mjs --email <email> [--delete-videos] [--stack <name>]
  Deletes the student's login. Their videos stay in S3 unless --delete-videos is passed.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      'delete-videos': { type: 'boolean', default: false },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.email) throw usageError();
  const { sub, deleted } = await deleteStudent({
    stack: values.stack,
    email: values.email,
    deleteVideos: values['delete-videos'],
  });
  console.log(`Deleted student ${normalizeEmail(values.email)} (sub ${sub}).`);
  console.log(
    values['delete-videos']
      ? `Deleted ${deleted} file(s) under students/${sub}/.`
      : `Videos kept under students/${sub}/ (pass --delete-videos to remove them).`,
  );
}, usage);
