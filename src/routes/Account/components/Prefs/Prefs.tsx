import React from 'react'
import Panel from 'components/Panel/Panel'
import PathPrefs from './PathPrefs/PathPrefs'
import PlayerPrefs from './PlayerPrefs/PlayerPrefs'
import BrandingPrefs from './BrandingPrefs/BrandingPrefs'
import styles from './Prefs.css'

const Prefs = () => (
  <Panel title='Preferencias' contentClassName={styles.content}>
    <>
      <PathPrefs />
      <PlayerPrefs />
      <div id='admin-branding' className={styles.branding}><BrandingPrefs /></div>
    </>
  </Panel>
)

export default Prefs
