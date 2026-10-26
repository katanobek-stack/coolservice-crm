# Equipment image assets and production prompts

Generated with the built-in ImageGen tool, not the CLI/API fallback. Artwork represents equipment categories; it is not a photograph or dimensional model of any production record. Original generated PNGs remain in the chat's generated_images directory. Final optimized WebP assets are committed under `web/public/warehouse/` and used through the Vite base URL. Optimization only resized to 1200×800 and compressed to WebP; no painted edits or background removal were performed outside ImageGen. Coldroom alpha is preserved.

## Shared prompt direction
Premium professional industrial product visualization, designed as if by a senior refrigeration engineer and rendered by a world-class architectural product artist. Finished raster assets for a professional equipment management CRM, not UI mockups. Three-quarter front/right view, slightly above roof, coherent perspective, full equipment uncropped inside safe margins, landscape3:2. Physically plausible PBR materials, pearl-white, navy blue, graphite, brushed aluminum and restrained amber safety accents; precise seams, panel depth, real hardware and meticulous ambient occlusion. Soft studio lighting, clean pale cool-gray setting. No text, numbers, logos, watermarks, people, props, snow, fog, smoke or invented gauges. Never flat SVG, cartoon, toy or low-poly.

## Coldroom — coldroom.webp
Modular walk-in commercial cold room, pearl-white insulated sandwich-panel shell with thin vertical seams, graphite plinth, brushed aluminum trims. Substantial navy front-left insulated door, small vertical recessed window, stainless hinges, orange safety latch. Front-right tall graphite refrigeration module, one large circular fan with radial grille and lower cooling fins; short conduits through the wall, realistic screws and cap trims. Soft compact contact shadow and transparent background. Entire product centered, object about80% width and78% height. This master image was used as a style reference for the deepfreeze and container.

## Deepfreeze — deepfreeze.webp
Distinct navy metallic insulated room, wide thick pearl-white door without a window, heavy stainless hinges and amber latch. Broad twin-fan cassette mounted high on the front-right, realistic fan grilles, slatted heat exchanger beneath, insulated conduits, heavy platform and visible panel depth. Full equipment, matching3/4 camera and PBR finish. Uniform pale #edf3f8 studio background at all four edges, soft compact contact shadow, no dark background, horizon or vignette.

## Container — container.webp
Long20-foot refrigerated container, pearl-white corrugated steel, navy reinforced corner posts and dark base rails. Refrigeration end at image left, long right side receding to upper right, front roughly1/3 equipment width and long side2/3. ISO corner castings, roof ribs and consistent corrugations. Integrated graphite end unit with twin top fan grilles, heat exchanger, compressor and small blank control panel. Same studio perspective/palette and uniform #edf3f8 backdrop, full silhouette with generous margins.

## Cabinet — cabinet.webp
Full-height commercial refrigerated display cabinet with double glass doors, navy slim frames, stainless handles, pearl-white insulated sides and ventilated graphite plinth. Six empty metal shelf levels, subtle cold-white LED lighting, realistic glass reflections, no products or branding. Matching3/4 front/right camera, satin materials, exquisite ambient occlusion; entire cabinet centered with safe margins and soft contact shadow, uniform #edf3f8 setting.

## Integration and QA
Fan overlays use the original1536×1024 image coordinate space, shared image/overlay aspect fit, local perspective scaling/shear and clipped rotation. Guard and center hub are stationary; raster housing stays stationary. Rental flag controls only decorative motion; no online state is inferred. Display cabinet has restrained interior light/airflow rather than invented external fans. Reduced-motion disables ongoing animation. Loading/failure hides the mechanical layer; failure keeps the card and its data usable.

The new series was inspected in actual FreezerCard components with fictional records at1280px and in a480px frame. Confirmed rotating rotor transforms with fixed guards, and no rotation on available equipment. Source tests cover reduced-motion declarations. Independent review approved. No Firebase calls or production writes were involved in visual QA.
