import { api } from '../../lib/api';
import { Thought } from '../../lib/types';

/**
 * Text dictated by holding a + (the phone's floating button and the desktop rail) goes into the inbox as
 * it was spoken: source "voice", so the server tags it #diktat, normal priority, no due date.
 */
export function captureDictation(text: string): Promise<Thought> {
  return api.captureThought(text, 'normal', 'voice', '', { target: 'inbox' });
}
