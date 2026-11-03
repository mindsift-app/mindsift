import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { AvatarStack } from '../AvatarStack';

const people = ['Anna', 'Ben', 'Carla', 'Dana', 'Emil'].map((name, i) => ({ id: `u${i}`, name }));

describe('AvatarStack (who a list or note is shared with)', () => {
  it('shows at most three people and the rest as +n', () => {
    const { container } = render(<AvatarStack people={people} />);
    expect(container.textContent).toContain('+2');
    expect(container.firstElementChild?.children.length).toBe(4); // 3 avatars + overflow circle
  });

  it('renders nothing for an unshared item', () => {
    expect(render(<AvatarStack people={[]} />).container.firstChild).toBeNull();
  });

  it('needs no overflow circle when everyone fits', () => {
    const { container } = render(<AvatarStack people={people.slice(0, 2)} />);
    expect(container.textContent).not.toContain('+');
  });
});
