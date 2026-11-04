import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const out = process.argv[2] || 'samples/sample-a.pdf';
const rev = process.argv[3] === 'b';
mkdirSync(dirname(out), { recursive: true });
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 2; i++) {
  const p = doc.addPage([792, 612]);
  p.drawRectangle({ x: 40, y: 40, width: 712, height: 532, borderWidth: 2, borderColor: rgb(0, 0, 0) });
  p.drawRectangle({ x: 100, y: 200, width: 300, height: 200, borderWidth: 1.5, borderColor: rgb(0, 0, 0) });
  p.drawLine({ start: { x: 100, y: 300 }, end: { x: 400, y: 300 }, thickness: 1 });
  if (rev) p.drawCircle({ x: 550, y: 300, size: 50, borderWidth: 2, borderColor: rgb(0, 0, 0) });
  p.drawText(`A-10${i} FLOOR PLAN${rev ? ' REV B' : ' REV A'}`, { x: 60, y: 540, size: 20, font });
}
writeFileSync(out, await doc.save());
console.log('wrote', out);
