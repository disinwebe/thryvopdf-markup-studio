import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { filterShareUsers, reviewerDisplayName, UserSelection } from '../src/components/SharedLibrary';

const users = [
  { name: 'Alex Process', email: 'alex@example.com', discipline: 'Process' },
  { name: 'Priya Pipe', email: 'priya@example.com', discipline: 'Piping' },
  { name: 'Owner', email: 'owner@example.com', discipline: 'Instrumentation' },
];

describe('shared document user selection', () => {
  it('shows reviewer names with a fallback for unknown email addresses', () => {
    expect(reviewerDisplayName('PRIYA@example.com', users)).toBe('Priya Pipe');
    expect(reviewerDisplayName('missing@example.com', users)).toBe('missing@example.com');
  });

  it('filters eligible users by discipline and name or email case-insensitively', () => {
    expect(filterShareUsers(users, 'owner@example.com', 'Process', '')).toEqual([users[0]]);
    expect(filterShareUsers(users, 'owner@example.com', '', 'PRIYA@EXAMPLE')).toEqual([users[1]]);
    expect(filterShareUsers(users, 'owner@example.com', '', 'owner')).toEqual([]);
  });

  it('renders the interactive search and discipline filters', () => {
    const markup = renderToStaticMarkup(
      <UserSelection users={users} ownerEmail="owner@example.com" members={[]} onChange={vi.fn()} />,
    );
    expect(markup).toContain('aria-label="Search users by name or email"');
    expect(markup).toContain('aria-label="Filter users by discipline"');
    expect(markup).toContain('<option value="Process">Process</option>');
    expect(markup).toContain('<option value="Piping">Piping</option>');
    expect(markup).not.toContain('owner@example.com');
  });
});
