/** Retry only an explicit pre-execution rejection, never an ambiguous write. */
export async function transitionRequest<T> (send: () => Promise<T>, synchronize: () => Promise<unknown>, valid: () => boolean) {
  try {
    return await send()
  } catch (error) {
    if ((error as { code?: string })?.code !== 'COMMAND_EXPIRED' || !valid()) throw error
    await synchronize()
    if (!valid()) throw error
    return send()
  }
}
