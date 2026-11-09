export const birthdayDate = (value: number | null) => value === null ? 'No registrado' : new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' }).format(value)
export const birthdayDuration = (milliseconds: number | null) => milliseconds === null ? 'Sin audio' : `${Math.round(milliseconds / 1000)} s`
