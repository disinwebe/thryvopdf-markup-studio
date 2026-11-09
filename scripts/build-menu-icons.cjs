const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

const dir = path.join(__dirname, '..', 'assets', 'menu');
fs.mkdirSync(dir, { recursive: true });
const symbols = {
  open: 'M2 5h5l2 2h5l-1 6H2z',
  save: 'M3 2h8l2 2v10H3z M5 2v4h5V2 M5 14V9h6v5',
  saveAs: 'M13 2H5L3 4v10h10z M11 2v4H6V2 M11 14V9H5v5',
  export: 'M3 2h7l3 3v9H3z M6 8h7 M10 5l3 3-3 3',
  close: 'M4 4l8 8 M12 4l-8 8',
  key: 'M6.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M6 8h7m-2 0v2m-2-2v2',
  exit: 'M8 2h5v12H8M1 8h8m-3-3 3 3-3 3',
  undo: 'M6 4L2 8l4 4 M2 8h7c3 0 4 2 4 4',
  redo: 'M10 4l4 4-4 4 M14 8H7c-3 0-4 2-4 4',
  select: 'M3 2l9 7-5 1-2 4z',
  pan: 'M5 8V3 M7 7V2 M9 7V3 M11 8V4 M5 8L3 6l-1 2 4 6h5l2-4V6',
  delete: 'M3 4h10 M5 4V2h6v2 M4 4l1 10h6l1-10 M7 6v6 M9 6v6',
  users: 'M8 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M3 14c0-3 2-5 5-5s5 2 5 5z',
  settings: 'M3 4h10 M3 8h10 M3 12h10 M6 2v4 M10 6v4 M7 10v4',
  zoomIn: 'M7 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M11 11l3 3 M4.5 7h5 M7 4.5v5',
  zoomOut: 'M7 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M11 11l3 3 M4.5 7h5',
  page: 'M3 2h7l3 3v9H3z M5 8h6 M5 10h6',
  help: 'M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12 M6 6c0-2 4-2 4 0 0 1-2 1-2 3 M8 11v1',
  license: 'M4 2h8v9l-2-1-2 3-2-3-2 1z M6 5h4 M6 7h4',
};
for (const [name, shape] of Object.entries(symbols)) {
  for (const [theme, color] of [['light', '#222222'], ['dark', '#eeeeee']]) {
    const canvas = createCanvas(32, 32);
    const context = canvas.getContext('2d');
    context.scale(2, 2);
    context.strokeStyle = color;
    context.lineWidth = 1.15;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const { Path2D } = require('@napi-rs/canvas');
    context.stroke(new Path2D(shape));
    fs.writeFileSync(path.join(dir, `${name}-${theme}.png`), canvas.toBuffer('image/png'));
  }
}
