import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCode } from 'react-qrcode-logo'
import Button from 'components/Button/Button'
import Modal from 'components/Modal/Modal'
import styles from './TablePrint.css'

type PrintCard = { tableId: number, code: string, url: string }
type Props = { cards: PrintCard[], roomName: string, onClose: () => void }

export default function TablePrint ({ cards, roomName, onClose }: Props) {
  const [perPage, setPerPage] = useState(12)
  const pages: PrintCard[][] = []
  for (let start = 0; start < cards.length; start += perPage) pages.push(cards.slice(start, start + perPage))

  const sheets = (view: 'preview' | 'print') => pages.map((page, index) => (
    <section className={styles.page} data-per-page={perPage} aria-label={`Hoja ${index + 1} de ${pages.length}`} key={index}>
      {page.map(card => (
        <figure className={styles.card} key={card.tableId}>
          <QRCode id={`table-${view}-${card.tableId}`} value={card.url} size={600} quietZone={60} />
          <figcaption>{`${roomName} · Mesa ${card.code}`}</figcaption>
        </figure>
      ))}
    </section>
  ))

  return (
    <>
      <Modal
        className={styles.dialog}
        title='Imprimir QR de mesas'
        onClose={onClose}
        buttons={(
          <>
            <Button className={styles.cancel} onClick={onClose}>Cancelar</Button>
            <Button variant='primary' onClick={() => window.print()}>Imprimir</Button>
          </>
        )}
      >
        <div className={styles.settings}>
          <label>
            QR por hoja
            <select value={perPage} onChange={event => setPerPage(Number(event.target.value))}>
              <option value={4}>4 (2 × 2)</option>
              <option value={8}>8 (2 × 4)</option>
              <option value={12}>12 (3 × 4)</option>
            </select>
          </label>
          <p role='status'>{`${cards.length} QR · ${pages.length} ${pages.length === 1 ? 'hoja A4' : 'hojas A4'}`}</p>
        </div>
        <p className={styles.help}>QR de 4,5 cm, incluido su margen blanco. Imprima en A4 al 100 %, sin encabezados ni pies de página.</p>
        <div className={styles.preview} aria-label='Vista previa de impresión'>
          {sheets('preview')}
        </div>
      </Modal>
      {createPortal(<div className={styles.printSheets}>{sheets('print')}</div>, document.body)}
    </>
  )
}
