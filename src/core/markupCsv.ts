import { TOOL_LABEL } from '../app/model';
import { toCsv } from './measurement';
import { isReviewMarkup, numberMarkups } from './numbering';
import type { Markup } from './types';

export function formatMarkupDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = d.getHours();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

export function markupCsv(markups: Markup[], filename: string): string {
  const nums = numberMarkups(markups);
  const name = filename.split(/[\\/]/).pop() || filename;
  const rows: unknown[][] = [['Comment ID', 'Page', 'Type', 'Filename', 'Author', 'Date', 'Comments', 'Status']];
  for (const m of markups) rows.push([
    nums.get(m.id) ?? '', m.page + 1, TOOL_LABEL[m.type], name, m.author,
    formatMarkupDate(m.date), isReviewMarkup(m) ? m.comments.map((c) => `${c.author}: ${c.text}`).join(' | ') : '', m.status,
  ]);
  return toCsv(rows);
}
