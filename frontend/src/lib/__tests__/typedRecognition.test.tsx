import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { setTypedRecognition, typedRecognitionOn } from '../typedRecognition';
import { useNaturalDate } from '../../components/NaturalDateHint';
import { useItemQuantity } from '../../features/lists/QuantityHint';
import i18n from '../../i18n';

// "Datum und Menge beim Tippen erkennen": switched off, the capture fields show no date chip and the list
// field takes no quantity from the text; switched on again, both come back without a reload.
describe('typed recognition switch', () => {
  afterEach(() => setTypedRecognition(true));

  it('is on until the account says otherwise', () => {
    setTypedRecognition(undefined);
    expect(typedRecognitionOn()).toBe(true);
    setTypedRecognition(false);
    expect(typedRecognitionOn()).toBe(false);
  });

  it('stops and resumes recognising dates and quantities', async () => {
    await act(async () => {
      await i18n.changeLanguage('de');
    });
    const date = renderHook(() => useNaturalDate('Zahnarzt morgen 14 Uhr', true));
    const qty = renderHook(() => useItemQuantity('2x Milch', true));
    expect(date.result.current.parsed).not.toBeNull();
    expect(qty.result.current.parsed?.quantity).toBe('2x');

    act(() => setTypedRecognition(false));
    expect(date.result.current.parsed).toBeNull();
    expect(qty.result.current.parsed).toBeNull();

    act(() => setTypedRecognition(true));
    expect(date.result.current.parsed).not.toBeNull();
    expect(qty.result.current.parsed).not.toBeNull();
  });
});
