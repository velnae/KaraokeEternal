import React from 'react'
import Button from 'components/Button/Button'
import type Icon from 'components/Icon/Icon'
import styles from './Scenes.css'

interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string
  icon: React.ComponentProps<typeof Icon>['icon']
  variant?: 'default' | 'primary'
}

export default function SceneIconButton ({ label, icon, variant = 'default', ...props }: Props) {
  return <Button {...props} variant={variant} className={styles.iconAction} icon={icon} size={22} aria-label={label} />
}
