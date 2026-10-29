#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DEFAULT_STACK, normalizeEmail, passwordFromArgs, run, setPermanentPassword, usageError } from './lib.mjs';

const usage = `Usage: node scripts/reset-password.mjs --email <email> [--password <new password>] [--stack <name>]
  Sets a new permanent password and signs the student out on all devices.`;

run(async () => {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      password: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_STACK },
    },
  });
  if (!values.email) throw usageError();
  const password = await passwordFromArgs(values, 'New password');
  await setPermanentPassword({ stack: values.stack, email: values.email, password });
  console.log(`Password updated for ${normalizeEmail(values.email)}.`);
}, usage);
