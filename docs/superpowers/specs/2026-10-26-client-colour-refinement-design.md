# Client colour and field clarity refinement

The owner requests the existing Clients screen to gain the colour separation they liked in Monitoring, with clear field boundaries and tidy visual hierarchy. This is a presentation-only refinement: keep the existing directory, sorting, grouping, forms, rights and all data workflows.

Use the current Manrope typography and layout. Palette: navy #14324a headings, pale blue #eaf1f8 workspace, white #ffffff input/card surfaces, blue #3267a9 private-client accents, teal #147b7e company accents, slate #7e93a8 input outlines. Client type and service activity remain explicitly labelled in text; colour is supplementary.

Alternatives considered: only stronger borders would leave the requested colour hierarchy absent; colouring every field would add noise. Chosen implementation uses tinted headers, equipment compartments and activity pills, with neutral white editable fields and a visible focus outline. Profile contacts, actions and equipment receive distinct bounded surfaces. Portal forms get a local styling class rather than modifying shared controls globally.

Acceptance: cards/table remain functional; both types and active/ready/empty states remain legible; focus is visible, disabled fields distinct; create/edit form outlines are clear; directory and profile fit desktop and480 CSSpx without page overflow. Do not test320/390. No database, schema, role, dependency or behaviour changes. Verify typecheck, existing unit checks, build, rendered synthetic UI and final deployment. Use fictional fixtures with writes blocked; do not test with production records.
