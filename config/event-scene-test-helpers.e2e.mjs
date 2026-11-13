export async function sceneTemplateAction (page, name) {
  const action = page.getByRole('button', { name, exact: true })
  if (!await action.isVisible()) await page.getByLabel('Acciones de plantilla', { exact: true }).click()
  await action.click()
}

export async function expandSceneProperties (page) {
  const inspector = page.getByRole('region', { name: 'Propiedades del elemento', exact: true })
  for (const title of ['Formato', 'Posición y animación']) {
    const summary = inspector.getByText(title, { exact: true })
    if (await summary.count() && !await summary.evaluate(node => node.closest('details').open)) await summary.click()
  }
}

export async function sceneBlockAction (page, name) {
  const properties = page.getByRole('region', { name: 'Propiedades del elemento', exact: true })
  const action = properties.getByRole('button', { name, exact: true })
  if (!await action.isVisible()) await properties.getByLabel('Más acciones del bloque', { exact: true }).click()
  await action.click()
}
