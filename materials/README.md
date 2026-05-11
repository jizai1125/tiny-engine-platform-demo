# Materials

`materials/source/bundle.json` stores the source bundle.

`materials/components/*.json` stores split component schema files for maintenance.

`pnpm build:materials` merges split component files back into the runtime bundle and syncs it into `designer/public/materials/bundle.json`.
