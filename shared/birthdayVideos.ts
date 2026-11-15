import type { BirthdayInput, BirthdaySettings, BirthdaySex } from './birthdays.js'

export const birthdaySexes: BirthdaySex[] = ['female', 'male', 'unspecified']
export const birthdaySexLabels = { female: 'Femenino', male: 'Masculino', unspecified: 'Sin especificar' }
export interface BirthdayVideoRange { id: string, minAge: number, maxAge: number, videoId: string | null }
export interface BirthdayVideoGroup { videoId: string | null, ranges: BirthdayVideoRange[] }
export type BirthdayVideoGroups = Partial<Record<BirthdaySex, BirthdayVideoGroup>>
export interface BirthdayVideoSelection { videoId: string | null, level: 'age' | 'sex' | 'default', sex?: BirthdaySex, minAge?: number, maxAge?: number }

// Materialize legacy age/sex assignments once, independently from voice profiles.
export function birthdayVideoGroups (settings: BirthdaySettings): BirthdayVideoGroups {
  if (settings.videoBackgrounds !== undefined) return settings.videoBackgrounds
  const groups: BirthdayVideoGroups = {}
  for (const sex of birthdaySexes) {
    const ranges: BirthdayVideoRange[] = []
    for (let age = 0; age <= 120; age++) {
      const matching = settings.rules.filter(rule => age >= rule.minAge && age <= rule.maxAge)
      const videoId = (matching.find(rule => rule.sex === sex) ?? matching.find(rule => rule.sex === 'any'))?.videoId
      if (!videoId) continue
      const previous = ranges[ranges.length - 1]
      if (previous?.videoId === videoId && previous.maxAge === age - 1) previous.maxAge = age
      else ranges.push({ id: `legacy-${sex}-${age}`, minAge: age, maxAge: age, videoId })
    }
    if (ranges.length) groups[sex] = { videoId: null, ranges }
  }
  return groups
}

export function validateBirthdayVideoGroups (value: unknown): BirthdayVideoGroups {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  const video = (id: unknown) => id === null || (typeof id === 'string' && /^[\w-]{1,120}$/.test(id))
  if (!record(value) || Object.keys(value).some(key => !birthdaySexes.includes(key as BirthdaySex))) throw new Error('Revise los fondos por sexo.')
  const groups: BirthdayVideoGroups = {}
  for (const sex of birthdaySexes) {
    const group = value[sex]
    if (group === undefined) continue
    if (!record(group) || Object.keys(group).some(key => !['videoId', 'ranges'].includes(key)) || !video(group.videoId) || !Array.isArray(group.ranges) || group.ranges.length > 121) throw new Error('Revise el fondo y los rangos de edad.')
    const ranges: BirthdayVideoRange[] = group.ranges.map((range) => {
      if (!record(range) || Object.keys(range).some(key => !['id', 'minAge', 'maxAge', 'videoId'].includes(key))
        || typeof range.id !== 'string' || !/^[\w-]{1,80}$/.test(range.id) || !Number.isInteger(range.minAge) || !Number.isInteger(range.maxAge)
        || Number(range.minAge) < 0 || Number(range.maxAge) > 120 || Number(range.minAge) > Number(range.maxAge) || !video(range.videoId)) throw new Error('Use rangos entre 0 y 120 años y seleccione un video o Heredar.')
      return { id: range.id, minAge: Number(range.minAge), maxAge: Number(range.maxAge), videoId: range.videoId as string | null }
    })
    if (new Set(ranges.map(range => range.id)).size !== ranges.length || ranges.some((a, index) => ranges.slice(index + 1).some(b => a.minAge <= b.maxAge && b.minAge <= a.maxAge))) throw new Error('Los rangos de fondo del mismo sexo no pueden superponerse.')
    groups[sex] = { videoId: group.videoId as string | null, ranges }
  }
  return groups
}

export function selectBirthdayVideo (settings: BirthdaySettings, input: Pick<BirthdayInput, 'sex' | 'birthYear'>, year: number): BirthdayVideoSelection {
  const group = birthdayVideoGroups(settings)[input.sex]
  const age = year - input.birthYear
  const range = group?.ranges.find(range => age >= range.minAge && age <= range.maxAge)
  if (range?.videoId) return { videoId: range.videoId, level: 'age', sex: input.sex, minAge: range.minAge, maxAge: range.maxAge }
  if (group?.videoId) return { videoId: group.videoId, level: 'sex', sex: input.sex }
  return { videoId: settings.videoId, level: 'default' }
}

export function birthdayVideoOrigin (selection: BirthdayVideoSelection) {
  if (selection.level === 'age') return `${birthdaySexLabels[selection.sex!]} · ${selection.minAge}–${selection.maxAge} años`
  return selection.level === 'sex' ? birthdaySexLabels[selection.sex!] : 'Predeterminado'
}
