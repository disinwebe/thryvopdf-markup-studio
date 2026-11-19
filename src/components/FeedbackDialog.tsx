import { useEffect, useState, type FormEvent } from 'react';

type FeedbackCategory = 'bug' | 'suggestion' | 'usability';
type FeedbackStatus = 'new' | 'reviewed' | 'closed';
type FeedbackSubmission = {
  id: string;
  category: FeedbackCategory;
  subject: string;
  message: string;
  steps: string;
  created: string;
  status: FeedbackStatus;
  user: { name: string; email: string };
  app: { version: string; platform: string };
};

export function FeedbackDialog({
  mode,
  user,
  signedIn,
  onClose,
  onSignIn,
}: {
  mode: 'submit' | 'inbox';
  user: AuthUser;
  signedIn: boolean;
  onClose: () => void;
  onSignIn: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [steps, setSteps] = useState('');
  const [appVersion, setAppVersion] = useState('Unknown');
  const [platform] = useState(navigator.platform || 'Unknown');
  const [submissions, setSubmissions] = useState<FeedbackSubmission[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isInbox = mode === 'inbox';

  useEffect(() => {
    void window.api?.appVersion().then(setAppVersion).catch(() => setAppVersion('Unknown'));
  }, []);

  const loadInbox = async () => {
    if (!window.api) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.api.feedbackList();
      if (!result.ok) throw new Error(result.error || 'Could not load feedback.');
      setSubmissions(result.submissions || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isInbox && signedIn) void loadInbox();
  }, [isInbox, signedIn]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!window.api || !signedIn || busy) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const result = await window.api.feedbackSubmit({ category, subject, message, steps, appVersion, platform });
      if (!result.ok) throw new Error(result.error || 'Could not send feedback.');
      setStatus(`Thank you. Your feedback was sent to your administrator. Reference: ${result.id}`);
      setSubject('');
      setMessage('');
      setSteps('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const updateStatus = async (id: string, next: FeedbackStatus) => {
    if (!window.api || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.api.feedbackUpdate({ id, status: next });
      if (!result.ok) throw new Error(result.error || 'Could not update feedback.');
      setSubmissions((items) => items.map((item) => item.id === id ? { ...item, status: next } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.api || busy || !window.confirm('Delete this feedback submission permanently?')) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.api.feedbackDelete(id);
      if (!result.ok) throw new Error(result.error || 'Could not delete feedback.');
      setSubmissions((items) => items.filter((item) => item.id !== id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    }}>
      <section className="usermgmt feedback-dialog">
        <div className="row between">
          <h2 id="feedback-title">{isInbox ? 'Feedback inbox' : 'Send feedback'}</h2>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        {!signedIn ? (
          <div>
            <p>{isInbox ? 'Sign in as an administrator to view the feedback queue.' : "Sign in to your organization's ThryvoPDF server to submit feedback to its administrator."}</p>
            <button type="button" className="primary" onClick={onSignIn}>Sign in</button>
          </div>
        ) : isInbox ? (
          <>
            <p className="muted small">Submissions are stored on this ThryvoPDF server and visible only to administrators.</p>
            <div className="row"><button type="button" onClick={() => void loadInbox()} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button><span>{submissions.length} submission{submissions.length === 1 ? '' : 's'}</span></div>
            {error && <p className="danger" role="alert">{error}</p>}
            {!busy && !submissions.length && !error && <p>No feedback submissions yet.</p>}
            <div className="feedback-list">
              {submissions.map((item) => (
                <article className="feedback-item" key={item.id}>
                  <div className="row between">
                    <strong>{item.subject}</strong>
                    <select aria-label={`Status for ${item.subject}`} value={item.status} disabled={busy} onChange={(event) => void updateStatus(item.id, event.target.value as FeedbackStatus)}>
                      <option value="new">New</option><option value="reviewed">Reviewed</option><option value="closed">Closed</option>
                    </select>
                  </div>
                  <p className="muted small">{item.category} · {item.user.name} ({item.user.email}) · {new Date(item.created).toLocaleString()}</p>
                  <p className="feedback-message">{item.message}</p>
                  {item.steps && <p><strong>Steps to reproduce:</strong><br />{item.steps}</p>}
                  <p className="muted small">ThryvoPDF {item.app.version} · {item.app.platform}</p>
                  <button type="button" disabled={busy} onClick={() => void remove(item.id)}>Delete</button>
                </article>
              ))}
            </div>
          </>
        ) : (
          <form className="feedback-form" onSubmit={(event) => void submit(event)}>
            <p>Send a bug report, suggestion, or usability comment to your ThryvoPDF server administrator.</p>
            <p className="muted small">Submitted as {user.email}. Reports are stored on your organization's server and visible only to its administrators. If the server uses HTTP, network traffic is not encrypted. App version and operating system are included; PDFs, filenames, and local paths are not attached. Do not include passwords or sensitive project details.</p>
            <label>Type
              <select value={category} onChange={(event) => setCategory(event.target.value as FeedbackCategory)}>
                <option value="bug">Bug report</option><option value="suggestion">Suggestion</option><option value="usability">Usability</option>
              </select>
            </label>
            <label>Subject
              <input autoFocus required maxLength={120} value={subject} onChange={(event) => setSubject(event.target.value)} />
            </label>
            <label>Details
              <textarea required maxLength={5000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="What happened, or what would you like to see?" />
            </label>
            <label>Steps to reproduce (optional)
              <textarea maxLength={5000} rows={3} value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="For a bug, list the steps that led to it." />
            </label>
            {error && <p className="danger" role="alert">{error}</p>}
            {status && <p className="feedback-success" role="status">{status}</p>}
            <div className="row">
              <button type="submit" className="primary" disabled={busy}>{busy ? 'Sending…' : 'Send feedback'}</button>
              <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
