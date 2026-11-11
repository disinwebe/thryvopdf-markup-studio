import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import App from '../../src/App';
import { saveWithState } from '../../src/core/annotations';
import '../../src/styles.css';

const user = { name: 'Morgan Lee', email: 'morgan@example.test', discipline: 'Architecture', role: 'admin' };
const timestamp = '2026-11-11T10:00:00.000Z';

async function samplePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([792, 612]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const dark = rgb(0.13, 0.21, 0.28);
  const blue = rgb(0.12, 0.35, 0.58);
  const light = rgb(0.91, 0.94, 0.96);
  page.drawRectangle({ x: 28, y: 28, width: 736, height: 556, borderWidth: 1.4, borderColor: dark });
  page.drawText('A-101  FLOOR PLAN', { x: 44, y: 554, size: 15, font: bold, color: dark });
  page.drawText('LEVEL 01  |  RENOVATION REVIEW  |  REVISION C', { x: 44, y: 536, size: 7, font, color: blue });
  page.drawLine({ start: { x: 44, y: 526 }, end: { x: 748, y: 526 }, thickness: 0.7, color: dark });

  const rooms = [
    { x: 74, y: 290, w: 230, h: 205, name: 'LOBBY' },
    { x: 304, y: 290, w: 220, h: 205, name: 'CONFERENCE' },
    { x: 524, y: 290, w: 194, h: 205, name: 'OFFICE' },
    { x: 74, y: 92, w: 300, h: 198, name: 'OPEN WORKSPACE' },
    { x: 374, y: 92, w: 180, h: 198, name: 'STORAGE' },
    { x: 554, y: 92, w: 164, h: 198, name: 'RESTROOM' },
  ];
  for (const room of rooms) {
    page.drawRectangle({ x: room.x, y: room.y, width: room.w, height: room.h, borderWidth: 1.5, borderColor: dark });
    page.drawText(room.name, { x: room.x + 12, y: room.y + room.h - 24, size: 9, font: bold, color: blue });
  }
  page.drawLine({ start: { x: 304, y: 290 }, end: { x: 304, y: 332 }, thickness: 5, color: light });
  page.drawLine({ start: { x: 374, y: 92 }, end: { x: 374, y: 132 }, thickness: 5, color: light });
  page.drawText('N', { x: 730, y: 490, size: 10, font: bold, color: dark });
  page.drawLine({ start: { x: 735, y: 462 }, end: { x: 735, y: 486 }, thickness: 1.5, color: dark });
  page.drawLine({ start: { x: 735, y: 486 }, end: { x: 730, y: 478 }, thickness: 1.5, color: dark });
  page.drawLine({ start: { x: 735, y: 486 }, end: { x: 740, y: 478 }, thickness: 1.5, color: dark });
  page.drawText("SCALE  1/8\" = 1'-0\"", { x: 610, y: 44, size: 8, font, color: dark });

  const markups = [
    {
      id: 'review-cloud-01', type: 'cloud', page: 0,
      points: [{ x: 306, y: 324 }, { x: 416, y: 390 }],
      color: '#e11d48', width: 2, opacity: 1, status: 'Needs review',
      author: 'Morgan Lee', date: timestamp, comments: [{
        id: 'review-comment-01', author: 'Morgan Lee', date: timestamp,
        text: 'Please verify the conference-room door swing and corridor clearance.',
      }],
      callout: { x: 448, y: 350 }, calloutHidden: false, cloudArc: 14,
    },
    {
      id: 'measurement-01', type: 'm-length', page: 0,
      points: [{ x: 120, y: 256 }, { x: 274, y: 256 }],
      color: '#2563eb', width: 2, opacity: 1, status: 'None',
      author: 'Morgan Lee', date: timestamp, comments: [], subject: 'Lobby width',
      measurementArrowheads: 'both',
    },
  ];
  const calibration = { unit: 'ft', unitsPerPoint: 1 / 8, calibrated: true };
  return saveWithState(await document.save(), {
    markups, calibrations: { 0: calibration }, sheets: {}, bookmarks: [],
  });
}

const docs = [
  {
    id: 'doc-a101', name: 'A-101 Floor Plan.pdf', owner: 'Morgan Lee', ownerEmail: user.email,
    size: 2516582, created: timestamp, version: 4, markups: 4,
    reviews: [
      { email: user.email, done: false, updated: null },
      { email: 'alex@example.test', done: true, updated: timestamp },
    ],
    users: [user.email, 'alex@example.test'], project: 'Campus Renovation',
    description: 'Issue for coordination', canRenameGroup: true, canDeleteGroup: true,
  },
  {
    id: 'doc-a102', name: 'A-102 Reflected Ceiling Plan.pdf', owner: 'Morgan Lee', ownerEmail: user.email,
    size: 1887436, created: timestamp, version: 2, markups: 2,
    reviews: [{ email: 'alex@example.test', done: true, updated: timestamp }],
    users: [user.email, 'alex@example.test'], project: 'Campus Renovation',
    description: 'Coordination review · Revision C', canRenameGroup: true, canDeleteGroup: true,
  },
  {
    id: 'doc-s201', name: 'S-201 Foundation Plan.pdf', owner: 'Morgan Lee', ownerEmail: user.email,
    size: 1782579, created: timestamp, version: 1, markups: 0,
    reviews: [{ email: user.email, done: false, updated: null }],
    users: [user.email], project: 'Structural Package', description: 'Foundation review',
    canRenameGroup: true, canDeleteGroup: true,
  },
];

const notification = {
  id: 'assignment-01', type: 'assignment', docId: 'doc-a101', docName: 'A-101 Floor Plan.pdf',
  by: 'Taylor Chen', message: 'Taylor Chen assigned you a markup review: A-101 Floor Plan.pdf',
  created: timestamp, read: false,
};

function CaptureApp() {
  const [file, setFile] = useState(null);
  const scene = new URLSearchParams(location.search).get('scene');
  useEffect(() => {
    let active = true;
    void samplePdf().then((data) => {
      if (active) setFile({ name: 'A-101 Floor Plan.pdf', path: '', data });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!file) return;
    const timer = window.setInterval(() => {
      const canvas = document.querySelector('.page canvas');
      if (!canvas || canvas.width === 0 || canvas.height === 0) return;
      window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [file]);

  useEffect(() => {
    if (scene !== 'shared') return;
    const timer = window.setInterval(() => {
      const openButton = document.querySelector('button[title="Open Shared Documents"]');
      if (!openButton || openButton.disabled) return;
      window.clearInterval(timer);
      openButton.click();
    }, 100);
    return () => window.clearInterval(timer);
  }, [scene, file]);

  useEffect(() => {
    if (scene !== 'markups' || !file) return;
    const timer = window.setInterval(() => {
      const canvas = document.querySelector('.page canvas');
      const markup = document.querySelector('.panel-body .list > .item');
      if (!canvas || canvas.width === 0 || !markup) return;
      window.clearInterval(timer);
      markup.click();
    }, 100);
    return () => window.clearInterval(timer);
  }, [scene, file]);

  if (!file) return <div className="auth">Preparing manual sample…</div>;
  const notificationApi = {
    state: { notifications: [notification], unread: 1, error: null },
    markRead: async () => {},
    clearAll: async () => {},
  };
  window.api = {
    startupFiles: async () => [file],
    setMenuState: () => {},
    onMenuAction: () => () => {},
    sharedDocs: async ({ op }) => {
      if (op === 'list') return { ok: true, docs };
      if (op === 'users') return { ok: true, users: [
        { name: 'Morgan Lee', email: user.email, discipline: 'Architecture' },
        { name: 'Alex Chen', email: 'alex@example.test', discipline: 'Architecture' },
      ] };
      return { ok: true };
    },
  };

  const actions = { serverMode: true, logout: () => {}, changePassword: () => {}, manageUsers: () => {}, notifications: notificationApi };
  return <App user={user} actions={actions} />;
}

createRoot(document.getElementById('root')).render(<CaptureApp />);
