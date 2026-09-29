// Formats a local time using an unambiguous 24-hour clock.
export function formatTime (dateObj: Date) {
  return `${String(dateObj.getHours()).padStart(2, '0')}:${String(dateObj.getMinutes()).padStart(2, '0')}`
}

export function formatDate (dateObj: Date) {
  return dateObj.toISOString().substring(0, 10)
}

export function formatDateTime (dateObj: Date) {
  return (formatDate(dateObj) + ' ' + formatTime(dateObj))
}

export function formatDuration (sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60

  return `${m}:${s < 10 ? '0' + s : s}`
}

export function formatSeconds (sec: number, fuzzy = false) {
  if (sec >= 60 && fuzzy) return Math.round(sec / 60) + 'm'

  const m = Math.floor(sec / 60)
  const s = sec % 60

  return m ? `${m}m ${s}s` : `${s}s`
}
