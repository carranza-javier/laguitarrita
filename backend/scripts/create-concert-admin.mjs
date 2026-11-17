#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { passwordFromArgs, run, usageError } from './lib.mjs';
import { DEFAULT_KONZERT_STACK, createConcertAdmin, normalizeAdminUsername } from './konzert-admin-lib.mjs';

const usage = `Usage: node scripts/create-concert-admin.mjs --username <username> [--password <password>] [--stack <name>]
  Creates the single concert-admin user with a permanent password (no message, no password change on
  first login). The password must be at least 12 characters. If --password is omitted you are asked
  for it without echo. Stack defaults to ${DEFAULT_KONZERT_STACK} (override with --stack or KONZERT_STACK).`;

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
  const password = await passwordFromArgs(values);
  try {
    await createConcertAdmin({ stack: values.stack, username, password });
    console.log(`Created concert admin ${username} in ${values.stack}.`);
  } catch (err) {
    if (err.name === 'UsernameExistsException') {
      throw new Error('This admin user already exists. Use reset-concert-admin-password to change the password.');
    }
    throw err;
  }
}, usage);
