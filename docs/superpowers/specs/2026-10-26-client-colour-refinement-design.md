# Client colour and field clarity refinement

The owner requests the existing Clients screen to gain the colour separation they liked in Monitoring, with clear field boundaries and tidy visual hierarchy. This is a presentation-only refinement: keep the existing directory, sorting, grouping, forms, rights and all data workflows.

Use the current Manrope typography and layout. Palette: navy #14324a headings, pale blue #eaf1f8 workspace, white #ffffff input/card surfaces, blue #3267a9 private-client accents, teal #147b7e company accents, slate #7e93a8 input outlines. Client type and service activity remain explicitly labelled in text; colour is supplementary.

Alternatives considered: only stronger borders would leave the requested colour hierarchy absent; colouring every field would add noise. Chosen implementation uses tinted headers, equipment compartments and activity pills, with neutral white editable fields and a visible focus outline. Profile contacts, actions and equipment receive distinct bounded surfaces. Portal forms get a local styling class rather than modifying shared controls globally.

Acceptance: cards/table remain functional; both types and active/ready/empty states remain legible; focus is visible, disabled fields distinct; create/edit form outlines are clear; directory and profile fit desktop and480 CSSpx without page overflow. Do not test320/390. No database, schema, role, dependency or behaviour changes. Verify typecheck, existing unit checks, build, rendered synthetic UI and final deployment. Use fictional fixtures with writes blocked; do not test with production records.

## Verification

- Existing157 unit/SSR checks, TypeScript typecheck and production Vite build pass. No new behavioural tests were added for this presentation-only change. The pre-existing bundle-size advisory remains.
- Synthetic browser QA uses the real ClientsTab/ClientDirectory with fictional data and Firebase access blocked. Checked private/company cards, activity labels, search, grouping, table, create-client form, visible focused field and retained input after blocked save, profile overview and separately tinted vehicle/chamber blocks.
- At480 CSSpx: directory document width480/scrollWidth480; client/company form and equipment profile each outer width480 with clientWidth/scrollWidth478. No page or modal overflow.320/390 not tested.
- CSS contrast: field outline on white3.17:1, text13.01:1, placeholder5.56:1. Type/status also remain in text. Local classes scope the palette to client directory and its portal forms; shared controls and database APIs are unchanged.
- Screenshots: coolservice-clients-colour-1792996093604.jpg, coolservice-clients-cards-1792996183824.jpg, coolservice-clients-form-1792996122653.jpg, coolservice-clients-equipment-1792996173951.jpg, coolservice-clients-colour-mobile-1792996203984.jpg. All examples are fictional. Temporary QA HTML files removed after visual inspection.
- Production authenticated workflows were not exercised. No production records, photos, settings or permissions were changed for QA. Final GitHub CI and Pages status checked separately before completion.
