# Edit event choreographies

Open **Animador → Coreografías**, select the event and edit a template. **Guardar**
saves changes; **Guardar y usar** saves and selects that template for subsequent events in the current
room. **Usar original** restores the existing presentation for that event.

On desktop, the 16:9 preview uses the available width beside a wider inspector
whose height follows the preview row. The timeline has its own bounded scroll
area. On mobile, the inspector follows the timeline and local navigation stays
on one scrollable line. **Acciones de plantilla** (the three-dot menu) groups
template creation, duplication and removal; undo/redo sit beside the audio, video
and text tools.

Playback, fullscreen, undo/redo, duplicate/remove and resource-row actions use
44-pixel icon buttons with Spanish accessible names. Save/discard/activation and
non-obvious operations keep their text. Fixed audio blocks expose **Mover antes**
and **Mover después** in **Más acciones del bloque** rather than using arrows that
could be mistaken for timing adjustments.

The persistent save bar groups **Descartar cambios**, **Guardar** and **Guardar y
usar**, alongside the current state. **Guardar** is the primary editing action.
When the state is **Guardado**, saving and discarding are disabled until a change
is made; selecting a saved template with **Guardar y usar** remains available.

## Timing

The template's start is relative to the outgoing video's end: `-2` starts two
seconds before it finishes, `0` starts at its end, and `2` starts two seconds later.
The initial supported range is -10 to +10 seconds.

Each block can use the template start, the confirmed video end, the preceding
available audio end, or any named block as its reference. Select a block, then use
**Tiempo del bloque** above the timeline: choose its **Referencia**, **Inicio/Final**,
the displacement in seconds, and **Antes/Después**. This maps to the same signed
-30 to +30 second offset. The reference can appear earlier or later in the editor;
its saved ID stays bound to the same block when elements move.

For example, place text **0.5 s Antes** of the greeting's **Inicio**, and an effect
**0.2 s Después** of its **Final**. A longer prepared greeting moves both
dependent blocks automatically. Preview uses the selected case's actual resources;
the player tracks decoded durations and confirmed audio starts/ends. It does not
invent a three-second interval for an unavailable sample.

Selecting a block highlights its direct dependencies. Arrows leave the reference's
chosen start/end and point to the dependent block's start; their labels show the
signed offset. Direction expresses dependency, so negative offsets may point
backward in time. Click an arrow label or use Tab and Enter/Space to select its
dependent. Links stay aligned during drag, zoom and horizontal scrolling.

Blocks without resolved timing appear under **Sin tiempos de prueba**, outside
the time scale. Their logical links are dashed until a prepared case or sample
provides timing. Lane names remain visible while scrolling. Drag a bar's grip to
change its offset, or its right handle to resize text/video duration. Audio retains
its full duration. Resource and appearance controls remain in the inspector.

Voice blocks retain their complete audio. Foreground voices/effects cannot
overlap, and native presentation/greeting/signature attribution stays ordered.
Text, backgrounds and ambience can run concurrently. A missing or disabled
reference omits its dependents for that case. Cycles, missing IDs and starts before
the template origin are rejected. Referencing a visual/ambience block's **Final**
requires an explicit duration. Change dependent references before removing their
target; splitting an event card preserves its original reference ID.

The existing finite playback permits and transition budget remain authoritative;
a valid relationship does not authorize an arbitrarily long public pause.

For an overlapping musical introduction without talking over the final lyrics:

1. Set template start to **-2 seconds**.
2. Place ambience at **Inicio de la plantilla**, displacement **0**.
3. Place the presentation at **Final del video**, displacement **0**.
4. Enable **Mantener ambiente hasta la siguiente canción** for continuity during
   loading. Playback authority and the finite ambience permit still apply.

The cyan dashed timeline marker locates the estimated outgoing video end. Real
playback uses the actual end event for blocks anchored at or after that boundary.
An unknown duration falls back to the normal end-boundary opportunity.

## Resources and preview

### Add and remove elements

Use **Agregar audio**, **Agregar video** or **Agregar texto**. The picker reuses the
room's existing libraries; birthday templates also offer their saved introductions
and music. **Abrir biblioteca** opens resource management in another tab.

Select an element in the canvas or timeline to replace, duplicate, disable or
**Quitar de la escena**. Removing a block never deletes its library file.
Personalized event audio keeps its required identity and attribution; its timing,
volume and supported resource choices remain editable. Additional audio/effect
blocks are independent instances, including multiple uses of the same file.
One ambience source is active per scene; choosing another replaces that source.
Only one background is displayed at a time, with the latest active video block
taking precedence.

### Position and format text

New templates have independently editable event fields. For an older native
card, select **Datos del evento → Separar datos para editar**.

Select text directly in the canvas and drag it. Drag its corner handle to change
width, or use **Posición X/Y** and **Ancho**. Arrow keys move selected text;
Shift uses a larger step. Geometry is stored as percentages and text size uses
the FHD reference, preserving proportions across preview and player sizes.

The inspector opens **Contenido** first. Expand **Formato** for size, bold,
alignment, font family, text/background colors, background opacity and shadow.
Expand **Posición y animación** for geometry, gain and visual effects. Both groups
use native disclosure controls with keyboard support.
Supported bindings are `{name}`, `{table}`, `{song}`, `{venue}`, `{message}` and
`{sender}`. A participant greeting still retains its mandatory attribution.

### Inspect the actual composition

Choose a prepared **Caso de prueba**, or edit **Plantilla y datos de prueba**.
Reading a prepared case does not generate another voice. Select **Audio de
prueba** for unresolved dynamic audio, or **Solo imagen** to inspect visuals.

**Previsualizar**, **Pausar**, **Continuar** and **Detener** control only this
device. Scrub using the slider, ruler or draggable timeline cursor. Voice/effect
and ambience playback uses decoded audio-clock scheduling, seeking and fades;
text/background rendering is shared with the public player. **Opciones de vista**
(the sliders icon) → **Resolución**
offers HD/FHD/4K and changes the logical canvas, not the saved scene coordinates.
The preview and timeline share the same cursor; the preview transport displays
the current and total time.

Use **Pantalla completa** (outward corners) to expand the private preview. Playback,
pause/continue, stop and seeking remain available. Exit with **Esc** or **Salir de
pantalla completa** (inward corners); the canvas, audio source and current position
are preserved, and focus returns to the fullscreen button. The image keeps its
16:9 proportions in landscape and portrait views. Fullscreen hides editing handles
and does not activate the public player. Unsupported or rejected requests show a
message in the preview; playback errors also remain visible while fullscreen.

Resource searches distinguish **Sin coincidencias** (use **Limpiar búsqueda** to
reset text and type filters) from an empty library, which offers **Abrir biblioteca**.

The inspector identifies unresolved samples instead of treating estimated
durations as confirmed media. Prepared-case playback still respects the event's
native identity and selection rules; an unavailable public asset or exhausted
public voice budget can change the live fallback.

### Edit safely

Use **Deshacer/Rehacer** (Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z outside text inputs),
**Descartar cambios**, timeline zoom and snap. A drag is one undoable edit.
The editor marks unsaved changes and warns before leaving the document.
Navigating to another application section keeps the draft, selected template and
undo history in this tab's memory, scoped to the current user and room. Save before
reloading or closing the tab. **Descartar cambios** removes that draft.
Undoing template creation restores the previous selection. Text positioning uses
the rendered text height to keep its lower edge inside the canvas.
Template removal is an editable change committed with **Guardar**; **Guardar y usar**
saves and selects the template, and **Usar original** restores the original
presentation immediately. Save conflicts preserve the local draft for review.
**Guardar** also rejects known invalid timing; the server checks existing fixed
audio durations before replacing the saved settings. Missing personalized audio
is still resolved when the actual event is prepared.

Background, ambience and supported fixed audio blocks select existing resources.
Personalized calls, greetings and signatures retain the resources prepared for
their actual request. Birthdays reuse their prepared introduction, greeting and
music unless a supported fixed resource is selected.

Drag blocks or edit their numeric properties. Animations use presets; audio block gains
are relative to the existing room/player volume controls.

**Previsualizar** plays only on the administrator's device. Select an existing
sample for dynamic voice blocks. Preview does not generate speech, reserve the
public player or count public usage.

The room's animator and event controls remain authoritative. Changes affect
subsequent events; an already authorized execution keeps its captured resources.

## Focused verification

Use Node 24.22.2. The transition fixture supports the editor, keyboard, responsive
screenshots and signed offsets with temporary data:

```sh
mise exec node@24.22.2 -- env KARAOKE_E2E_MODE=development KARAOKE_E2E_SCENES_ONLY=1 KARAOKE_E2E_HTTPS_UI=1 node config/transition-player.e2e.mjs
```

HTTPS mode uses the development frontend with API/socket requests forwarded to
the isolated fixture server. Its synthetic YouTube player proves lifecycle and
timing contracts, not real YouTube/network or loudspeaker timing.
