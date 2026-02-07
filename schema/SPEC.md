We're building a home online poker game where the primary focus is about letting user-made bots play. The game is tournament or cash game no limit texas hold'em. Server will communicate with bots via websockets using JSON messages for game state and actions. Human players are allowed too, but they play using the web UI using the same message protocol.

I would like the flows clearly laid out, and the messages (with schemas) during the flows clearly laid out too. Clearly distill down and nail down a clear schema for each message appropriate to each game state. Try to simplify it down so that we don't have to handle a million different message shapes.

We're first trying to nail down what the schema looks like for the websocket protocol. This schema will be given to the bot builders so they have a reference to build against that tells them what the expected messages, game state flow, and request/response structure looks like. Ideally, they should be able to build a fully functioning bot just purely off the schema without needing to experimentally interact with the server.

Secondly, we should also be able to utilize the schmema to implement the server such that there's no drift between all the consumers. Bonus points if the schema generates nice documentation pages, and/or code scaffolding that the consumers can use to ultimately implement their endpoints.

Note that the described flows are not exhaustive, and you should put some thought into additional edge cases and how to handle them.

Possible contenders: AsyncAPI, Json Schema.

Terminology (used to shape naming of schema fields, which should be named camelCase):

Stack - chips owned by player/bot
Bet - committed chips for the betting round, lost if you fold, will be scooped and incorporated into the pot at the conclusion of the betting round.
Pot - shows the total of all chips from past betting arounds, inclusive of all active bets in the current betting around.
Pot Share - shows the total contribution by the player/bot of what they've put into the pot thus far, inclusive of their active bet, if any.
Folded - boolean, shows if a player is still actively contesting a hand or not.

GAME - a tournament or cash game from start to finish.
HAND - a round in a game. From deal to betting to showdown.
STAGE - a phase in a hand. From POST SMALL, POST BIG, DEAL, then pre-flop betting. FLOP, flop betting, TURN, turn betting, RIVER, river betting, showdown (pot is paid).

So GAMES have multiple HANDS, and HANDS have multiple STAGES.

Cards are expressed as list of strings in standard poker format: h = heart, c = club, s = spades, d = diamonds. 2-9, T J Q K A. So hole cards are like ["Ad", "Tc"], the board could be like ["6c", "4s", "Td"].

Player/bot actions are: FOLD, CHECK, BET (open a pot, min the big blind, max their stack), RAISE (min 2x the bet differential, max their stack), ALL-IN (bets their stack). Some actions can alias eachother, like BET 0 just translates to a CHECK, RAISE <stack> just translates to ALL-IN.

What follows is a high level summary of the key flows and what information is needed. We're emphasizing minimal lift on the bot side, so the server should err on the side of sending as complete game state information in each message (even if heavy) so that bots can crash-recover or miss messages and still have the full game state.

I'm picturing the game state can be described in one master object, and then things that change the game state are immutable events. Follow reducer architecture. I think most messages back and forth look roughly like (gameState, action/event) => (gameState+1, nextAction) => ...

Such that we're always sending what the current game state is, what options are available to the bot (i.e. fold, call, raise - how much). The bot responds with what action they took and then the server resolves and applies the reducer for the action and creates the next gameState, which is then communicated to all other clients.

BOT JOIN FLOW:

Bot starts up, has server IP/host configured.

Bot requests ident from server with display name

Server responds with UUID assignment (which bot will pass with all future messages to say this is me)

Bot asks "list me available games". Server responds with list of available poker rooms.

MAYBE: Bot could say "I am ready to play" and server puts it in the pending list. From the UI, the game admin could click "start game" and all the pending-to-play bots get thrown into a room.

When put in a room, Server communicates to the bot that it is joining a room, the parameters of the game (tournament, cash game, starting stack, seat position, etc) and that the bot should prepare to play.

If bot crashes, it resays "hello" with the same UUID and the server tells it where it should be - so if it was in the midst of a game, server tells bot the game state for that game and puts it back in.

END JOIN FLOW

BOT GAME FLOW:

Server sends game state, including hand ID (monotonically increasing), current phase (deal, flop, turn, river, showdown, etc). Including bots hole cards and any cards on the table. Including the pot, any bets in front of players, whether or not they folded. Again, the emphasis is on complete information - so the bot should receive in the game state the stack, bet, pot share, and folded status of all players on the table, minus information they should not have (hole cards of other players). Server indicates who the action is on.

For a tournament, the full blind schedule (probably keyed by amount, and timestamp) should be sent to the bot in the initial game setup message. In subsequent game states, it should send the number of ms to the next blind level and what that blind level will be.

When bot receives invitation to act they are provided with the list of available options to them, keyed by string enums. If a parameter is required the server specifies what the valid range numerically is.

Every time someone acts, the server accepts the response (if valid) and then applies the state transition and then communicates the new game state to all players plus what action was taken. Along with that the next player to act is prompted to provide their response.

Once betting concludes, the server progresses to the next round state, and continues until showdown. Since the spectators can see all cards all the time, revealing cards is an optional action on showdown, but if players/bots choose to do so, it should be communicated to everyone.

If the game concludes (i.e. bot loses all its money, tournament ends), this should be communicated to the bot.

During the course of a game the bot can opt to send a CHAT message, which is just a message that will be rendered in the chatbox. Has no effect on gameplay.

When it's a bot's turn to act, the server should specify how long the bot has to act in ms. If the bot is not responding, the server will send messages to count, and then send a message to say their time is up and the neutral action is assumed to be taken (check if possible, else fold).

END BOT GAME FLOW

===

Follow-up: WS messages should be fully-formed JSON. Action should just be a key.
