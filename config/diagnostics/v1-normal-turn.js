// Test-side evidence only. Absence of an observation is not an intentional omission.
export function characterizeLayer ({ enabled, omission, prepared, authorized, rendered, complete }) {
  let reason = 'completed'
  if (enabled === false || omission) reason = rendered ? 'unexpected-playback' : omission || 'disabled'
  else if (prepared === false) reason = 'not-prepared'
  else if (authorized === false) reason = 'not-authorized'
  else if (rendered === false) reason = 'not-rendered'
  else if (complete === false) reason = 'interrupted'
  else if (rendered !== true || complete !== true) reason = 'insufficient-evidence'
  return { prepared: prepared ?? null, authorized: authorized ?? null, rendered: rendered ?? null,
    complete: complete ?? null, outcome: reason === 'completed' ? 'completed'
      : (enabled === false || omission) && !rendered ? 'omitted' : reason === 'insufficient-evidence' ? 'unknown' : 'failed', reason }
}
