import React from 'react'
import Button from 'components/Button/Button'
import type { BirthdayAsset, BirthdaySettings, BirthdaySex } from 'shared/birthdays'
import { birthdaySexes, birthdaySexLabels, birthdayVideoGroups, type BirthdayVideoGroup } from 'shared/birthdayVideos'
import styles from './BirthdaySettings.css'

export default function BirthdayVideoSettings ({ config, assets, disabled, onChange, onManage, onPreview }: {
  config: BirthdaySettings
  assets: BirthdayAsset[]
  disabled: boolean
  onChange(config: BirthdaySettings): void
  onManage(): void
  onPreview(asset: BirthdayAsset): void
}) {
  const videos = assets.filter(asset => asset.kind === 'video')
  const groups = birthdayVideoGroups(config)
  const title = (id: string | null) => videos.find(video => video.id === id)?.title ?? 'Sin fondo asignado'
  const options = videos.map(video => <option key={video.id} value={video.id}>{video.title}</option>)
  const update = (sex: BirthdaySex, group: BirthdayVideoGroup) => onChange({ ...config, videoBackgrounds: { ...groups, [sex]: group } })
  const selected = videos.find(video => video.id === config.videoId)
  return (
    <fieldset disabled={disabled} className={styles.section}>
      <legend>Fondos de cumpleaños</legend>
      <div className={styles.resource}>
        <label>
          Fondo predeterminado
          <select value={config.videoId ?? ''} onChange={event => onChange({ ...config, videoId: event.target.value || null, videoBackgrounds: groups })}>
            <option value=''>Sin seleccionar</option>
            {options}
          </select>
        </label>
        <div className={styles.actions}>
          {selected && <Button onClick={() => onPreview(selected)}>Ver fondo</Button>}
          <Button aria-label='Cambiar fondo del cumpleaños' onClick={onManage}>Administrar videos</Button>
        </div>
      </div>
      {!config.videoId && <p role='status'>Seleccione un fondo predeterminado para completar la herencia.</p>}
      {birthdaySexes.map((sex) => {
        const group = groups[sex] ?? { videoId: null, ranges: [] }
        const inherited = group.videoId ? `${title(group.videoId)} · ${birthdaySexLabels[sex]}` : `${title(config.videoId)} · Predeterminado`
        const freeAge = Array.from({ length: 121 }, (_, age) => age).find(age => !group.ranges.some(range => age >= range.minAge && age <= range.maxAge))
        return (
          <details key={sex} className={styles.videoGroup}>
            <summary>{birthdaySexLabels[sex]}</summary>
            <div className={styles.videoGroupBody}>
              <label>
                {`Fondo ${birthdaySexLabels[sex].toLowerCase()}`}
                <select value={group.videoId ?? ''} onChange={event => update(sex, { ...group, videoId: event.target.value || null })}>
                  <option value=''>{`Heredar — ${title(config.videoId)} · Predeterminado`}</option>
                  {options}
                </select>
              </label>
              {group.ranges.map((range, index) => {
                const change = (patch: Partial<typeof range>) => update(sex, { ...group, ranges: group.ranges.map(value => value.id === range.id ? { ...range, ...patch } : value) })
                return (
                  <div key={range.id} className={styles.videoRange} role='group' aria-label={`Rango ${index + 1} ${birthdaySexLabels[sex].toLowerCase()}`}>
                    <label>
                      Desde
                      <input type='number' min={0} max={120} value={Number.isFinite(range.minAge) ? range.minAge : ''} onChange={event => change({ minAge: event.target.valueAsNumber })} />
                    </label>
                    <label>
                      Hasta
                      <input type='number' min={0} max={120} value={Number.isFinite(range.maxAge) ? range.maxAge : ''} onChange={event => change({ maxAge: event.target.valueAsNumber })} />
                    </label>
                    <label>
                      Video del rango
                      <select value={range.videoId ?? ''} onChange={event => change({ videoId: event.target.value || null })}>
                        <option value=''>{`Heredar — ${inherited}`}</option>
                        {options}
                      </select>
                    </label>
                    <Button onClick={() => update(sex, { ...group, ranges: group.ranges.filter(value => value.id !== range.id) })}>Quitar rango</Button>
                  </div>
                )
              })}
              {freeAge !== undefined && <Button onClick={() => update(sex, { ...group, ranges: [...group.ranges, { id: crypto.randomUUID(), minAge: freeAge, maxAge: freeAge, videoId: null }] })}>Agregar rango de edad</Button>}
            </div>
          </details>
        )
      })}
    </fieldset>
  )
}
