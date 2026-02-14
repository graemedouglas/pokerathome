# TODO

- Review protocol/game flow logic, verify no drift from PROTOCOL.md
  - For niche poker edge cases, feed it TDA ruleset and ask to encode as unit tests and we can fix from there

- Open test endpoint/game room on server where people can trial their bots and verify nothing is broken

- Scenario tests/golden traces, replays of games with specific edge cases and situations for people to validat their bot against, offline

- Dockerize server, basic deployment pipeline (decide which master server we'll run this on), set up prod/dev environments

- Refactor reconnectToken and possibly playerId, instead use static generated api key from admin UI

- Tournament mode, escalating blinds

- Can't currently leave room

- Rebuild the UI in react (oh no)

- Spectators broken. Should not be at table, should not be waited on for action

# BUGS

- Ben's browser-join bug "you are already in a game" - probably sticky session, check localStorage

# OPEN QUESTIONS
