export function shuffleOrder (ids: number[], random = Math.random): number[] {
  const order = [...ids]
  for (let index = order.length - 1; index > 0; index--) {
    const target = Math.floor(random() * (index + 1))
    ;[order[index], order[target]] = [order[target], order[index]]
  }
  return order
}
