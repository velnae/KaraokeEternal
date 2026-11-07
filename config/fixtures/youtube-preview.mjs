/* global window, document, queueMicrotask */
// Exercise the real preview lifecycle without calling YouTube or producing audio.
export async function installYouTubePreviewMock (context) {
  await context.addInitScript(() => {
    const fixture = window.previewTest = { mode: 'playing', code: 150, instances: [], destroyed: 0 }
    const live = () => fixture.instances.filter(player => !player.destroyed).at(-1)
    fixture.play = () => live()?.emitPlaying()
    fixture.fail = code => live()?.options.events.onError({ target: live(), data: code })
    window.YT = {
      PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2 },
      Player: class {
        constructor (element, options) {
          this.options = options
          this.id = options.videoId
          this.node = document.createElement('div')
          this.node.style.cssText = 'display:grid;place-items:center;background:#161c2b;color:white'
          this.node.textContent = 'Vista previa simulada'
          const play = document.createElement('button')
          play.textContent = 'Reproducir video simulado'
          play.onclick = () => this.emitPlaying()
          this.node.appendChild(play)
          element.replaceWith(this.node)
          fixture.instances.push(this)
          this.setSize(options.width, options.height)
          queueMicrotask(() => {
            if (!this.destroyed) options.events.onReady({ target: this })
          })
        }

        loadVideoById (id) {
          this.id = id
          queueMicrotask(() => {
            if (this.destroyed) return
            const event = { target: this, data: fixture.code }
            if (fixture.mode === 'error') this.options.events.onError(event)
            else if (fixture.mode === 'autoplay') this.options.events.onAutoplayBlocked(event)
            else if (fixture.mode === 'playing') this.emitPlaying()
            else if (fixture.mode === 'ready') this.options.events.onStateChange({ target: this, data: 5 })
          })
        }

        emitPlaying () { this.options.events.onStateChange({ target: this, data: 1 }) }
        playVideo () { this.emitPlaying() }
        cueVideoById (id) {
          this.id = id
          queueMicrotask(() => {
            if (!this.destroyed) this.options.events.onStateChange({ target: this, data: 5 })
          })
        }

        pauseVideo () { this.options.events.onStateChange({ target: this, data: 2 }) }
        seekTo () {}
        getCurrentTime () { return 2 }
        getVideoUrl () { return `https://www.youtube.com/watch?v=${this.id}` }
        setVolume (volume) { this.volume = volume }
        setSize (width, height) { Object.assign(this.node.style, { width: `${width}px`, height: `${height}px` }) }
        destroy () {
          this.destroyed = true
          fixture.destroyed++
          this.node.remove()
        }
      },
    }
  })
}

export async function confirmSongPreview (page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar', exact: true }).click()
}
