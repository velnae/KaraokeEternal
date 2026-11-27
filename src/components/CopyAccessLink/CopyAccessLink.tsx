import React, { useState } from 'react'
import Button from 'components/Button/Button'

export default function CopyAccessLink ({ url, label = 'Copiar enlace', name, className }: { url: string, label?: string, name: string, className?: string }) {
  const [result, setResult] = useState<'copied' | 'manual' | null>(null)

  return (
    <>
      <Button
        className={className}
        aria-label={`${label}: ${name}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url)
            setResult('copied')
          } catch {
            setResult('manual')
          }
        }}
      >
        {label}
      </Button>
      {result === 'copied' && <span role='status'>Enlace copiado</span>}
      {result === 'manual' && <input aria-label={`Copie el enlace de ${name}`} value={url} readOnly onFocus={e => e.currentTarget.select()} />}
    </>
  )
}
