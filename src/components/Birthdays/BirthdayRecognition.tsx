import React from 'react'
import styles from '../../routes/Player/components/Birthday/BirthdayScene.css'

export default function BirthdayRecognition ({ name }: { name: string }) {
  return (
    <div className={styles.recognition}>
      <p>¡Feliz cumpleaños!</p>
      <h1>{name}</h1>
    </div>
  )
}
