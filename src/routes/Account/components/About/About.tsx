import React from 'react'
import Panel from 'components/Panel/Panel'
import logo from 'assets/puyu-logo.png'
import styles from './About.css'

const socialLinks = [
  {
    name: 'TikTok',
    href: 'https://www.tiktok.com/@puyu.pe',
    path: 'M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.3 0 .6.05.88.14V9.4a6.34 6.34 0 1 0 5.46 6.27V8.69a8.16 8.16 0 0 0 4.77 1.52V6.78c-.34 0-.67-.03-1-.09Z',
  },
  {
    name: 'Facebook',
    href: 'https://www.facebook.com/puyu.pe',
    path: 'M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.235 2.686.235v2.97H15.83c-1.49 0-1.956.931-1.956 1.887v2.265h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073Z',
  },
  {
    name: 'YouTube',
    href: 'https://www.youtube.com/@puyu_pe',
    path: 'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.6 15.6V8.4L15.8 12Z',
  },
  {
    name: 'Instagram',
    href: 'https://www.instagram.com/puyu_pe',
    path: 'M7 0C3.13 0 0 3.13 0 7v10c0 3.87 3.13 7 7 7h10c3.87 0 7-3.13 7-7V7c0-3.87-3.13-7-7-7H7Zm0 2h10c2.76 0 5 2.24 5 5v10c0 2.76-2.24 5-5 5H7c-2.76 0-5-2.24-5-5V7c0-2.76 2.24-5 5-5Zm11.5 2a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
  },
]

const About = () => (
  <Panel title='Acerca de' contentClassName={styles.content}>
    <div className={styles.identity}>
      <a className={styles.brand} href='https://puyu.pe' target='_blank' rel='noreferrer'>
        <img className={styles.logo} src={logo} alt='Puyu.pe' width={800} height={204} />
      </a>
      <h3 className={styles.name}>Karaoke inteligente</h3>
      <p className={styles.tagline}>La música la eliges tú. Nosotros hacemos que la experiencia sea inolvidable.</p>

      <a className={styles.sales} href='https://wa.me/51978189845' target='_blank' rel='noreferrer'>
        WhatsApp de ventas
      </a>

      <nav className={styles.socials} aria-label='Redes sociales de Puyu.pe'>
        {socialLinks.map(({ name, href, path }) => (
          <a key={name} href={href} target='_blank' rel='noreferrer'>
            <svg width={18} height={18} viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
              <path fill='currentColor' d={path} />
            </svg>
            {name}
          </a>
        ))}
      </nav>

      <div className={styles.details}>
        <p>
          Versión
          {' '}
          {/* @ts-expect-error: global via Webpack, sourced from package.json */}
          {__KE_VERSION__}
        </p>
        <p>{`© ${new Date().getFullYear()} Puyu.pe S.R.L.`}</p>
        <p className={styles.credits}>Basado en Karaoke Eternal, desarrollado originalmente por RadRoot LLC.</p>
        <a className={styles.licenses} href='/licenses.txt' target='_blank' rel='noreferrer'>Licencias</a>
      </div>
    </div>
  </Panel>
)

export default About
