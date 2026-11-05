// Regenerates assets/icon.png and assets/icon.ico from assets/icon.svg.
// Needs @resvg/resvg-js (not a project dependency): npm i --no-save @resvg/resvg-js
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const dir = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(dir, 'icon.svg'));
const png = (n) => new Resvg(svg, { fitTo: { mode: 'width', value: n } }).render().asPng();

fs.writeFileSync(path.join(dir, 'icon.png'), png(512));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const imgs = sizes.map(png);
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;
  e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(imgs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += imgs[i].length;
  return e;
});
fs.writeFileSync(path.join(dir, 'icon.ico'), Buffer.concat([head, ...entries, ...imgs]));
console.log('icons written');
