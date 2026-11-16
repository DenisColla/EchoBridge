// Voice dictation via the Web Speech API. Resolves with the final transcript
// when the user stops or after a pause of `silenceMs`.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const dictationSupported = !!Recognition;

export function dictate({ lang = 'it-IT', silenceMs = 3000, onInterim = () => {} } = {}) {
  if (!Recognition) return { promise: Promise.reject(new Error('Dettatura non supportata da questo browser')), stop() {} };

  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  let finalText = '';
  let silenceTimer;
  const armSilence = () => {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => rec.stop(), silenceMs);
  };

  const promise = new Promise((resolve, reject) => {
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += `${r[0].transcript} `;
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
      armSilence();
    };
    rec.onerror = (e) => {
      clearTimeout(silenceTimer);
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      reject(new Error(e.error === 'not-allowed' ? 'Microfono non autorizzato' : `Errore dettatura: ${e.error}`));
    };
    rec.onend = () => {
      clearTimeout(silenceTimer);
      resolve(finalText.trim());
    };
  });

  rec.start();
  armSilence();
  return { promise, stop: () => rec.stop() };
}
