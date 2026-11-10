const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const root = path.resolve(__dirname, '..');
const markdownPath = path.join(root, 'docs', 'USER-MANUAL.md');
const outputPath = path.resolve(process.argv[2] || path.join(root, 'docs', 'USER-MANUAL.pdf'));
const markdown = fs.readFileSync(markdownPath, 'utf8');

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function imageDataUrl(relativePath) {
  const imagePath = path.resolve(path.dirname(markdownPath), relativePath);
  const extension = path.extname(imagePath).toLowerCase();
  const mime = extension === '.svg' ? 'image/svg+xml' : `image/${extension.slice(1)}`;
  return `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`;
}

function inline(source) {
  const code = [];
  let html = escapeHtml(source).replace(/`([^`]+)`/g, (_, content) => {
    const token = `@@CODE${code.length}@@`;
    code.push(`<code>${content}</code>`);
    return token;
  });

  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, sourcePath) =>
    `<figure class="manual-image"><img src="${imageDataUrl(sourcePath)}" alt="${alt}"></figure>`);
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    `<a href="${href}">${label}</a>`);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/@@CODE(\d+)@@/g, (_, index) => code[Number(index)]);
  return html;
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+\s*$/, '');
      output.push(`<h${level} id="${slug(text)}">${inline(text)}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const headers = tableCells(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      output.push(`<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) =>
        `<tr>${headers.map((_, cellIndex) => `<td>${inline(row[cellIndex] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const firstIndent = (line.match(/^\s*/) || [''])[0].length;
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (index < lines.length && (/^\s*[-*]\s+/.test(lines[index]) || /^\s*\d+\.\s+/.test(lines[index]))) {
        const match = /^\s*(?:[-*]|\d+\.)\s+(.+)$/.exec(lines[index]);
        const indent = (lines[index].match(/^\s*/) || [''])[0].length;
        items.push(`<li${indent > firstIndent ? ' class="nested"' : ''}>${inline(match[1])}</li>`);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      output.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(inline(lines[index].replace(/^\s*>\s?/, '')));
        index += 1;
      }
      output.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !(lines[index].includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1]))) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return output.join('\n');
}

function findBrowser() {
  const candidates = [
    process.env.MANUAL_BROWSER,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ThryvoPDF Markup Studio User Manual</title>
<style>
  @page { size: Letter; margin: 0.62in 0.68in 0.68in; }
  * { box-sizing: border-box; }
  body { color: #233746; font: 10pt/1.38 "Segoe UI", Arial, sans-serif; }
  h1, h2, h3, h4 { color: #163d56; page-break-after: avoid; line-height: 1.18; }
  h1 { margin: 0 0 12pt; font-size: 26pt; letter-spacing: -.4pt; }
  h2 { margin: 24pt 0 9pt; padding-bottom: 4pt; border-bottom: 1px solid #d5e0e6; font-size: 16pt; }
  h3 { margin: 16pt 0 6pt; font-size: 12pt; }
  h4 { margin: 12pt 0 5pt; font-size: 10.5pt; }
  p { margin: 5pt 0 8pt; orphans: 3; widows: 3; }
  ul, ol { margin: 5pt 0 9pt; padding-left: 22pt; }
  li { margin: 2.5pt 0; padding-left: 1pt; }
  li.nested { margin-left: 15pt; list-style-type: disc; }
  strong { color: #183f56; }
  a { color: #145c88; text-decoration: none; }
  code { padding: 1pt 3pt; border-radius: 3pt; background: #edf2f5; color: #274c63; font: 9pt Consolas, monospace; }
  blockquote { margin: 8pt 0; padding: 5pt 10pt; border-left: 3px solid #6e9db5; background: #f4f8fa; color: #40596a; }
  table { width: 100%; margin: 8pt 0 12pt; border-collapse: collapse; font-size: 9pt; }
  th, td { padding: 5pt 6pt; border: 1px solid #d6e0e5; text-align: left; vertical-align: top; }
  th { background: #edf4f7; color: #173f56; font-weight: 700; }
  tr { page-break-inside: avoid; }
  figure.manual-image { margin: 10pt auto 6pt; text-align: center; page-break-inside: avoid; }
  figure.manual-image img { display: block; max-width: 100%; max-height: 6.5in; margin: 0 auto; object-fit: contain; }
  figure.manual-image + p { margin-top: 3pt; color: #587080; font-size: 9pt; font-style: italic; text-align: center; }
  hr { border: 0; border-top: 1px solid #d5e0e6; }
</style>
</head>
<body>
${renderMarkdown(markdown)}
</body>
</html>`;

const browser = findBrowser();
if (!browser) {
  throw new Error('Microsoft Edge or Google Chrome was not found. Set MANUAL_BROWSER to its executable path.');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thryvopdf-manual-'));
const htmlPath = path.join(tempDir, 'manual.html');
const renderedPath = path.join(tempDir, 'rendered.pdf');
const edgeProfilePath = path.join(tempDir, 'edge-profile');
const stagedPath = path.join(path.dirname(outputPath), `.USER-MANUAL-${process.pid}.pdf`);

async function main() {
  try {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(htmlPath, html, 'utf8');
    execFileSync(browser, [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${edgeProfilePath}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${renderedPath}`,
      pathToFileURL(htmlPath).href,
    ], { stdio: 'inherit', timeout: 120000 });

    const pdf = await PDFDocument.load(fs.readFileSync(renderedPath));
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontSize = 7.5;
    const pages = pdf.getPages();
    pages.forEach((page, index) => {
      const { width } = page.getSize();
      const left = 49;
      const right = width - 49;
      const footerY = 26;
      const title = 'ThryvoPDF Markup Studio User Manual';
      const creator = 'Created by Tito Libunao Jr.';
      const pageNumber = `Page ${index + 1} of ${pages.length}`;
      const color = rgb(0.31, 0.41, 0.48);
      page.drawLine({
        start: { x: left, y: 44 },
        end: { x: right, y: 44 },
        thickness: 0.6,
        color: rgb(0.82, 0.87, 0.9),
      });
      page.drawText(title, { x: left, y: footerY, size: fontSize, font, color });
      page.drawText(creator, {
        x: (width - font.widthOfTextAtSize(creator, fontSize)) / 2,
        y: footerY,
        size: fontSize,
        font,
        color,
      });
      page.drawText(pageNumber, {
        x: right - font.widthOfTextAtSize(pageNumber, fontSize),
        y: footerY,
        size: fontSize,
        font,
        color,
      });
    });

    const bytes = await pdf.save();
    if (bytes.length < 10000) {
      throw new Error(`Generated PDF is unexpectedly small (${bytes.length} bytes).`);
    }
    fs.writeFileSync(stagedPath, bytes);
    fs.renameSync(stagedPath, outputPath);
    console.log(`Generated ${path.relative(root, outputPath)} (${bytes.length} bytes, ${pages.length} pages).`);
  } finally {
    if (fs.existsSync(stagedPath)) fs.rmSync(stagedPath, { force: true });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
