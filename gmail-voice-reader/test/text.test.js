import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanEmailText, countVisualLines, needsSummary, splitForSpeech,
  detectLanguage, localSummary, clipForPrompt, parseBullets, hash,
} from '../src/content/text.js';

const LONG_IT = `Buongiorno Denis,

ti scrivo per il preventivo del nuovo impianto per lo stabilimento di Brescia.
Abbiamo bisogno che ci invii la versione aggiornata entro venerdì 3 ottobre, con i prezzi rivisti.
Il cliente ha chiesto anche di includere la manutenzione annuale e la formazione del personale.
Inoltre la riunione con l'ufficio tecnico è confermata per martedì alle 10:30 in sede.
Potresti confermarmi se riesci a partecipare?
Ti allego il capitolato con le modifiche richieste dal cliente.

Cordiali saluti,
Marco Bianchi

Il giorno lun 29 set 2025 alle 09:12 Denis <denis@example.com> ha scritto:
> testo vecchio citato che non deve essere letto`;

test('cleanEmailText drops quoted history, quote markers and URLs', () => {
  const t = cleanEmailText(LONG_IT + '\nhttps://example.com/x');
  assert.ok(!t.includes('testo vecchio'));
  assert.ok(!t.includes('ha scritto'));
  assert.ok(t.includes('Marco Bianchi'));
  assert.ok(!cleanEmailText('Ciao\nvedi https://a.it/b?c=1 grazie').includes('https'));
});

test('cleanEmailText drops mobile footers and disclaimers', () => {
  const t = cleanEmailText('Va bene per me.\n\nInviato da iPhone\naltro');
  assert.equal(t, 'Va bene per me.');
  const d = cleanEmailText('Ok.\nQuesto messaggio è riservato e destinato solo al destinatario');
  assert.equal(d, 'Ok.');
});

test('short emails are not summarized, long ones are', () => {
  assert.equal(needsSummary(cleanEmailText('Ciao,\nva bene giovedì.\nGrazie\nMarco')), false);
  assert.equal(needsSummary(cleanEmailText(LONG_IT)), true);
  assert.equal(countVisualLines('a'.repeat(270)), 3); // wrapped paragraph counts as 3 lines
});

test('splitForSpeech keeps chunks short and loses no words', () => {
  const long = 'Parola '.repeat(120).trim() + '.';
  const chunks = splitForSpeech(`Primo punto. Secondo punto! ${long}`);
  assert.ok(chunks.every((c) => c.length <= 220));
  assert.equal(chunks.join(' ').split(/\s+/).length, `Primo punto. Secondo punto! ${long}`.split(/\s+/).length);
});

test('detectLanguage', () => {
  assert.equal(detectLanguage(cleanEmailText(LONG_IT)), 'it');
  assert.equal(detectLanguage('Hi John, could you please send the invoice by Friday? Thanks and regards'), 'en');
  assert.equal(detectLanguage('Hola, gracias por la información, saludos'), 'es');
  assert.equal(detectLanguage('ok'), 'it');
});

test('localSummary picks 3 informative sentences in original order', () => {
  const pts = localSummary(cleanEmailText(LONG_IT));
  assert.equal(pts.length, 3);
  assert.ok(pts.some((p) => /venerdì/.test(p)));
  assert.ok(!pts.some((p) => /^(Buongiorno|Cordiali)/.test(p)));
});

test('clipForPrompt keeps head and tail', () => {
  const s = 'A'.repeat(10000) + 'B'.repeat(10000);
  const { text, clipped } = clipForPrompt(s, 1000);
  assert.ok(clipped && text.length < 1010 && text.startsWith('A') && text.endsWith('B'));
  assert.deepEqual(clipForPrompt('breve'), { text: 'breve', clipped: false });
});

test('parseBullets tolerates formatting variations', () => {
  assert.deepEqual(parseBullets('- uno\n• due\n\n3) tre\n- quattro'), ['uno', 'due', 'tre']);
});

test('hash is stable', () => {
  assert.equal(hash('abc'), hash('abc'));
  assert.notEqual(hash('abc'), hash('abd'));
});
