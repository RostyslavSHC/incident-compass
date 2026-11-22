import {pitchFallback} from './pitch-qa.mjs';

const pitchRecognitionPause = 1_900;
const pitchRecognitionLimit = 55_000;
const pitchMicErrors = {
  'not-allowed': 'Microphone access was denied. Allow it in your browser or type the question.',
  'service-not-allowed': 'Speech recognition is blocked in this browser. You can type the question.',
  'audio-capture': 'No microphone is available. Check the input device or type the question.',
  'network': 'The speech recognition service could not connect. Try again or type the question.',
  'no-speech': 'No speech was heard. Try again closer to the microphone, or type the question.',
};

function pitchVoiceScore(voice) {
  const lang = voice.lang.toLowerCase();
  return (/\b(?:premium|enhanced|natural|neural)\b/i.test(voice.name) ? 100 : 0)
    + (/^(?:Samantha|Daniel|Ava|Allison|Susan|Google US English)\b/i.test(voice.name) ? 20 : 0)
    + (lang === 'en-ca' ? 4 : lang === 'en-us' ? 3 : 0)
    + (voice.localService ? 2 : 0) + (voice.default ? 1 : 0);
}

export function setupPitchVoice(dialog, shouldRequestAnswer, hasNeuralVoice) {
  const form = dialog.querySelector('#pitch-form');
  const question = dialog.querySelector('#pitch-question');
  const submit = form.querySelector('button[type="submit"]');
  const listen = dialog.querySelector('#pitch-listen');
  const status = dialog.querySelector('#pitch-status');
  const answer = dialog.querySelector('#pitch-answer');
  const mode = dialog.querySelector('#pitch-mode');
  const autoSpeak = dialog.querySelector('#pitch-auto-speak');
  const voicePicker = dialog.querySelector('#pitch-voice');
  const play = dialog.querySelector('#pitch-play');
  const examples = [...dialog.querySelectorAll('[data-pitch-example]')];
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speaker = window.speechSynthesis;
  const canSpeak = Boolean(speaker && window.SpeechSynthesisUtterance);
  const history = [];
  let recognition;
  let request;
  let playback;
  let reply = '';
  let browserVoices = [];
  let cachedAudio;

  function refreshVoices() {
    browserVoices = (speaker?.getVoices?.() || [])
      .filter(voice => /^en(?:[-_]|$)/i.test(voice.lang))
      .sort((a, b) => pitchVoiceScore(b) - pitchVoiceScore(a));
    const selected = voicePicker.value;
    const defaultName = hasNeuralVoice() ? 'Aurelis (natural)' : 'Automatic';
    voicePicker.replaceChildren(new Option(defaultName, ''),
      ...browserVoices.map(voice => new Option(voice.name, voice.voiceURI)));
    if (browserVoices.some(voice => voice.voiceURI === selected)) voicePicker.value = selected;
    voicePicker.disabled = browserVoices.length === 0;
    autoSpeak.disabled = !canSpeak && !hasNeuralVoice();
    updateControls();
  }

  function updateControls() {
    submit.disabled = Boolean(request || recognition);
    for (const example of examples) example.disabled = submit.disabled;
    question.readOnly = Boolean(recognition);
    listen.disabled = Boolean(request);
    listen.textContent = recognition ? 'Finish listening' : 'Listen';
    play.disabled = autoSpeak.disabled || !reply || Boolean(request || recognition);
    play.textContent = playback ? 'Stop voice' : 'Replay voice';
  }

  function clearHighlight() {
    window.CSS?.highlights?.delete('pitch-spoken');
  }

  function finishPlayback(current, message = '') {
    if (playback !== current) return;
    playback = null;
    current.request.abort();
    current.dispose?.();
    clearHighlight();
    updateControls();
    if (dialog.open) status.textContent = message;
  }

  function stopVoice(message) {
    if (playback) finishPlayback(playback, message);
  }

  function speakInBrowser(current, from = 0) {
    const unavailable = 'Voice playback is unavailable. The answer is shown below.';
    if (!canSpeak) return finishPlayback(current, unavailable);
    const speech = new SpeechSynthesisUtterance(reply.slice(from));
    const voice = browserVoices.find(option => option.voiceURI === voicePicker.value) ?? browserVoices[0];
    if (voice) speech.voice = voice;
    speech.lang = voice?.lang || 'en-CA';
    speech.rate = 0.94;
    current.dispose = () => {
      speech.onend = speech.onerror = null;
      if (speaker.speaking || speaker.pending) speaker.cancel();
    };
    speech.onstart = () => {
      if (playback === current && dialog.open) status.textContent = 'Speaking…';
    };
    speech.onboundary = event => {
      if (playback !== current || (event.name && event.name !== 'word') ||
          !window.CSS?.highlights || !window.Highlight) return;
      const start = from + event.charIndex;
      const length = event.charLength || reply.slice(start).match(/^\S+/u)?.[0].length || 0;
      if (!Number.isInteger(start) || start < 0 || start >= reply.length || !length) return;
      const range = document.createRange();
      range.setStart(answer.firstChild, start);
      range.setEnd(answer.firstChild, Math.min(start + length, reply.length));
      window.CSS.highlights.set('pitch-spoken', new Highlight(range));
    };
    speech.onend = () => finishPlayback(current);
    speech.onerror = () => finishPlayback(current, unavailable);
    try { speaker.speak(speech); }
    catch { finishPlayback(current, unavailable); }
  }

  async function fetchClip(current, text, clips) {
    if (clips.has(text)) return clips.get(text);
    try {
      const response = await fetch('/api/pitch-audio', {
        method: 'POST',
        signal: AbortSignal.any([current.request.signal, AbortSignal.timeout(8_000)]),
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text}),
      });
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('audio/')) return null;
      const clip = await response.blob();
      clips.set(text, clip);
      return clip;
    } catch { return null; }
  }

  function playClip(current, clip, prepareNext) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(clip);
      const audio = new Audio(url);
      let ended = false;
      function release(completed) {
        if (ended) return;
        ended = true;
        audio.onended = audio.onerror = null;
        audio.pause();
        URL.revokeObjectURL(url);
        current.dispose = undefined;
        resolve(completed);
      }
      current.dispose = () => release(false);
      audio.onended = () => release(true);
      audio.onerror = () => release(false);
      Promise.resolve().then(() => audio.play()).then(() => {
        if (!ended && playback === current && dialog.open) {
          status.textContent = 'Speaking…';
          prepareNext();
        }
      }, () => release(false));
    });
  }

  async function speak() {
    if (autoSpeak.disabled || !reply || playback || recognition || request || !dialog.open) return;
    const current = {request: new AbortController()};
    playback = current;
    updateControls();
    if (voicePicker.value || !hasNeuralVoice()) return speakInBrowser(current);
    const chunks = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter('en', {granularity: 'sentence'}).segment(reply)]
      : [{segment: reply, index: 0}];
    if (cachedAudio?.text !== reply) cachedAudio = {text: reply, clips: new Map()};
    const clips = cachedAudio.clips;
    let next = fetchClip(current, chunks[0].segment.trim(), clips);
    for (const [index, chunk] of chunks.entries()) {
      status.textContent = 'Preparing voice…';
      const clip = await next;
      if (playback !== current || !dialog.open) return;
      const prepareNext = () => {
        if (chunks[index + 1]) next = fetchClip(current, chunks[index + 1].segment.trim(), clips);
      };
      const completed = clip && await playClip(current, clip, prepareNext);
      if (playback !== current || !dialog.open) return;
      if (!completed) return speakInBrowser(current, chunk.index);
    }
    finishPlayback(current);
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
    if (autoSpeak.checked) void speak();
  }

  listen.addEventListener('click', () => {
    if (recognition) {
      recognition.finish();
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
    let transcript = '';
    let failed = false;
    let finishing = false;
    let speechActive = false;
    let pause;
    let limit;
    function clearTimers() {
      clearTimeout(pause);
      clearTimeout(limit);
    }
    const session = {
      finish() {
        if (recognition !== session || finishing) return;
        finishing = true;
        clearTimers();
        status.textContent = 'Finishing transcription…';
        current.stop();
      },
      cancel() {
        clearTimers();
        current.abort();
      },
    };
    function waitForPause() {
      clearTimeout(pause);
      if (!finishing && transcript) {
        pause = setTimeout(session.finish, speechActive ? pitchRecognitionPause * 2 : pitchRecognitionPause);
      }
    }
    recognition = session;
    current.lang = 'en-CA';
    current.continuous = true;
    current.interimResults = true;
    status.textContent = 'Starting microphone…';
    updateControls();
    current.onstart = () => {
      if (recognition === session && !finishing && dialog.open) {
        status.textContent = 'Listening… Ask your question in English, then pause.';
      }
    };
    current.onspeechstart = () => {
      speechActive = true;
      clearTimeout(pause);
    };
    current.onspeechend = () => {
      speechActive = false;
      if (recognition === session) waitForPause();
    };
    current.onresult = event => {
      if (recognition !== session || !dialog.open || failed) return;
      const results = Array.from(event.results);
      transcript = results.map(result => result[0].transcript.trim()).filter(Boolean).join(' ');
      question.value = transcript.slice(0, question.maxLength);
      final = results.filter(result => result.isFinal).map(result => result[0].transcript.trim()).filter(Boolean).join(' ');
      waitForPause();
    };
    current.onerror = event => {
      if (recognition !== session || !dialog.open) return;
      failed = true;
      clearTimers();
      status.textContent = pitchMicErrors[event.error] || 'Could not hear the question. Check microphone access or type it instead.';
    };
    current.onend = () => {
      if (recognition !== session) return;
      clearTimers();
      recognition = null;
      updateControls();
      if (!dialog.open || failed) return;
      if (final && transcript === final) void ask(final);
      else if (transcript) status.textContent = 'Check the captured words, then select Ask or try again.';
      else status.textContent = 'No complete question heard. Try again or edit the text.';
    };
    try {
      current.start();
      limit = setTimeout(session.finish, pitchRecognitionLimit);
    }
    catch {
      recognition = null;
      clearTimers();
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
    if (playback) stopVoice('Voice stopped.');
    else void speak();
  });
  voicePicker.addEventListener('change', () => stopVoice('Voice changed. Select Replay voice to hear it.'));
  autoSpeak.addEventListener('change', () => {
    if (!autoSpeak.checked) stopVoice('Voice stopped.');
  });
  dialog.addEventListener('close', () => {
    const pending = request;
    request = null;
    pending?.abort();
    const listening = recognition;
    recognition = null;
    listening?.cancel();
    stopVoice();
    updateControls();
    status.textContent = '';
    answer.removeAttribute('aria-busy');
  });
  speaker?.addEventListener?.('voiceschanged', refreshVoices);
  refreshVoices();
  return refreshVoices;
}
