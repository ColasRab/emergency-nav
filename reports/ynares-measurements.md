# Ynares building measurements — 9 November 2026

The user identified `C:/Users/colas/Documents/emergency-navigation/3DModel.obj` as Ynares. Its gray preview comes from that OBJ; its material and texture were not supplied. The Admin OBJ and PLY belong to a separate building.

| Item | Reported dimension | Meters |
| --- | ---: | ---: |
| 1st-floor height | 309.5 cm | 3.095 m |
| 1st-floor bottom platform | 36 cm | 0.36 m |
| 2nd-floor height | 305 cm | 3.05 m |
| 2nd-floor slab thickness | 17 cm | 0.17 m |
| 3rd-floor height | 284 cm | 2.84 m |
| 3rd-floor slab thickness | 16 cm | 0.16 m |

The dash in “height -305cm” is interpreted as punctuation, not a negative elevation. Original dimensions are preserved as positive lengths in `public/models/ynares-measurements.json`.

## Confirmed interpretation and applied elevations

The user confirmed that all three heights are **floor-to-floor**, with slab thickness already included, and that the 36 cm platform is **base slab thickness**. It is not a measurement of the first floor's rise above outside ground.

Taking the first-floor finished walking surface as the relative zero:

| Physical floor | Internal graph index | Walking-surface elevation | Floor span | Slab thickness |
| --- | ---: | ---: | ---: | ---: |
| 1st floor | 0 | 0 m | 3.095 m | 0.36 m |
| 2nd floor | 1 | 3.095 m | 3.05 m | 0.17 m |
| 3rd floor | 2 | 6.145 m | 2.84 m | 0.16 m |

These values replace the three-meter placeholders in `public/models/ynares.json`. Slab thickness is preserved separately by the building schema; it is not added to floor spans. The Ynares graph-maker survey template contains these same values.

Matching slab surfaces in the scan is still required to determine model scale and origin. Do not scale the scan using its overall bounding-box height unless complete building coverage and corresponding endpoints are confirmed. `floorsVerified` remains false because the model-to-floor registration has not been completed; the preview mesh is still unsplit. The source model manifest is deliberately not assigned arbitrary slice heights or a guessed scale.
