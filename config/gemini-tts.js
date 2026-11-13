import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { createGemini } from '../server/AudioProviders/index.ts'
import { geminiConfig } from '../server/AudioProviders/config.ts'

// Gemini 3.8 uses structured delivery instructions and returns complete WAV audio.
// https://ai.google.dev/gemini-api/docs/generate-content/speech-generation
const model = 'gemini-3.8-flash-lite-tts'
const defaultText = '¡Hola! ... ¡Bienvenidos al karaoke! Esta noche, ¡llamas y ñustas nos acompañan! ¿Qué te parece?'
const defaultStyle = [
  'Speak in Latin American Spanish with a neutral Peruvian accent.',
  'Sound like a warm, smiling karaoke host: cheerful and welcoming, without shouting.',
  'Use a natural medium pace and a brief pause after the opening greeting.',
  'Pronounce the Spanish words "llamas" and "ñustas" clearly. Solo voice, no music or sound effects.',
].join(' ')
const defaultOutput = fileURLToPath(new URL('../build/voice-tests/gemini-welcome.wav', import.meta.url))

export async function main (args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      text: { type: 'string', default: defaultText },
      voice: { type: 'string', default: 'Puck' },
      style: { type: 'string', default: defaultStyle },
      output: { type: 'string', default: defaultOutput },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`Generate a Latin American Spanish karaoke greeting with ${model}.

Usage: node --import tsx --env-file-if-exists=.env config/gemini-tts.js [options]

Set KES_GEMINI_API_KEY (or GEMINI_API_KEY / GOOGLE_API_KEY) in your environment or .env.

Options:
  --text <text>     Transcript to speak (defaults to the karaoke welcome)
  --voice <name>    Prebuilt Gemini voice (default: Puck)
  --style <text>    Delivery and accent instructions, separate from the transcript
  --output <path>  WAV destination (default: build/voice-tests/gemini-welcome.wav)
  -h, --help       Show this help without calling the API`)
    return
  }

  const config = geminiConfig()
  const apiKey = config.key || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in your environment or .env, then run with --env-file-if-exists=.env.')
  if (!values.text.trim()) throw new Error('--text must not be empty.')

  console.log(`Model: ${model} | Voice: ${values.voice}`)
  console.log(`Text: ${values.text}`)
  const started = performance.now()
  const provider = createGemini({ ...config, key: apiKey }, fetch, 120_000)
  const audio = await provider.generate(values.text, { model, voice: values.voice, style: values.style }, new AbortController().signal)
  const output = resolve(values.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, audio)
  console.log(`Saved: ${output} (${audio.length} bytes; request took ${((performance.now() - started) / 1000).toFixed(1)}s)`)
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`TTS failed: ${error.message}`)
    process.exitCode = 1
  })
}
