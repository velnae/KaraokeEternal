import React, { useState } from 'react'
import { useLocation, useNavigationType } from 'react-router'

// Router navigations can settle after a newer keystroke. Keep the editing value
// synchronous; adopt external navigation values when leaving the field or on POP.
export default function UrlTextInput ({ value, onValueChange, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string, onValueChange: (value: string) => void }) {
  const location = useLocation()
  const navigation = useNavigationType()
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const [seenLocation, setSeenLocation] = useState(location.key)
  if (seenLocation !== location.key) {
    setSeenLocation(location.key)
    if (!focused || navigation === 'POP') setDraft(value)
  }
  return (
    <input
      {...props}
      value={draft}
      onFocus={(event) => {
        setFocused(true)
        props.onFocus?.(event)
      }}
      onBlur={(event) => {
        setFocused(false)
        props.onBlur?.(event)
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        onValueChange(event.target.value)
      }}
    />
  )
}
