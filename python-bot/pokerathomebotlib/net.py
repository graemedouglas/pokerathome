import asyncio
import json
import logging
from typing import Any, Optional

# from websockets.async.client import connect
from websockets.asyncio.client import connect

from pokerathomebotlib.bot import Bot
from pokerathomebotlib.message import ActionType, GameStateMessage
from pokerathomebotlib.state import (
    Card,
    FAKE_PLAYER_ID,
    GameState,
    PlayerGameState,
    PlayerId,
    Pot,
    SharedGameState,
    Suit,
)
from pokerathomebotlib.util import assert_str_nonempty, assert_type

logger = logging.getLogger(__name__)


def parse_game_state(json: dict[str, Any]) -> GameState:
    player_states: dict[PlayerId, PlayerGameState] = {}
    for player_spec in json["players"]:
        player_id = PlayerId(player_spec["id"])

        card_specs = json["holeCards"]
        player_cards: list[Optional[Card]]
        if card_specs is not None:
            player_cards = [Card(card) for card in card_specs]
        else:
            player_cards = [None, None]

        player_states[player_id] = PlayerGameState(
            cards=player_cards,
            folded=json["folded"],
            stack=json["stack"],
            bet=json["bet"],
            pot_share=json["pot_share"],
        )

    return GameState(
        shared_state=SharedGameState(
            pot_total=json["pot"],
            pots=[Pot(amount=json["pot"], player_shares={})],  # TODO
            board_cards=[Card(card) for card in json["communityCards"]],
            small_blind=json["smallBlindAmount"],
            big_blind=json["bigBlindAmount"],
        ),
        player_states=player_states,
        dealer_player=FAKE_PLAYER_ID,  # TODO
        small_blind_player=FAKE_PLAYER_ID,  # TODO
        big_blind_player=FAKE_PLAYER_ID,  # TODO
        active_player=PlayerId(json["activeplayerId"]),
    )


def parse_game_state_message(json: dict[str, Any]) -> GameStateMessage:
    return GameStateMessage(
        action_type=ActionType(json["action"]),
        game_state=parse_game_state(json["game_state"]),
        action_requested=json["actionRequested"],
    )


async def do_client(bot: Bot, host: str):
    async with connect(host) as ws:
        while True:
            body = await ws.recv()
            print(f"Received: {body!r}")
            data = json.loads(body)

            event = data.pop("event")

            if event == "gameState":
                bot.handle_game_state_message(parse_game_state_message(data))

            else:
                logger.warning(
                    "Ignoring message with unknown event '%s': %s", event, data
                )


def run_client(bot: Bot, host: str):
    assert_type(bot, Bot)
    assert_str_nonempty(host)

    asyncio.get_event_loop().run_until_complete(do_client(bot, host))
