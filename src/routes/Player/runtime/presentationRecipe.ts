import type { GreetingAsset } from 'shared/greetings'

/** Preserve the server's authorized order. The bed is concurrent, never another spoken step. */
export function presentationRecipe (assets: GreetingAsset[]) {
  const voicedCard = assets.some(asset => asset.role === 'greeting')
  return {
    entry: assets.find(asset => asset.role === 'entry'),
    voicedCard,
    foreground: assets.filter(asset => asset.role !== 'bed' && asset.role !== 'entry').map(asset => ({
      asset, showCard: asset.role === 'greeting' || (!voicedCard && asset.role === 'call'),
    })),
  }
}
