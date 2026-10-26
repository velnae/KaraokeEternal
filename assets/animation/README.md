# Phase 1 demonstration clips

These are **test voices**, not Il Gatto's approved production announcer.
They allow testing the complete local-file playback path without a TTS service.

| File | Text | Duration |
| --- | --- | --- |
| `welcome.wav` | Bienvenidos a Il Gatto. Disfruten la música y su mesa. | 4.28 s |
| `thanks.wav` | Gracias por compartir este momento con nosotros. | 3.56 s |
| `invitation.wav` | Escanea el QR de tu mesa y elige tu próxima canción. | 4.24 s |

Generated locally with the existing Chatterbox Multilingual LATAM evaluation
installation, CPU inference, default reference supplied by that installation,
and seed 42. No customer recording or customer data was used. These are generated
test artifacts; no commercial voice/likeness clearance is asserted. Approve or
replace the voice before public operation. Upstream model:
<https://huggingface.co/ResembleAI/Chatterbox-Multilingual-es-mx-latam>.

The generated WAVs were processed with FFmpeg:

```sh
ffmpeg -i input.wav -af loudnorm=I=-16:TP=-1:LRA=7 -ar 24000 output.wav
```

This is a processing target, not a physical speaker loudness measurement.
Playback only reads the resulting files; neither Chatterbox nor FFmpeg is a
runtime dependency of the application.

On first start, the server copies this directory to `KES_PATH_DATA/animation`
only if that directory has no `catalog.json`. Existing operator catalogs are
not overwritten. The server computes checksums and durations, rejects invalid
clips and pins bytes in memory until the next server restart.
