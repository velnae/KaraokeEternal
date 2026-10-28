export const DEFAULT_ANIMATOR_VOICE_ID = 'sKgg4MPUDBy69X7iv3fA'
export const DEFAULT_ANIMATOR_VOICE_NAME = 'Alejandro Duran'
export const VOICE_SCRIPT_LIMIT = 1000

// Audio tags are descriptive instructions, not a closed provider enum.
export const audioTagPattern = /\[[^[\]\r\n]{1,120}\]/g
export const withoutAudioTags = (text: string) => text.replace(audioTagPattern, '').replace(/\s+/g, ' ').trim()
export const normalizeTaggedText = (text: string) => text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').trim()
export function validAudioTagSyntax (text: string) {
  return !/[[\]]/.test(text.replace(audioTagPattern, ''))
}

// Suggested examples from the official v4 prompting guide; custom tags also work.
export const audioTagSuggestions = [
  { group: 'Emoción', tags: [['excited', 'Entusiasmo'], ['curious', 'Curiosidad'], ['happy', 'Alegría'], ['sad', 'Tristeza'], ['angry', 'Enojo'], ['sarcastic', 'Sarcasmo'], ['mischievously', 'Tono juguetón']] },
  { group: 'Entrega', tags: [['whispers', 'Susurro'], ['shouts', 'Grito'], ['sings', 'Canto'], ['short pause', 'Pausa breve'], ['long pause', 'Pausa larga']] },
  { group: 'Vocalizaciones', tags: [['laughs', 'Risa'], ['chuckles', 'Risa suave'], ['clears throat', 'Carraspeo'], ['sighs', 'Suspiro'], ['exhales', 'Exhalación'], ['snorts', 'Resoplido']] },
  { group: 'Sonidos', tags: [['applause', 'Aplausos'], ['clapping', 'Palmadas']] },
] as const
