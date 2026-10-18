// The credit line for the land drawn in every 3D seabed block (docs/UI_DESIGN_SYSTEM.md, Map sources and credits).
// Every area takes its land from Copernicus, so the line is fixed: the notice and the liability sentence its licence
// requires for modified data. The replay's credit popover shows it (src/components/console/StageOverlays.tsx) and
// scripts/checks/evidence-reach.ts looks for it. No three.js import here: the page bundle reads this file.
export const LAND_CREDIT =
  "Land: produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved. The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30.";
