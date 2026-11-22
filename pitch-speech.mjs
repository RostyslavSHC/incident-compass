import {pathToFileURL} from 'node:url';
import {pitchAnswerLimit} from './public/pitch-qa.mjs';

const modelId = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const bodyLimit = 4096;

export function createPitchSpeech({enabled, modulePath, localOrigin, json}) {
  const localHost = new URL(localOrigin).host;
  let available = enabled;
  let engine;
  let busy = false;

  async function warm() {
    if (!available) return;
    try {
      const {KokoroTTS} = await import(modulePath ? pathToFileURL(modulePath).href : 'kokoro-js');
      const model = await KokoroTTS.from_pretrained(modelId, {dtype:'q8', device:'cpu'});
      await model.generate('Aurelis is ready for your questions.', {voice:'af_heart'});
      engine = model;
    } catch {
      available = false;
      engine = undefined;
      console.warn('Local neural voice is unavailable. Pitch Q&A can use browser speech.');
    }
  }

  async function handle(request, response) {
    if (request.headers.host!==localHost || request.headers.origin!==localOrigin ||
        request.headers['content-type']?.split(';',1)[0].trim()!=='application/json') {
      return json(response,403,{error:'Use the local pitch dashboard.'});
    }
    if (!engine || busy) return json(response,503,{error:'Local neural voice is unavailable.'});
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({destroyOnReturn:false})) {
      size += chunk.length;
      if (size > bodyLimit) {
        request.resume();
        return json(response,413,{error:'The voice request is too long.'});
      }
      chunks.push(chunk);
    }
    let text;
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof input?.text === 'string') text = input.text.trim();
    } catch { /* The request still needs a valid text field. */ }
    if (!text || text.length > pitchAnswerLimit) return json(response,400,{error:'Enter valid text to speak.'});
    if (busy) return json(response,503,{error:'Local neural voice is busy.'});
    busy = true;
    try {
      const audio = await engine.generate(text,{voice:'af_heart',speed:0.98});
      if (response.destroyed) return;
      const wav = Buffer.from(audio.toWav());
      response.writeHead(200,{
        'Content-Type':'audio/wav','Content-Length':wav.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      });
      response.end(wav);
    } catch {
      if (!response.destroyed) json(response,503,{error:'Local neural voice could not speak this answer.'});
    } finally {
      busy = false;
    }
  }

  return {warm,handle,available:()=>available};
}
