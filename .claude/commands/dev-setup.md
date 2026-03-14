Start the development environment.

1. Build the schema package (required shared dependency):

```
pnpm --filter @pokerathome/schema build
```

2. Start the server in the background:

```
pnpm dev
```

3. Wait a few seconds, then verify the server is healthy:

```
curl http://localhost:3000/health
```

4. Report the result. Ask if the user also wants the UI or admin dashboard started (`pnpm dev:ui` or `pnpm dev:admin`).
