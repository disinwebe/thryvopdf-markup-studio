import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingRegistrationsNotice, watchPendingRegistrations, type PendingRegistrationState } from '../src/components/PendingRegistrations';

const user = (status: string): ManagedUser => ({ name: 'User', email: 'user@example.com', discipline: 'Civil', status });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => {
  vi.useRealTimers();
});

describe('pending registration polling', () => {
  it('counts pending users immediately and updates on the low-frequency schedule', async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, users: [user('pending'), user('active'), user('pending')] })
      .mockResolvedValueOnce({ ok: true, users: [user('active')] });
    const states: PendingRegistrationState[] = [];
    const stop = watchPendingRegistrations(list, (state) => states.push(state));
    await flush();
    expect(states).toEqual([{ status: 'ready', count: 2 }]);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)).toEqual({ status: 'ready', count: 0 });
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('never overlaps calls and ignores a late result after cleanup', async () => {
    vi.useFakeTimers();
    let resolve!: (value: { ok: boolean; users: ManagedUser[] }) => void;
    const list = vi.fn(() => new Promise<{ ok: boolean; users: ManagedUser[] }>((done) => { resolve = done; }));
    const publish = vi.fn();
    const stop = watchPendingRegistrations(list, publish);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
    resolve({ ok: true, users: [user('pending')] });
    await flush();
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears stale counts on errors, retries, and stops on authentication failure', async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true, users: [user('pending')] })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, error: 'Session expired.', expired: true });
    const states: PendingRegistrationState[] = [];
    const stop = watchPendingRegistrations(list, (state) => states.push(state));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toEqual({ status: 'error', count: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toEqual({ status: 'unauthorized', count: null });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(list).toHaveBeenCalledTimes(3);
    stop();
  });

  it.each(['Not signed in.', 'Administrator access required.'])('stops on %s', async (error) => {
    vi.useFakeTimers();
    const list = vi.fn().mockResolvedValue({ ok: false, error });
    const publish = vi.fn();
    const stop = watchPendingRegistrations(list, publish);
    await flush();
    expect(publish).toHaveBeenCalledWith({ status: 'unauthorized', count: null });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(list).toHaveBeenCalledTimes(1);
    stop();
  });

  it('recovers after a malformed response without displaying server error text', async () => {
    vi.useFakeTimers();
    const list = vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, error: 'private server detail' })
      .mockResolvedValueOnce({ ok: true, users: [user('pending')] });
    const states: PendingRegistrationState[] = [];
    const stop = watchPendingRegistrations(list, (state) => states.push(state));
    await flush();
    expect(states.at(-1)).toEqual({ status: 'error', count: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toEqual({ status: 'error', count: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(states.at(-1)).toEqual({ status: 'ready', count: 1 });
    expect(JSON.stringify(states)).not.toContain('private server detail');
    stop();
  });
});

describe('pending registration notice', () => {
  it('shows an accessible, non-modal badge and hides empty or loading states', () => {
    const notice = (state: PendingRegistrationState | null) => renderToStaticMarkup(<PendingRegistrationsNotice state={state} onManageUsers={() => {}} />);
    expect(notice(null)).toBe('');
    expect(notice({ status: 'loading', count: null })).toBe('');
    expect(notice({ status: 'ready', count: 0 })).toBe('');
    const html = notice({ status: 'ready', count: 2 });
    expect(html).toContain('role="status"');
    expect(html).toContain('2 pending registrations. Open user management');
    expect(html).toContain('class="badge">2');
    expect(html).not.toContain('dialog');
    expect(notice({ status: 'error', count: null })).toContain('Retrying shortly');
    expect(notice({ status: 'unauthorized', count: null })).toContain('sign in again');
  });
});
