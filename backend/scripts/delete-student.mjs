#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, deleteStudent, normalizeUsername, run, usageError } from './lib.mjs';

const usage = `Usage: node scripts/delete-student.mjs --username <username> [--delete-videos] [--stack <name>]
  Deletes the student's login. Their videos stay in S3 unless --delete-videos is passed.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      'delete-videos': { type: 'boolean', default: false },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.username) throw usageError();
  const username = normalizeUsername(values.username);
  const { sub, deleted } = await deleteStudent({
    stack: values.stack,
    username,
    deleteVideos: values['delete-videos'],
  });
  console.log(`Deleted student ${username} (sub ${sub}).`);
  console.log(
    values['delete-videos']
      ? `Deleted ${deleted} file(s) under students/${sub}/.`
      : `Videos kept under students/${sub}/ (pass --delete-videos to remove them).`,
  );
}, usage);
