import {pitchFallback} from './pitch-qa.mjs';

export function setupPitchVoice(dialog, shouldRequestAnswer) {
  const form = dialog.querySelector('#pitch-form');
  const question = dialog.querySelector('#pitch-question');
  const submit = form.querySelector('button[type="submit"]');
  const listen = dialog.querySelector('#pitch-listen');
  const status = dialog.querySelector('#pitch-status');
  const answer = dialog.querySelector('#pitch-answer');
  const mode = dialog.querySelector('#pitch-mode');
  const autoSpeak = dialog.querySelector('#pitch-auto-speak');
  const play = dialog.querySelector('#pitch-play');
  const examples = [...dialog.querySelectorAll('[data-pitch-example]')];
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speaker = window.speechSynthesis;
  const canSpeak = Boolean(speaker && window.SpeechSynthesisUtterance);
  const history = [];
  let recognition;
  let request;
  let utterance;
  let reply = '';

  if (!canSpeak) {
    autoSpeak.checked = false;
    autoSpeak.disabled = true;
  }

  function updateControls() {
    submit.disabled = Boolean(request || recognition);
    for (const example of examples) example.disabled = submit.disabled;
    question.readOnly = Boolean(recognition);
    listen.disabled = Boolean(request);
    listen.textContent = recognition ? 'Finish listening' : 'Listen';
    play.disabled = !canSpeak || !reply || Boolean(request || recognition);
    play.textContent = utterance ? 'Stop voice' : 'Replay voice';
  }

  function clearHighlight() {
    window.CSS?.highlights?.delete('pitch-spoken');
  }

  function stopVoice() {
    if (!utterance) return;
    utterance = null;
    speaker.cancel();
    clearHighlight();
    updateControls();
  }

  function speak() {
    if (!canSpeak || !reply || utterance || recognition || request) return;
    const current = new SpeechSynthesisUtterance(reply);
    current.lang = 'en-CA';
    current.rate = 0.94;
    utterance = current;
    updateControls();
    current.onstart = () => {
      if (utterance === current && dialog.open) status.textContent = 'Speaking…';
    };
    current.onboundary = event => {
      if (utterance !== current || (event.name && event.name !== 'word') ||
          !window.CSS?.highlights || !window.Highlight) return;
      const start = event.charIndex;
      const length = event.charLength || reply.slice(start).match(/^\S+/u)?.[0].length || 0;
      if (!Number.isInteger(start) || start < 0 || start >= reply.length || !length) return;
      const range = document.createRange();
      range.setStart(answer.firstChild, start);
      range.setEnd(answer.firstChild, Math.min(start + length, reply.length));
      window.CSS.highlights.set('pitch-spoken', new Highlight(range));
    };
    function finish(message) {
      if (utterance !== current) return;
      utterance = null;
      clearHighlight();
      updateControls();
      if (dialog.open) status.textContent = message;
    }
    current.onend = () => finish('');
    current.onerror = () => finish('Voice playback is unavailable. The answer is shown below.');
    try { speaker.speak(current); }
    catch { finish('Voice playback is unavailable. The answer is shown below.'); }
  }

  async function ask(text) {
    text = text.trim().slice(0, question.maxLength);
    if (!text || !dialog.open || request || recognition) return;
    stopVoice();
    const pending = new AbortController();
    request = pending;
    question.value = text;
    status.textContent = 'Preparing an answer…';
    answer.setAttribute('aria-busy', 'true');
    updateControls();
    let nextReply;
    let answerMode = 'Demo answers';
    if (shouldRequestAnswer()) {
      const timer = setTimeout(() => pending.abort(), 8_000);
      try {
        const response = await fetch('/api/pitch-qa', {
          method: 'POST',
          signal: pending.signal,
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({question: text, history}),
        });
        if (response.ok) {
          const data = await response.json();
          if (typeof data.answer === 'string') nextReply = data.answer.trim();
          if (nextReply && data.mode === 'gemini') answerMode = 'Gemini';
        }
      } catch { /* Fall back to the bundled Q&A if the request fails. */ }
      finally { clearTimeout(timer); }
    }
    if (request !== pending || !dialog.open) return;
    request = null;
    reply = nextReply || pitchFallback(text, history);
    history.push({question: text, answer: reply});
    if (history.length > 3) history.shift();
    answer.textContent = reply;
    answer.removeAttribute('aria-busy');
    mode.textContent = answerMode;
    mode.hidden = false;
    status.textContent = '';
    updateControls();
    if (autoSpeak.checked) speak();
  }

  listen.addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    if (!Recognition) {
      status.textContent = 'Voice input is unavailable in this browser. You can type your question.';
      question.focus();
      return;
    }
    stopVoice();
    const current = new Recognition();
    let final = '';
    let failed = false;
    recognition = current;
    current.lang = 'en-CA';
    current.interimResults = true;
    status.textContent = 'Listening… Ask your question in English.';
    updateControls();
    current.onresult = event => {
      if (recognition !== current || !dialog.open) return;
      const results = Array.from(event.results);
      question.value = results.map(result => result[0].transcript).join(' ').trim().slice(0, question.maxLength);
      final = results.filter(result => result.isFinal).map(result => result[0].transcript).join(' ').trim();
    };
    current.onerror = () => {
      if (recognition !== current || !dialog.open) return;
      failed = true;
      status.textContent = 'Could not hear the question. Check microphone access or type it instead.';
    };
    current.onend = () => {
      if (recognition !== current) return;
      recognition = null;
      updateControls();
      if (!dialog.open || failed) return;
      if (final) void ask(final);
      else status.textContent = 'No complete question heard. Try again or edit the text.';
    };
    try { current.start(); }
    catch {
      recognition = null;
      updateControls();
      status.textContent = 'Could not start the microphone. You can type your question.';
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    void ask(question.value);
  });
  for (const example of examples) {
    example.addEventListener('click', () => void ask(example.textContent));
  }
  play.addEventListener('click', () => {
    if (!utterance) speak();
    else {
      stopVoice();
      status.textContent = 'Voice stopped.';
    }
  });
  autoSpeak.addEventListener('change', () => {
    if (!autoSpeak.checked && utterance) play.click();
  });
  dialog.addEventListener('close', () => {
    const pending = request;
    request = null;
    pending?.abort();
    const listening = recognition;
    recognition = null;
    listening?.abort();
    stopVoice();
    updateControls();
    status.textContent = '';
    answer.removeAttribute('aria-busy');
  });
}
