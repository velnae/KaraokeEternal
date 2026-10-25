import React, { useState } from 'react'
import clsx from 'clsx'
import Logo from 'components/Logo/Logo'
import { useAppSelector } from 'store/hooks'
import { normalizeBrandingSupportUrl, type ClientBranding as ClientBrandingConfig } from 'shared/branding'
import styles from './ClientBranding.css'

interface ClientBrandingProps {
  className?: string
  branding?: ClientBrandingConfig
}

const ClientBranding = ({ className, branding }: ClientBrandingProps) => {
  const savedBranding = useAppSelector(state => state.prefs.branding)
  const clientBranding = branding ?? savedBranding
  const hasClientBranding = Boolean(clientBranding.name.trim())
  const [failedLogoSrc, setFailedLogoSrc] = useState<string | null>(null)
  const hasLogo = Boolean(clientBranding.logoSrc && failedLogoSrc !== clientBranding.logoSrc)
  const supportUrl = normalizeBrandingSupportUrl(clientBranding.supportUrl)

  if (!hasClientBranding) return <Logo className={className} />

  return (
    <div className={clsx(styles.container, className)}>
      <div className={styles.identity}>
        {hasLogo && (
          <img
            className={styles.logo}
            src={clientBranding.logoSrc}
            alt={`Logo de ${clientBranding.name}`}
            onError={() => setFailedLogoSrc(clientBranding.logoSrc ?? null)}
          />
        )}
        <Logo subtitle={clientBranding.name} />
      </div>
      {supportUrl && (
        <a className={styles.support} href={supportUrl} target='_blank' rel='noreferrer'>
          Contactar soporte
        </a>
      )}
    </div>
  )
}

export default ClientBranding
