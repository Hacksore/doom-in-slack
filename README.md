# DOOM in a Slack iframe: proof of concept

https://github.com/user-attachments/assets/e1db24d9-0ec6-4ab5-9cc9-18e0b2e895f8

## Local development

Use Node.js 24 and the pnpm version pinned in `package.json`.

```sh
pnpm install
pnpm run setup
pnpm build
pnpm dev
```

Run `pnpm lint` to check the TypeScript scripts and Vite config, or
`pnpm lint:fix` to apply Oxlint's automatic fixes.
