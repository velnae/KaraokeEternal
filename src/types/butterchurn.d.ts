declare module 'butterchurn' {
  type Preset = Record<string, unknown>
  type ImageData = { data: string, width: number, height: number }
  class Visualizer {
    loadExtraImages (imageData: Record<string, ImageData>): void
    loadPreset (preset: Preset, blendTime: number): void
    setRendererSize (width: number, height: number): void
    connectAudio (node: AudioNode): void
    render (): void
  }

  export default class Butterchurn {
    static createVisualizer (context: BaseAudioContext, canvas: HTMLCanvasElement, options?: {
      width?: number
      height?: number
      onlyUseWASM?: boolean
    }): Visualizer
  }
}

declare module 'butterchurn-presets/all' {
  import { type Preset } from 'butterchurn'
  const presets: Record<string, Preset>
  export default presets
}

declare module 'butterchurn-presets/imageData' {
  import { type ImageData } from 'butterchurn'
  const imageData: Record<string, ImageData>
  export default imageData
}

declare module 'butterchurn-presets/presetPackMeta' {
  interface PresetPack { presets: string[], chunk: string }
  export function getBasePresetKeys (): PresetPack
  export function getExtraPresetKeys (): PresetPack
  export function getImagePresetKeys (): PresetPack
  export function getMD1PresetKeys (): PresetPack
  export function getMinimalPresetKeys (): PresetPack
  export function getNonMinimalPresetKeys (): PresetPack
}
