import { useMemo, useState } from 'react';
import { Doc } from '../app/model';
import { importStamp } from '../app/stampImport';
import { canDeleteMarkup, ownsMarkup, Actor } from '../core/comments';
import { groupWatermarks } from '../core/watermarks';
import { Markup } from '../core/types';
import { StandardColorPicker } from './StandardColorPicker';

interface WatermarksManagerProps {
  doc: Doc;
  user: Actor;
  selectedId: string | null;
  readOnly?: boolean;
  onSelect(id: string): void;
  onUpdate(id: string, patch: Partial<Markup>, key?: string): void;
  onDelete(id: string): void;
}

export function WatermarksManager({ doc, user, selectedId, readOnly = false, onSelect, onUpdate, onDelete }: WatermarksManagerProps) {
  const groups = useMemo(() => groupWatermarks(doc.markups), [doc.markups]);
  const selectedGroup = groups.find((group) => group.markups.some((markup) => markup.id === selectedId)) ?? groups[0] ?? null;
  const selected = selectedGroup?.markups[0] ?? null;
  const canEdit = !!selected && !readOnly && (!doc.shared || selectedGroup.markups.every((markup) => ownsMarkup(markup, user)));
  const kindLabel = selected?.watermarkKind === 'pdf' ? 'PDF page' : selected?.watermarkKind === 'image' ? 'Image' : 'Text';
  const pageLabel = selectedGroup?.markups.map((markup) => markup.page + 1).join(', ');

  const replaceSource = async () => {
    if (!selected) return;
    try {
      if (!window.api) throw new Error('File import is unavailable.');
      const filters = selected.watermarkKind === 'pdf'
        ? [{ name: 'PDF documents', extensions: ['pdf'] }]
        : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];
      const [file] = await window.api.openFiles({ multi: false, filters });
      if (!file) return;
      const image = await importStamp(file, (total) => {
        const answer = window.prompt(`Choose a PDF page from 1 to ${total}:`, '1');
        return answer === null ? null : Number(answer);
      });
      if (image) onUpdate(selected.id, { image, watermarkName: file.name }, 'watermark-source');
    } catch (error) {
      window.alert(`Could not replace watermark source: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="panel-body watermarks-manager">
      <h3>Watermarks Manager</h3>
      {groups.length === 0 ? <p className="muted">No watermarks yet. Choose Watermark in the content toolbar to add one.</p> : (
        <>
          <div className="list">
            {groups.map((group) => {
              const markup = group.markups[0];
              const label = markup.watermarkName || (markup.watermarkKind === 'text' ? markup.stamp : markup.watermarkKind === 'pdf' ? 'PDF watermark' : 'Image watermark');
              return (
                <button
                  type="button"
                  key={group.key}
                  className={'item watermark-item' + (group.key === selectedGroup?.key ? ' active' : '')}
                  onClick={() => onSelect(markup.id)}
                >
                  <span className="swatch" style={{ background: markup.color }} />
                  <span className="grow">
                    <b>{markup.watermarkKind === 'pdf' ? 'PDF' : markup.watermarkKind === 'image' ? 'Image' : 'Text'} watermark</b>
                    <span className="muted"> · {group.markups.length} page{group.markups.length === 1 ? '' : 's'}</span>
                    <span className="muted small watermark-item-name">{label}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {selected && selectedGroup && (
            <section className="props watermark-properties" aria-label="Watermark properties">
              <h4>{kindLabel} watermark properties</h4>
              <p className="muted small">Applied to page{selectedGroup.markups.length === 1 ? '' : 's'} {pageLabel}</p>
              <button type="button" onClick={() => onSelect(selected.id)}>Select on page to resize</button>
              <fieldset disabled={!canEdit}>
                {selected.watermarkKind === 'text' ? (
                  <>
                    <label>
                      Text
                      <textarea
                        spellCheck
                        rows={2}
                        value={selected.stamp ?? ''}
                        onChange={(event) => onUpdate(selected.id, { stamp: event.target.value, watermarkName: event.target.value }, 'watermark-text')}
                      />
                    </label>
                    <label>
                      Font size ({selected.fontSize ?? 12} pt)
                      <input
                        type="number"
                        min={6}
                        max={240}
                        value={selected.fontSize ?? 12}
                        onChange={(event) => onUpdate(selected.id, { fontSize: Math.max(6, +event.target.value || 12) }, 'watermark-font-size')}
                      />
                    </label>
                    <label>
                      Color
                      <StandardColorPicker value={selected.color} onChange={(color) => onUpdate(selected.id, { color }, 'watermark-color')} />
                    </label>
                  </>
                ) : (
                  <>
                    <p className="muted small">{selected.watermarkName || `${kindLabel} watermark source`}</p>
                    <button type="button" onClick={() => void replaceSource()}>Replace source...</button>
                    <label className="inline-check">
                      Lock aspect ratio
                      <input
                        type="checkbox"
                        checked={selected.imageLockAspectRatio !== false}
                        onChange={(event) => onUpdate(selected.id, { imageLockAspectRatio: event.target.checked }, 'watermark-aspect')}
                      />
                    </label>
                  </>
                )}
                <label>
                  Opacity ({Math.round(selected.opacity * 100)}%)
                  <input type="range" min={0.05} max={1} step={0.05} value={selected.opacity} onChange={(event) => onUpdate(selected.id, { opacity: +event.target.value }, 'watermark-opacity')} />
                </label>
                <label>
                  Rotation ({selected.rotation ?? 0}°)
                  <input type="range" min={-180} max={180} step={1} value={selected.rotation ?? 0} onChange={(event) => onUpdate(selected.id, { rotation: +event.target.value }, 'watermark-rotation')} />
                </label>
                {!canEdit && <p className="muted small">Only the watermark author can edit it in this shared document.</p>}
              </fieldset>
              <button className="danger" disabled={!selectedGroup.markups.every((markup) => canDeleteMarkup(markup, user)) || readOnly} onClick={() => onDelete(selected.id)}>
                Delete watermark from all pages
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
