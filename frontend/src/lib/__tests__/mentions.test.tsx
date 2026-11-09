import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { mentionIdOf, mentionQueryAt, mentionRef, readableMentions, rememberMentionNames } from '../mentions';
import { renderInlineMarkdown, renderMentions } from '../markdown';

describe('mentions', () => {
  it('finds the word after @ right before the caret', () => {
    expect(mentionQueryAt('Frag @An', 8)).toEqual({ query: 'An', start: 5 });
    expect(mentionQueryAt('@', 1)).toEqual({ query: '', start: 0 });
    // An e-mail address is no mention
    expect(mentionQueryAt('anna@example', 12)).toBeNull();
    expect(mentionQueryAt('Frag @Anna heute', 16)).toBeNull();
  });

  it('writes and reads the reference', () => {
    expect(mentionRef('usr_1')).toBe('{{mention:usr_1}}');
    expect(mentionIdOf('{{mention:usr_1}}')).toBe('usr_1');
    expect(mentionIdOf('{{secret:abc}}')).toBeNull();
  });

  it('shows the current name in notes, subtasks and plain text', () => {
    rememberMentionNames([{ id: 'usr_anna', displayName: 'Anna Berg' }]);
    expect(readableMentions('Frag {{mention:usr_anna}} morgen')).toBe('Frag @Anna Berg morgen');
    render(<p data-testid="bullet">{renderInlineMarkdown('Frag **bitte** {{mention:usr_anna}}')}</p>);
    expect(screen.getByTestId('bullet').textContent).toBe('Frag bitte @Anna Berg');
    render(<p data-testid="sub">{renderMentions('Regal {{mention:usr_anna}} **nicht fett**')}</p>);
    expect(screen.getByTestId('sub').textContent).toBe('Regal @Anna Berg **nicht fett**');
  });
});
