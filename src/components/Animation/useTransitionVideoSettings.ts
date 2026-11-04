import { useEffect, useReducer, useRef, useState } from 'react'
import { getTransitionVideoOverview, getTransitionVideoResource, recoverTransitionVideoUpload, saveTransitionVideo, transitionVideoError, uploadTransitionVideo } from 'lib/transitionVideoApi'
import { TRANSITION_VIDEO_LIMITS } from 'shared/transitionVideo'
import { initialVideoSettings, transitionVideoReducer, type VideoSettingsOperation } from './transitionVideoState'

export function useTransitionVideoSettings (roomId: number) {
  const [state, dispatch] = useReducer(transitionVideoReducer, initialVideoSettings)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const mounted = useRef(false)
  const operation = useRef<AbortController | null>(null)
  const attempt = useRef<{ file: File, requestId: string } | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current?.abort()
      operation.current = null
      attempt.current = null
    }
  }, [])
  useEffect(() => {
    if (state.operation !== 'idle') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const overview = await getTransitionVideoOverview(controller.signal)
        if (!controller.signal.aborted) dispatch({ type: 'receive', overview })
        const id = state.draft?.videoId
        if (id && ![overview.selected, overview.candidate].some(video => video?.id === id)) {
          // An older preview may still be pinned by an active stream. Verify it
          // instead of discarding the draft or assuming absence means retirement.
          try {
            const resource = await getTransitionVideoResource(id, controller.signal)
            if (!controller.signal.aborted) dispatch({ type: 'resource', resource })
          } catch (error) {
            if ((error as { status?: number }).status !== 404) throw error
            if (!controller.signal.aborted) dispatch({ type: 'unavailable', id })
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) dispatch({ type: 'connection', message: transitionVideoError(error) })
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 1500)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [roomId, state.operation, refreshVersion, state.draft?.videoId])

  const begin = (kind: VideoSettingsOperation) => {
    operation.current?.abort()
    const controller = new AbortController()
    operation.current = controller
    dispatch({ type: 'operation', operation: kind })
    return controller
  }
  const current = (controller: AbortController) => mounted.current && operation.current === controller
  const refresh = () => setRefreshVersion(version => version + 1)
  const reload = async () => {
    const controller = begin('reloading')
    try {
      const overview = await getTransitionVideoOverview(controller.signal)
      if (current(controller)) dispatch({ type: 'receive', overview, reset: true })
    } catch (error) {
      if (current(controller)) dispatch({ type: 'error', message: transitionVideoError(error) })
    }
  }
  const upload = async (file?: File) => {
    if (file) {
      if (!file.size || file.size > TRANSITION_VIDEO_LIMITS.size) {
        dispatch({ type: 'error', message: 'Seleccione un video MP4 de hasta 40 MiB.' })
        return
      }
      attempt.current = { file, requestId: crypto.randomUUID() }
    }
    const pending = attempt.current
    if (!pending) return
    const controller = begin('uploading')
    try {
      const resource = await uploadTransitionVideo(pending.file, pending.requestId, controller.signal, (value) => {
        if (current(controller)) dispatch({ type: 'progress', value })
      })
      if (current(controller)) {
        attempt.current = null
        dispatch({ type: 'uploadDone', resource })
      }
    } catch (error) {
      if (!current(controller)) return
      const status = (error as { status?: number }).status
      if (status) {
        dispatch({ type: 'uploadFailed', retry: status === 409 || status >= 500, message: transitionVideoError(error) })
        return
      }
      // Recover the same receipt after a lost response/cancellation; never create
      // another resource just because the upload response was uncertain.
      const recovery = begin('recovering')
      try {
        const resource = await recoverTransitionVideoUpload(pending.requestId, recovery.signal)
        if (current(recovery)) {
          attempt.current = null
          dispatch({ type: 'uploadDone', resource })
        }
      } catch {
        if (current(recovery)) dispatch({ type: 'uploadFailed', retry: true,
          message: controller.signal.aborted ? 'Carga cancelada. Puede reintentar o elegir otro archivo.' : transitionVideoError(error) })
      }
    }
  }
  const save = async () => {
    const settings = state.pendingSave ?? state.draft
    if (!settings) return
    const controller = begin('saving')
    dispatch({ type: 'saveStart', settings })
    try {
      const overview = await saveTransitionVideo(settings, controller.signal)
      if (current(controller)) dispatch({ type: 'saveResult', overview })
    } catch (error) {
      if (!current(controller)) return
      const status = (error as { status?: number }).status
      if (status && status < 500 && status !== 409) {
        dispatch({ type: 'saveRejected', message: transitionVideoError(error) })
        return
      }
      dispatch({ type: 'saveUncertain', message: 'No se confirmó el guardado. Estamos comprobando la configuración; también puede reintentar.' })
      try {
        const overview = await getTransitionVideoOverview(controller.signal)
        if (current(controller)) dispatch({ type: 'receive', overview })
      } catch { /* Polling keeps the draft and reconciles when connectivity returns. */ }
    }
  }
  return { state, dispatch, upload, save, reload, refresh, cancelUpload: () => operation.current?.abort() }
}
