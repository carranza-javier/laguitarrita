#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { passwordFromArgs, run, usageError } from './lib.mjs';
import { DEFAULT_KONZERT_STACK, normalizeAdminUsername, setConcertAdminPassword } from './konzert-admin-lib.mjs';

const usage = `Usage: node scripts/reset-concert-admin-password.mjs --username <username> [--password <new password>] [--stack <name>]
  Sets a new permanent password (at least 12 characters) for the concert-admin user and signs it out
  on all devices. Stack defaults to ${DEFAULT_KONZERT_STACK} (override with --stack or KONZERT_STACK).`;

run(async () => {
  const { values } = parseArgs({
    options: {
      username: { type: 'string' },
      password: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_KONZERT_STACK },
    },
  });
  if (!values.username) throw usageError();
  const username = normalizeAdminUsername(values.username);
  const password = await passwordFromArgs(values, 'New password');
  await setConcertAdminPassword({ stack: values.stack, username, password });
  console.log(`Password updated for concert admin ${username} in ${values.stack}.`);
}, usage);
