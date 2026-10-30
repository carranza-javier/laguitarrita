#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, normalizeUsername, passwordFromArgs, run, setPermanentPassword, usageError } from './lib.mjs';

const usage = `Usage: node scripts/reset-password.mjs --username <username> [--password <new password>] [--stack <name>]
  Sets a new permanent password and signs the student out on all devices.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      password: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.username) throw usageError();
  const username = normalizeUsername(values.username);
  const password = await passwordFromArgs(values, 'New password');
  await setPermanentPassword({ stack: values.stack, username, password });
  console.log(`Password updated for ${username}.`);
}, usage);
