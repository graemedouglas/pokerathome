Check that the WebSocket protocol schema is in sync with the server implementation.

1. Read `schema/src/protocol.ts` and extract all client-to-server and server-to-client message type names from the Zod discriminated unions.
2. Read through `server/src/ws/` to find all message types the server handles (incoming) and sends (outgoing).
3. Compare the two sets. Report:
   - Message types defined in schema but not handled/sent by server
   - Message types handled/sent by server but missing from schema
4. If there are mismatches, list them clearly and suggest which side needs updating.
5. If everything is in sync, confirm alignment.
