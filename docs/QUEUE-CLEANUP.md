# Reset the room queue

In **Cola**, close the player if it is open, then select **Reiniciar cola** and confirm. The reset applies to the
current room across all tables, regardless of the selected tab or filter.
Cancel or press Escape to leave playback and requests untouched.

On confirmation, the current song stops, every pending request is removed and
the visible history is cleared. If **De la casa** has an active list, the queue
is refilled in a new order, ready for the next time you start the player. The
saved list order and repeat setting are preserved. Without an active list, the
queue stays empty and the player stops. The animator's session and mode are
independent of this action.

## If confirmation is lost

**Comprobar resultado** looks up the original reset, even after reloading the
page. It does not clear the queue again or interrupt newer playback. If there is
no reset on record, review the scope and confirm again.

## How the reset is stored

Queue removal, history visibility, the new house run, and the receipt commit
together. The room generation prevents requests that were still resolving when
the queue was reset from reappearing afterward. Internal history and request
records remain available for deduplication. Migration `058-house-playback-order.sql`
stores the shuffled playback order separately from the saved playlist.
