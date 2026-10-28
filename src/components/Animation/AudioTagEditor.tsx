import React, { useRef } from 'react'
import Button from 'components/Button/Button'
import { audioTagPattern, audioTagSuggestions, VOICE_SCRIPT_LIMIT } from 'shared/audioTags'
import styles from './AudioTagEditor.css'

export default function AudioTagEditor ({ value, onChange }: { value: string, onChange: (value: string) => void }) {
  const input = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
  const parts: React.ReactNode[] = []
  let offset = 0
  for (const match of value.matchAll(audioTagPattern)) {
    parts.push(value.slice(offset, match.index))
    parts.push(<mark key={match.index}>{match[0]}</mark>)
    offset = match.index! + match[0].length
  }
  parts.push(value.slice(offset), '\u200b')
  const insert = (tag: string) => {
    const element = input.current
    if (!element) return
    const start = element.selectionStart
    const end = element.selectionEnd
    const addition = `[${tag}] `
    const next = value.slice(0, start) + addition + value.slice(end)
    if (next.length > VOICE_SCRIPT_LIMIT) return
    onChange(next)
    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + addition.length, start + addition.length)
    })
  }
  return (
    <div>
      <label htmlFor='voice-script'>Texto del audio</label>
      <div className={styles.editor}>
        <div ref={mirror} className={styles.mirror} aria-hidden='true'>{parts}</div>
        <textarea
          ref={input}
          id='voice-script'
          className={styles.input}
          aria-label='Texto del audio'
          rows={5}
          maxLength={VOICE_SCRIPT_LIMIT}
          value={value}
          spellCheck={false}
          onChange={event => onChange(event.target.value)}
          onScroll={(event) => {
            if (mirror.current) {
              mirror.current.scrollTop = event.currentTarget.scrollTop
              mirror.current.scrollLeft = event.currentTarget.scrollLeft
            }
          }}
        />
      </div>
      <details className={styles.suggestions}>
        <summary>Etiquetas de voz</summary>
        {audioTagSuggestions.map(group => (
          <div key={group.group}>
            <h4>{group.group}</h4>
            <div className={styles.tags}>{group.tags.map(([tag, label]) => <Button key={tag} title={`${label}: [${tag}]`} aria-label={`Insertar [${tag}]`} onMouseDown={event => event.preventDefault()} onClick={() => insert(tag)}><code>{`[${tag}]`}</code></Button>)}</div>
          </div>
        ))}
        <p>También puede escribir otras instrucciones entre corchetes.</p>
      </details>
    </div>
  )
}
