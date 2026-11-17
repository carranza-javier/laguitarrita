#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import { run } from './lib.mjs';
import { DEFAULT_KONZERT_STACK, formatDate, konzertConfig, scanTickets } from './konzert-lib.mjs';

const usage = `Usage: node scripts/list-tickets.mjs [--csv] [--out <file.csv>] [--stack <name>]
  Lists the active tickets (unpaid first), the expected TWINT reference and amount, and the totals.
  --csv        print the door list as CSV (e.g. > door.csv)
  --out <file> write the CSV door list to a file`;

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

run(async () => {
  const { values } = parseArgs({
    options: {
      csv: { type: 'boolean', default: false },
      out: { type: 'string' },
      stack: { type: 'string', default: DEFAULT_KONZERT_STACK },
    },
  });

  const { capacity, price } = await konzertConfig(values.stack);
  const { tickets, sold } = await scanTickets({ stack: values.stack });

  const active = tickets.filter((t) => t.status === 'active');
  const cancelled = tickets.filter((t) => t.status !== 'active');
  // Unpaid first, then oldest first.
  active.sort((a, b) => Number(a.paid) - Number(b.paid) || String(a.createdAt).localeCompare(String(b.createdAt)));

  const rows = active.map((t) => ({
    reference: t.reference ?? `Konzert ${t.name} ${t.tickets}`,
    name: t.name ?? '',
    tickets: Number(t.tickets),
    amount: Number(t.tickets) * price,
    paid: t.paid ? 'yes' : 'no',
    // "arrived" (llegada) is false for older tickets that predate the field; treat absent as not arrived.
    arrived: t.arrived ? 'yes' : 'no',
    date: formatDate(t.createdAt),
  }));

  const ticketsSold = active.reduce((n, t) => n + Number(t.tickets), 0);
  const paidTickets = active.filter((t) => t.paid).reduce((n, t) => n + Number(t.tickets), 0);
  const header = ['Reference', 'Name', 'Tickets', `Amount (CHF)`, 'Paid', 'Arrived', 'Date'];

  // CSV output (door list).
  if (values.csv || values.out) {
    const lines = [header, ...rows.map((r) => [r.reference, r.name, r.tickets, r.amount, r.paid, r.arrived, r.date])]
      .map((cols) => cols.map(csvCell).join(','))
      .join('\n');
    if (values.out) {
      writeFileSync(values.out, lines + '\n');
      console.log(`Wrote ${rows.length} ticket(s) to ${values.out}`);
    } else {
      console.log(lines);
    }
    return;
  }

  // Pretty table.
  if (!rows.length) {
    console.log('No active tickets yet.');
  } else {
    const table = [
      header,
      ...rows.map((r) => [r.reference, r.name, String(r.tickets), String(r.amount), r.paid, r.arrived, r.date]),
    ];
    const widths = header.map((_, c) => Math.max(...table.map((row) => row[c].length)));
    const pad = (row) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ');
    console.log(pad(table[0]));
    console.log(widths.map((w) => '-'.repeat(w)).join('  '));
    for (const row of table.slice(1)) console.log(pad(row));
  }

  console.log('');
  console.log(`Tickets sold (active): ${ticketsSold} / ${capacity}`);
  console.log(`  paid:      ${paidTickets}`);
  console.log(`  unpaid:    ${ticketsSold - paidTickets}`);
  console.log(`  available: ${Math.max(0, capacity - sold)}`);
  console.log(`Total expected: CHF ${ticketsSold * price}  (CHF ${price} per ticket)`);
  if (cancelled.length) console.log(`Cancelled tickets (not counted): ${cancelled.length}`);
}, usage);
