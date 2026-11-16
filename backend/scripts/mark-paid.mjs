#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { run, usageError } from './lib.mjs';
import { DEFAULT_KONZERT_STACK, chooseTicket, matchTickets, scanTickets, setPaid } from './konzert-lib.mjs';

const usage = `Usage: node scripts/mark-paid.mjs <id | name | "Konzert Name N"> [more...] [--unpaid] [--stack <name>]
  Marks one or more tickets as paid (or, with --unpaid, as not paid). A selector may be a ticket id,
  a buyer name or the full reference text. If a name matches several tickets you are asked which one.
  The "paid" flag is informational only: it never changes the capacity.`;

run(async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      unpaid: { type: 'boolean', default: false },
      stack: { type: 'string', default: DEFAULT_KONZERT_STACK },
    },
  });
  if (!positionals.length) throw usageError();

  const paid = !values.unpaid;
  const { tickets } = await scanTickets({ stack: values.stack });

  let changed = 0;
  for (const selector of positionals) {
    const matches = matchTickets(tickets, selector);
    if (!matches.length) {
      console.log(`No ticket matches "${selector}".`);
      continue;
    }
    const chosen = matches.length === 1 ? [matches[0]] : [await chooseTicket(matches, 'name')].filter(Boolean);
    if (!chosen.length) {
      console.log(`Skipped "${selector}".`);
      continue;
    }
    for (const t of chosen) {
      await setPaid({ stack: values.stack, id: t.id, paid });
      t.paid = paid; // keep in-memory copy correct if the same name is selected again
      console.log(`${paid ? 'Paid' : 'Unpaid'}: ${t.reference}  (${t.id})`);
      changed++;
    }
  }
  console.log(`\nUpdated ${changed} ticket(s).`);
}, usage);
