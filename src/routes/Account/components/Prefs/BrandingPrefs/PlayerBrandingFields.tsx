import React, { useId, useState } from 'react'
import Button from 'components/Button/Button'
import Icon from 'components/Icon/Icon'
import InputCheckbox from 'components/InputCheckbox/InputCheckbox'
import PlayerBranding from 'components/PlayerBranding/PlayerBranding'
import {
  defaultPlayerBranding, getPlayerBranding, isBrandingBackgroundColor, MAX_BRANDING_MESSAGES, MAX_BRANDING_TITLE_LENGTH, MAX_BRANDING_TEXT_LENGTH, SOFT_BROWN_BRANDING_COLOR,
  type ClientBranding, type PlayerBrandingSettings,
} from 'shared/branding'
import styles from './BrandingPrefs.css'

interface PlayerBrandingFieldsProps {
  branding: ClientBranding
  onChange(settings: PlayerBrandingSettings): void
}

const PlayerBrandingFields = ({ branding, onChange }: PlayerBrandingFieldsProps) => {
  const id = useId()
  const settings = getPlayerBranding(branding.player)
  const [preview, setPreview] = useState('LISTEN')
  const changeMessage = (index: number, values: Partial<PlayerBrandingSettings['messages'][number]>) => {
    onChange({ ...settings, messages: settings.messages.map((message, position) => position === index ? { ...message, ...values } : message) })
  }

  return (
    <section className={styles.playerSection} aria-labelledby={`${id}-heading`}>
      <h3 id={`${id}-heading`}>Durante las canciones</h3>
      <p className={styles.hint}>Elementos superpuestos sobre YouTube. El video conserva su tamaño. Se ocultan durante las transiciones.</p>
      <div className={styles.playerOptions}>
        <div>
          <InputCheckbox
            label='Mostrar logo en el reproductor'
            checked={settings.showLogo}
            aria-describedby={`${id}-logo-help`}
            onChange={event => onChange({ ...settings, showLogo: event.currentTarget.checked })}
          />
          <p id={`${id}-logo-help`} className={styles.hint}>
            {branding.logoSrc ? 'Usa el logo de arriba, en la esquina superior derecha, también durante karaoke.' : 'Suba un logo en la sección anterior para mostrarlo en el reproductor.'}
          </p>
        </div>
        <div>
          <InputCheckbox
            label='Mostrar comunicados durante música para escuchar'
            checked={settings.showAnnouncements}
            aria-describedby={`${id}-announcement-help`}
            onChange={event => onChange({ ...settings, showAnnouncements: event.currentTarget.checked })}
          />
          <p id={`${id}-announcement-help`} className={styles.hint}>El rectángulo inferior se oculta siempre durante karaoke y pedidos sin clasificar.</p>
        </div>
      </div>
      <div className={styles.appearanceFields}>
        <div className={styles.field}>
          <label htmlFor={`${id}-alignment`}>Alineación del contenido</label>
          <select
            id={`${id}-alignment`}
            value={settings.alignment}
            onChange={event => onChange({ ...settings, alignment: event.currentTarget.value as PlayerBrandingSettings['alignment'] })}
          >
            <option value='left'>Izquierda</option>
            <option value='center'>Centrado</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-background`}>Color de fondo del comunicado</label>
          <div className={styles.colorControls}>
            <input
              type='color'
              aria-label='Elegir color de fondo'
              value={isBrandingBackgroundColor(settings.backgroundColor) ? settings.backgroundColor : defaultPlayerBranding.backgroundColor}
              onChange={event => onChange({ ...settings, backgroundColor: event.currentTarget.value })}
            />
            <input
              id={`${id}-background`}
              type='text'
              data-branding-color
              maxLength={7}
              spellCheck={false}
              value={settings.backgroundColor}
              aria-invalid={!isBrandingBackgroundColor(settings.backgroundColor)}
              aria-describedby={`${id}-color-help`}
              onChange={event => onChange({ ...settings, backgroundColor: event.currentTarget.value })}
            />
          </div>
          <p id={`${id}-color-help`} className={isBrandingBackgroundColor(settings.backgroundColor) ? styles.hint : styles.fieldError}>
            {isBrandingBackgroundColor(settings.backgroundColor) ? 'Formato #RRGGBB. Se conserva la transparencia del rectángulo.' : 'Escriba # seguido de seis dígitos hexadecimales, por ejemplo #6B5143.'}
          </p>
          <Button type='button' className={styles.textButton} onClick={() => onChange({ ...settings, backgroundColor: SOFT_BROWN_BRANDING_COLOR })}>
            Usar marrón suave
          </Button>
        </div>
      </div>
      <div className={styles.workspace}>
        <div className={styles.editor}>
          <p className={styles.hint}>{`Hasta ${MAX_BRANDING_MESSAGES} comunicados breves. Se alternan cada 15 segundos; en pausa, el mensaje permanece fijo.`}</p>
          {settings.messages.map((message, index) => (
            <fieldset key={index} className={styles.messageFields}>
              <legend>{`Comunicado ${index + 1}`}</legend>
              <div className={styles.field}>
                <label htmlFor={`${id}-title-${index}`}>{`Título del comunicado ${index + 1}`}</label>
                <input
                  id={`${id}-title-${index}`}
                  data-message-title
                  type='text'
                  required
                  maxLength={MAX_BRANDING_TITLE_LENGTH}
                  value={message.title}
                  onChange={event => changeMessage(index, { title: event.currentTarget.value })}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor={`${id}-text-${index}`}>{`Texto del comunicado ${index + 1} (opcional)`}</label>
                <input
                  id={`${id}-text-${index}`}
                  type='text'
                  maxLength={MAX_BRANDING_TEXT_LENGTH}
                  value={message.text}
                  onChange={event => changeMessage(index, { text: event.currentTarget.value })}
                />
              </div>
              {settings.messages.length > 1 && (
                <Button
                  type='button'
                  className={styles.textButton}
                  aria-label={`Quitar comunicado ${index + 1}`}
                  onClick={() => onChange({ ...settings, messages: settings.messages.filter((_, position) => position !== index) })}
                >
                  Quitar comunicado
                </Button>
              )}
            </fieldset>
          ))}
          {settings.messages.length < MAX_BRANDING_MESSAGES && (
            <Button
              type='button'
              className={styles.uploadButton}
              onClick={() => onChange({ ...settings, messages: [...settings.messages, { title: '', text: '' }] })}
            >
              Agregar comunicado
            </Button>
          )}
        </div>
        <figure className={styles.preview}>
          <figcaption>
            <Icon icon='VISIBILITY' size={18} />
            <span>Vista previa del reproductor</span>
          </figcaption>
          <label className={styles.previewSelect}>
            Contenido de la vista previa
            <select value={preview} onChange={event => setPreview(event.currentTarget.value)}>
              <option value='LISTEN'>Música para escuchar</option>
              <option value='SING'>Karaoke</option>
              <option value='TRANSITION'>Transición</option>
            </select>
          </label>
          <div className={styles.playerPreview}>
            <span className={styles.previewVideo}>{preview === 'TRANSITION' ? 'Transición' : 'Video de YouTube'}</span>
            {preview !== 'TRANSITION' && <PlayerBranding key={preview} branding={branding} intent={preview === 'SING' ? 'SING' : 'LISTEN'} isPlaying />}
          </div>
          <p className={styles.previewNote}>Los cambios se aplican al guardar. La invitación utiliza el QR que ya está en cada mesa.</p>
        </figure>
      </div>
    </section>
  )
}

export default PlayerBrandingFields
