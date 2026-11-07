import type { AnimationClip, EffectType } from './animation.js'

export const effectCategories = [
  { value: 'appreciation', label: 'Agradecimiento', recommended: '2–3 s', effectType: 'short' },
  { value: 'celebration', label: 'Celebración', recommended: '3–4 s', effectType: 'short' },
  { value: 'transition', label: 'Transición musical', recommended: '6–10 s', effectType: 'transition' },
  { value: 'anticipation', label: 'Expectativa', recommended: '1,5–3 s', effectType: 'short' },
  { value: 'notification', label: 'Aviso suave', recommended: '0,5–1,5 s', effectType: 'short' },
] as const satisfies readonly { value: string, label: string, recommended: string, effectType: EffectType }[]

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
export function effectCategory (value?: string) {
  const text = normalized(value ?? '')
  const alias = ({ 'separador': 'transition', 'separador musical': 'transition', 'redoble': 'anticipation', 'campanilla': 'notification' } as Record<string, string>)[text]
  return effectCategories.find(category => category.value === (alias ?? text) || normalized(category.label) === text)
}
// Keep unknown legacy labels; an ambiguous "aplauso" needs operator classification.
export const effectCategoryValue = (value?: string) => effectCategory(value)?.value ?? value ?? ''
export const effectCategoryLabel = (value?: string) => effectCategory(value)?.label ?? value ?? ''

export const isMusicalCurtain = (clip: Pick<AnimationClip, 'kind' | 'effectType' | 'category'>) => clip.kind === 'effect'
  && (clip.effectType === 'transition' || effectCategoryValue(clip.category) === 'transition')
