# DLang artwork review and import

The original scene renderer remains the production fallback. This import
workflow only validates and imports a manually prepared, human-reviewed batch;
it does not call Runway or spend credits. Separately authorized API generation
now saves draft candidates for sensory-library preview, not lesson approval;
see [Sensory-Library.md](./Sensory-Library.md). No recurring spending or
automatic approval is installed.

The steward reports 625 credits per month on the existing Runway web plan.
Those credits can supply a manually generated 12-image batch for this import
workflow, subject to the batch's approved cap; they are not a verified API
balance. Ordinary web-plan credits and API project billing are separate
([Runway API FAQs](https://help.runwayml.com/hc/en-us/articles/21668552945171-Runway-API-FAQs)).
Eligible organization configurations may support transfers
([API projects in your Organization space](https://help.runwayml.com/hc/en-us/articles/55042248433939-API-projects-in-your-Organization-space));
do not assume this account qualifies. API automation requires a verified API
project balance, its server-side API key, and explicit separate spend approval.
The November 2026 pilot separately verified a 1,000-credit API trial and
generated twelve draft 720p stills using 60 credits. No credit transfer or
top-up was enabled. This does not change the review/import requirements below.

## Monthly batch

1. Before any separately authorized generation, record the approved credit cap.
   Keep credentials out of manifests, source, and browser code.
2. Export no more than 12 selected assets, each with desktop and mobile PNG
   variants. Keep source files beside a private draft manifest, not in this
   repository until all review gates pass.
3. Use `schemaVersion: 1`, a unique `batchId` and `YYYY-MM` month, the current
   `sceneVersion`, `status: "approved"`, and the exact `provider` and `budget`
   fields below. A batch needs exactly 12 unique asset IDs.
4. For every asset, retain its stable DLang concept ID, art version, style,
   context, accessible description, Runway model/job/prompt, rights owner and
   license, desktop/mobile file paths and SHA-256 hashes. Record distinct
   human visual and language approvals and a passed, documented human
   recognition check. Generation timestamps must follow the pre-approved
   credit cap; review timestamps must follow generation. Machine-generated
   text is not a language review.
5. Validate from the directory containing the manifest:

   ```sh
   node scripts/artwork-batch.mjs validate monthly-batch.json
   ```

6. Only after explicit rights, visual, language, recognition, and budget review,
   import the batch:

   ```sh
   node scripts/artwork-batch.mjs import monthly-batch.json
   ```

   Import revalidates all inputs, hashes and decodes each PNG, checks bounded
   desktop/mobile dimensions and file size, rejects unsafe paths, and refuses
   replacement of a month or batch ID. It copies into
   `public/dlang/artwork/<batchId>/` and adds the reviewed version to
   `artwork-catalog.json`. It does not replace scene recipes or narration.

## Manifest fields

- `provider`: `{ "name": "Runway", "accountIntegration": "unavailable",
  "automation": "disabled" }` for a manual web batch; use `"operator-api"`
  instead of `"unavailable"` for an explicitly authorized API-generated batch.
- `budget`: positive `creditCap` approved in advance, actual `creditsUsed` no
  greater than the cap, and named approver/time.
- Each asset's `files.desktop` and `files.mobile`: a local relative PNG path and
  lowercase SHA-256. Desktop is 1200×600 through 2400×1600; mobile is 375×500
  through 1200×2400; each file is at most 2 MiB.
- `source.rights.status` must be `cleared`, with a license and owner. `review`
  must contain named, dated visual and language approvals. Recognition records
  participants, recognized count, an explicit threshold, and the check method.

Do not invent reviews or provenance to make a batch pass. Leave drafts outside
the public catalog when a provider, budget approval, license, language reviewer,
or real learner recognition evidence is unavailable.

## App integration hook and compatibility

`resolveArtwork(catalog, conceptId, { sceneVersion, viewport })` in
`public/dlang/artwork.mjs` returns an approved, compatible asset or a precise
`unavailable`/`fallback` result. Consumers must retain the current renderer for
either result. The catalog starts empty and unavailable. This module is not
an automatic approval pipeline: compatible approved assets already render in
scene targets, preserving original procedural fallback. Draft sensory previews
do not enter this catalog. Scene hashes, saved progress and narration bindings
remain unchanged by a draft batch.
