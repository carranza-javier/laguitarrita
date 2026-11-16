#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run, usageError } from './lib.mjs';
import { DEFAULT_KONZERT_STACK, cancelTicket, chooseTicket, matchTickets, scanTickets } from './konzert-lib.mjs';

const usage = `Usage: node scripts/cancel-ticket.mjs <id | name | "Konzert Name N"> [more...] [--stack <name>]
  Cancels one or more tickets and frees their seats (they stop counting towards the capacity).
  A selector may be a ticket id, a buyer name or the full reference text; if a name matches several
  tickets you are asked which one.`;

run(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { stack: { type: 'string', default: DEFAULT_KONZERT_STACK } },
  });
  if (!positionals.length) throw usageError();

  const { tickets } = await scanTickets({ stack: values.stack });
  const active = tickets.filter((t) => t.status === 'active');

  let freed = 0;
  for (const selector of positionals) {
    const matches = matchTickets(active, selector);
    if (!matches.length) {
      console.log(`No active ticket matches "${selector}".`);
      continue;
    }
    const chosen = matches.length === 1 ? [matches[0]] : [await chooseTicket(matches, 'name')].filter(Boolean);
    if (!chosen.length) {
      console.log(`Skipped "${selector}".`);
      continue;
    }
    for (const t of chosen) {
      await cancelTicket({ stack: values.stack, ticket: t });
      t.status = 'cancelled';
      console.log(`Cancelled: ${t.reference}  (freed ${t.tickets} seat(s), ${t.id})`);
      freed += Number(t.tickets);
    }
  }
  console.log(`\nFreed ${freed} seat(s).`);
}, usage);
