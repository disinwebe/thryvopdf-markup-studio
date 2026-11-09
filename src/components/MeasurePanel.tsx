import { useState } from 'react';
import { Doc } from '../app/model';
import { calibrateFromDistance, calibrateFromScale, DEFAULT_CAL, takeoffCsv, takeoffSummary, formatValue } from '../core/measurement';
import { dist } from '../core/geometry';
import { Calibration, Pt, UNITS, Unit } from '../core/types';

export interface MeasurePanelProps {
  doc: Doc;
  pending: { a: Pt; b: Pt } | null;
  subject: string;
  onSubject(s: string): void;
  onTool(t: 'calibrate'): void;
  onSetCal(cal: Calibration, allPages: boolean): void;
  onClearPending(): void;
  onExport(csv: string): void;
  onMessage(msg: string): void;
}

export function MeasurePanel(p: MeasurePanelProps) {
  const { doc } = p;
  const cal = doc.calibrations[doc.page] ?? DEFAULT_CAL;
  const [known, setKnown] = useState('');
  const [unit, setUnit] = useState<Unit>('ft');
  const [realScale, setRealScale] = useState('10');
  const [scaleUnit, setScaleUnit] = useState<Unit>('ft');
  const [outUnit, setOutUnit] = useState<Unit>('ft');
  const [all, setAll] = useState(false);

  const applyKnown = () => {
    if (!p.pending) return;
    try {
      p.onSetCal(calibrateFromDistance(p.pending.a, p.pending.b, parseFloat(known), unit), all);
      setKnown('');
    } catch {
      p.onMessage('Enter a positive known distance');
    }
  };
  const applyScale = () => {
    try {
      p.onSetCal(calibrateFromScale(1, parseFloat(realScale), scaleUnit), all);
    } catch {
      p.onMessage('Enter positive scale values');
    }
  };
  const summary = takeoffSummary(doc.markups, (pg) => doc.calibrations[pg] ?? DEFAULT_CAL, outUnit);

  return (
    <div className="panel-body">
      <h4>Scale - page {doc.page + 1}</h4>
      <div className={cal.calibrated ? 'ok' : 'warn'}>
        {cal.calibrated
          ? `Calibrated: 100 pt = ${formatValue(cal.unitsPerPoint * 100, cal.unit)}`
          : 'Not calibrated - values are paper size (inches)'}
      </div>
      <div className="row">
        <button onClick={() => p.onTool('calibrate')}>Calibrate (pick 2 points)</button>
      </div>
      {p.pending && (
        <div className="box">
          Picked {dist(p.pending.a, p.pending.b).toFixed(1)} pt. Known distance:
          <div className="row">
            <input value={known} onChange={(e) => setKnown(e.target.value)} placeholder="e.g. 20" onKeyDown={(e) => e.key === 'Enter' && applyKnown()} autoFocus />
            <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <button onClick={applyKnown}>Apply</button>
            <button onClick={p.onClearPending}>Cancel</button>
          </div>
        </div>
      )}
      <div className="row">
        <span>1 in on paper =</span>
        <input style={{ width: 54 }} value={realScale} onChange={(e) => setRealScale(e.target.value)} />
        <select value={scaleUnit} onChange={(e) => setScaleUnit(e.target.value as Unit)}>
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <button onClick={applyScale}>Set scale</button>
      </div>
      <label className="row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Apply to all pages
      </label>

      <h4>New measurement subject</h4>
      <input value={p.subject} placeholder="e.g. Exterior wall, Doors" onChange={(e) => p.onSubject(e.target.value)} />

      <h4>
        Takeoff
        <select value={outUnit} onChange={(e) => setOutUnit(e.target.value as Unit)} title="Output unit">
          {UNITS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
        <button onClick={() => p.onExport(takeoffCsv(doc.markups, (pg) => doc.calibrations[pg] ?? DEFAULT_CAL, outUnit))}>Export CSV</button>
      </h4>
      <table className="takeoff-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Type</th>
            <th>Items</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {summary.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No measurements yet.
              </td>
            </tr>
          )}
          {summary.map((r) => (
            <tr key={r.subject + r.kind}>
              <td>{r.subject}</td>
              <td>{r.kind}</td>
              <td>{r.count}</td>
              <td>{r.kind === 'count' ? r.count : formatValue(r.total, r.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
