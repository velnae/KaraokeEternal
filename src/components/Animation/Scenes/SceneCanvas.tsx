import React, { useEffect, useRef, useState } from 'react'
import styles from './Scenes.css'

export default function SceneCanvas ({ children, resolution = 1920 }: { children: React.ReactNode, resolution?: number }) {
  const parent = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const node = parent.current!
    const update = () => setWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={parent} className={styles.preview} aria-label='Lienzo de la escena'>
      <div className={styles.artboard} style={{ width: resolution, height: resolution * 9 / 16, transform: `scale(${width / resolution})` }}>
        {children}
      </div>
    </div>
  )
}
