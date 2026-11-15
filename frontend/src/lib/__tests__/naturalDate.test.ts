import { describe, it, expect } from 'vitest';
import { foldText, parseNaturalDate, phraseOf } from '../naturalDate';

// Wednesday 18.11.2026, 10:00 local
const now = new Date(2026, 10, 18, 10, 0);

type Row = [input: string, due: string | null, title?: string];

function check(lang: string, rows: Row[], at: Date = now) {
  for (const [input, due, title] of rows) {
    const parsed = parseNaturalDate(input, lang, at);
    if (due === null) {
      expect(parsed, input).toBeNull();
      continue;
    }
    expect(parsed?.due, input).toBe(due);
    if (title !== undefined) expect(parsed?.title, input).toBe(title);
  }
}

describe('natural dates: German', () => {
  it('reads relative days', () => {
    check('de', [
      ['Zahnarzt heute', '2026-11-18', 'Zahnarzt'],
      ['Zahnarzt morgen', '2026-11-19', 'Zahnarzt'],
      ['Zahnarzt übermorgen', '2026-11-20', 'Zahnarzt'],
      ['Zahnarzt Übermorgen', '2026-11-20', 'Zahnarzt'],
      ['MORGEN Zahnarzt', '2026-11-19', 'Zahnarzt'],
      ['Kuchen für morgen backen', '2026-11-19', 'Kuchen backen'],
      ['Bericht bis morgen', '2026-11-19', 'Bericht'],
    ]);
  });

  it('does not read words that only contain a date word', () => {
    check('de', [
      ['Morgenroutine aufschreiben', null],
      ['Heutemorgen', null],
      ['Guten Morgen sagen', null],
      ['am Morgen joggen', null],
      ['heute Morgen joggen', '2026-11-18', 'Morgen joggen'],
      ['Freitags Sport', null],
      ['Mai anrufen', null],
      ['Mai am 3. Mai anrufen', '2027-05-03', 'Mai anrufen'],
    ]);
  });

  it('reads weekdays as the next one, today a week later', () => {
    check('de', [
      ['Bericht Freitag', '2026-11-20', 'Bericht'],
      ['Bericht am Freitag', '2026-11-20', 'Bericht'],
      ['Bericht nächsten Dienstag', '2026-11-24', 'Bericht'],
      ['Bericht am kommenden Montag', '2026-11-23', 'Bericht'],
      ['Bericht Mittwoch', '2026-11-25', 'Bericht'],
      ['Einkauf Samstag', '2026-11-21'],
      ['Einkauf Sonnabend', '2026-11-21'],
      ['Einkauf Sonntag', '2026-11-22'],
    ]);
  });

  it('reads "in n days/weeks/months"', () => {
    check('de', [
      ['Reifen in 3 Tagen', '2026-11-21', 'Reifen'],
      ['Reifen in einer Woche', '2026-11-25', 'Reifen'],
      ['Reifen in zwei Wochen', '2026-12-02', 'Reifen'],
      ['Reifen in 1 Tag', '2026-11-19'],
      ['Reifen in einem Monat', '2026-12-18'],
      ['in Berlin anrufen', null],
    ]);
    // Over the end of a month and a year
    check('de', [['Reifen in 3 Tagen', '2026-12-01']], new Date(2026, 10, 28, 9));
    check('de', [['Reifen in 5 Tagen', '2027-01-02']], new Date(2026, 11, 28, 9));
    // 31 January + one month is the last day of February
    check('de', [['Miete in einem Monat', '2026-02-28']], new Date(2026, 0, 31, 9));
  });

  it('reads written dates', () => {
    check('de', [
      ['Geschenke 24.12.', '2026-12-24', 'Geschenke'],
      ['Geschenke am 24.12.', '2026-12-24', 'Geschenke'],
      ['Geschenke bis zum 24.12.', '2026-12-24', 'Geschenke'],
      ['Geschenke 24.12.2027', '2027-12-24', 'Geschenke'],
      ['Geschenke 24.12.27', '2027-12-24'],
      ['Geschenke 24. Dezember', '2026-12-24', 'Geschenke'],
      ['Geschenke 24. Dez.', '2026-12-24'],
      ['Geschenke 24 Dezember 2027', '2027-12-24'],
      ['Steuer 31. März', '2027-03-31'],
      ['Steuer 2027-03-31', '2027-03-31', 'Steuer'],
      // Today counts, an earlier day is next year
      ['Termin 18.11.', '2026-11-18'],
      ['Termin 17.11.', '2027-11-17'],
      // No date: a price, an impossible day, a version number
      ['Kaffee 24.12 €', null],
      ['Termin 31.02.', null],
      ['Version 1.2.3 testen', null],
      ['Termin 30.2.2027', null],
    ]);
    // "24.12." in late December is next year's
    check('de', [['Geschenke 24.12.', '2027-12-24']], new Date(2026, 11, 28, 9));
    // 29 February: the next year that has one
    check('de', [['Schalttag 29.02.', '2028-02-29']], now);
  });

  it('reads times and joins them with a day', () => {
    check('de', [
      ['Zahnarzt morgen 14 Uhr', '2026-11-19T14:00', 'Zahnarzt'],
      ['Zahnarzt morgen um 14 Uhr', '2026-11-19T14:00', 'Zahnarzt'],
      ['Zahnarzt morgen um 14:30', '2026-11-19T14:30', 'Zahnarzt'],
      ['Zahnarzt Freitag um 9', '2026-11-20T09:00', 'Zahnarzt'],
      ['Morgen Zahnarzt 14 Uhr', '2026-11-19T14:00', 'Zahnarzt'],
      ['Zahnarzt 14:30 morgen', '2026-11-19T14:30', 'Zahnarzt'],
      ['Zahnarzt am 24.12. um 9.30 Uhr', '2026-12-24T09:30', 'Zahnarzt'],
      ['Zahnarzt 2026-12-24 14:30', '2026-12-24T14:30', 'Zahnarzt'],
      ['Zahnarzt 2026-12-24T08:05', '2026-12-24T08:05', 'Zahnarzt'],
      ['Zahnarzt heute um 0 Uhr', '2026-11-18T00:00'],
    ]);
  });

  it('puts a time alone today while it is ahead, otherwise tomorrow', () => {
    check('de', [
      ['Anrufen um 14 Uhr', '2026-11-18T14:00', 'Anrufen'],
      ['Anrufen um 9', '2026-11-19T09:00', 'Anrufen'],
      ['Anrufen 10:00', '2026-11-19T10:00'],
      ['Anrufen 10:01', '2026-11-18T10:01'],
    ]);
  });

  it('leaves ambiguous things alone', () => {
    check('de', [
      ['3 Eier kaufen', null],
      ['Treffen um', null],
      ['um die Ecke', null],
      ['um 25 Uhr', null],
      ['um 2.5 kg abnehmen', null],
      ['Seite 14', null],
      ['', null],
      ['morgen', null],
      ['am Freitag um 9', null],
    ]);
  });

  it('cleans the title', () => {
    check('de', [
      ['Zahnarzt, morgen 14 Uhr', '2026-11-19T14:00', 'Zahnarzt'],
      ['Zahnarzt morgen 14 Uhr anrufen', '2026-11-19T14:00', 'Zahnarzt anrufen'],
      ['Zahnarzt - morgen', '2026-11-19', 'Zahnarzt'],
      ['Zahnarzt morgen.', '2026-11-19', 'Zahnarzt.'],
    ]);
  });

  it('takes the first date of several', () => {
    check('de', [['Freitag Bericht, Montag Meeting', '2026-11-20', 'Bericht, Montag Meeting']]);
  });

  it('counts days across a change of summer time', () => {
    // Saturday 28.03.2026 23:30, the clocks go forward that night in Europe
    const beforeDst = new Date(2026, 2, 28, 23, 30);
    check('de', [
      ['Uhr stellen morgen', '2026-03-29'],
      ['Uhr stellen in einer Woche', '2026-04-04'],
      ['Uhr stellen Montag 9 Uhr', '2026-03-30T09:00'],
      ['Uhr stellen um 8', '2026-03-29T08:00'],
    ], beforeDst);
    // Saturday 24.10.2026, the clocks go back that night
    check('de', [['Uhr stellen übermorgen', '2026-10-26']], new Date(2026, 9, 24, 22, 0));
  });

  it('names the phrase with its joining words', () => {
    const text = 'Zahnarzt am Freitag um 9 Uhr';
    const parsed = parseNaturalDate(text, 'de', now)!;
    expect(parsed.spans.map((s) => text.slice(s.start, s.end))).toEqual(['am Freitag um 9 Uhr']);
    // Apart: two phrases
    const apart = 'Am Freitag Zahnarzt um 9 Uhr';
    const two = parseNaturalDate(apart, 'de', now)!;
    expect(two.spans.map((s) => apart.slice(s.start, s.end))).toEqual(['Am Freitag', 'um 9 Uhr']);
    expect(two.title).toBe('Zahnarzt');
    expect(phraseOf(apart, two)).toBe('Am Freitag um 9 Uhr');
  });
});

describe('natural dates: English', () => {
  it('reads days, weekdays and relative dates', () => {
    check('en', [
      ['Dentist today', '2026-11-18', 'Dentist'],
      ['Dentist tomorrow', '2026-11-19', 'Dentist'],
      ['Dentist day after tomorrow', '2026-11-20', 'Dentist'],
      ['Dentist the day after tomorrow', '2026-11-20', 'Dentist'],
      ['Report Friday', '2026-11-20', 'Report'],
      ['Report on Friday', '2026-11-20', 'Report'],
      ['Report next Tuesday', '2026-11-24', 'Report'],
      ['Report by Wednesday', '2026-11-25', 'Report'],
      ['Tyres in 3 days', '2026-11-21', 'Tyres'],
      ['Tyres in a week', '2026-11-25', 'Tyres'],
      ['Tyres in two weeks', '2026-12-02'],
      ['Tomorrowland tickets', null],
      ['Fridays gym', null],
    ]);
  });

  it('reads written dates', () => {
    check('en', [
      ['Gifts Dec 24', '2026-12-24', 'Gifts'],
      ['Gifts December 24th', '2026-12-24', 'Gifts'],
      ['Gifts on Dec 24, 2027', '2027-12-24', 'Gifts'],
      ['Gifts 24 December', '2026-12-24', 'Gifts'],
      ['Gifts 24th of December', '2026-12-24'],
      ['Gifts 2026-12-24', '2026-12-24'],
      ['Gifts 24.12.', null],
      ['May visit', null],
      ['Call May on May 3', '2027-05-03', 'Call May'],
    ]);
  });

  it('reads times with am and pm', () => {
    check('en', [
      ['Dentist tomorrow 2pm', '2026-11-19T14:00', 'Dentist'],
      ['Dentist tomorrow at 2:30 pm', '2026-11-19T14:30', 'Dentist'],
      ['Dentist tomorrow at 9', '2026-11-19T09:00', 'Dentist'],
      ['Dentist Friday at 9am', '2026-11-20T09:00', 'Dentist'],
      ['Dentist tomorrow 9 a.m.', '2026-11-19T09:00', 'Dentist'],
      ['Dentist tomorrow 12am', '2026-11-19T00:00'],
      ['Dentist tomorrow 12pm', '2026-11-19T12:00'],
      ['Dentist tomorrow 12:30am', '2026-11-19T00:30'],
      ['Dentist tomorrow 13pm', '2026-11-19', 'Dentist 13pm'],
      ['Call at 3pm', '2026-11-18T15:00', 'Call'],
      ['Call at 8am', '2026-11-19T08:00', 'Call'],
      ['Buy 3 apples', null],
      ['Meet at the station', null],
      ['Run 5am', '2026-11-19T05:00'],
    ]);
  });
});

describe('natural dates: French, Italian, Spanish (basic forms)', () => {
  it('French', () => {
    check('fr', [
      ["Dentiste aujourd'hui", '2026-11-18', 'Dentiste'],
      ['Dentiste aujourd’hui', '2026-11-18', 'Dentiste'],
      ['Dentiste demain 14h', '2026-11-19T14:00', 'Dentiste'],
      ['Dentiste demain à 14h30', '2026-11-19T14:30', 'Dentiste'],
      ['Dentiste après-demain', '2026-11-20', 'Dentiste'],
      ['Rapport vendredi', '2026-11-20', 'Rapport'],
      ['Rapport mardi prochain', '2026-11-24', 'Rapport'],
      ['Pneus dans 3 jours', '2026-11-21', 'Pneus'],
      ['Pneus dans une semaine', '2026-11-25'],
      ['Cadeaux le 24 décembre', '2026-12-24', 'Cadeaux'],
      ['Cadeaux 1er mai', '2027-05-01'],
      ['Cadeaux 24/12/2026', '2026-12-24'],
      ['Cadeaux 24.12.', '2026-12-24'],
      ['Gâteau 1/2', null],
      ['Demandeur', null],
    ]);
  });

  it('Italian', () => {
    check('it', [
      ['Dentista oggi', '2026-11-18', 'Dentista'],
      ['Dentista domani alle 14', '2026-11-19T14:00', 'Dentista'],
      ['Dentista domani alle ore 14:30', '2026-11-19T14:30', 'Dentista'],
      ['Dentista dopodomani', '2026-11-20'],
      ['Rapporto venerdì', '2026-11-20', 'Rapporto'],
      ['Rapporto venerdi', '2026-11-20'],
      ['Rapporto martedì prossimo', '2026-11-24'],
      ['Gomme tra 3 giorni', '2026-11-21', 'Gomme'],
      ['Gomme fra una settimana', '2026-11-25'],
      ['Regali il 24 dicembre', '2026-12-24', 'Regali'],
      ['Regali 24/12/2026', '2026-12-24'],
    ]);
  });

  it('Spanish', () => {
    check('es', [
      ['Dentista hoy', '2026-11-18', 'Dentista'],
      ['Dentista mañana a las 14', '2026-11-19T14:00', 'Dentista'],
      ['Dentista mañana a las 14:30', '2026-11-19T14:30', 'Dentista'],
      ['Dentista pasado mañana', '2026-11-20', 'Dentista'],
      ['Correr por la mañana', null],
      ['Informe el viernes', '2026-11-20', 'Informe'],
      ['Informe el próximo martes', '2026-11-24', 'Informe'],
      ['Informe miércoles', '2026-11-25'],
      ['Neumáticos en 3 días', '2026-11-21', 'Neumáticos'],
      ['Neumáticos en una semana', '2026-11-25'],
      ['Regalos el 24 de diciembre', '2026-12-24', 'Regalos'],
      ['Regalos 24 de diciembre de 2027', '2027-12-24'],
    ]);
  });

  it('reads only the language of the app', () => {
    expect(parseNaturalDate('Zahnarzt morgen', 'en', now)).toBeNull();
    expect(parseNaturalDate('Dentist tomorrow', 'de', now)).toBeNull();
    // ISO and times with a colon work in every language
    expect(parseNaturalDate('Dentist 2026-12-24', 'de', now)?.due).toBe('2026-12-24');
  });
});

describe('foldText', () => {
  it('keeps every position', () => {
    for (const s of ['Übermorgen', 'lunedì', 'mañana', 'aujourd’hui', 'Straße', 'İstanbul', '😀 morgen']) {
      expect(foldText(s).length).toBe(s.length);
    }
    expect(foldText('Übermorgen')).toBe('ubermorgen');
  });
});
