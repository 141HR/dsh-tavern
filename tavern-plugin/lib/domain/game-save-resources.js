/** Materialize a save's resources without replacing existing local resources. */
export function createGameSaveResources({ resources, cardPreparation }) {
  async function importCard(payload) {
    const workspace = cardPreparation.create({ kind: 'import', payload })
    return resources.importCard(payload, workspace, { unique: true })
  }

  return async function prepare(save) {
    let cardPath = String(save.chat.cardPath || ''), importedCard = ''
    if (save.card?.payload) {
      let local = null
      try { local = await resources.originalCardPayload(cardPath) } catch {}
      if (!local || JSON.stringify(local) !== JSON.stringify(save.card.payload)) {
        cardPath = importedCard = await importCard(save.card.payload)
      }
    }
    return { cardPath, importedCard }
  }
}
