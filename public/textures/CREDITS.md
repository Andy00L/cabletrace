# Texture and sky credits

Every file here and in `public/hdri/` is CC0 (public domain dedication). Credit is given anyway.

| File | Source | Author | Licence | What was done to it |
| --- | --- | --- | --- | --- |
| `textures/sand-ripples-normal.jpg` | [Aerial Beach 01](https://polyhaven.com/a/aerial_beach_01), Poly Haven | Rob Tuytel | CC0 | OpenGL normal map, resized from the 1k download to 512 x 512 |
| `hdri/kloofendal-48d-partly-cloudy-512-linear.jpg` | [Kloofendal 48d Partly Cloudy (Pure Sky)](https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), Poly Haven | Greg Zaal (original), Jarod Guest (sky edits) | CC0 | The 1k HDR (md5 c69498687e876bf68d2a8b8a62234eb9) reduced to 512 x 256, exposure -0.5 stops, clipped to 8 bits and stored with linear (not sRGB) values: the water's sky reflection and the ships' image-based light read it as linear light |

The ships' paint textures (plating seams, roughness variation, marks) are drawn on a canvas in the browser
(`src/lib/ships/`), not downloaded.
