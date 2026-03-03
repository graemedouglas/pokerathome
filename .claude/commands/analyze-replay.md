Analyze a poker game replay file.

Run the analysis script:

```
node server/scripts/analyze-replay.cjs $ARGUMENTS
```

If `$ARGUMENTS` is empty, the script will use the most recent replay file in `server/replays/`.

Read the output and summarize any notable findings — especially anomalies in sit-out/return cycles, unexpected auto-folds, or state inconsistencies.
