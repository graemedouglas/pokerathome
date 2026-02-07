from enum import Enum

from pokerathomebotlib.state import GameState
from pokerathomebotlib.util import assert_type


class ActionType(Enum):

    TODO = ""


class GameStateMessage:

    def __init__(
        self,
        *,
        action_type: ActionType,
        game_state: GameState,
        action_requested: bool,
    ):
        assert_type(action_type, ActionType)
        assert_type(game_state, GameState)
        assert_type(action_requested, bool)

        self._action_type = action_type
        self._game_state = game_state
        self._action_requested = action_requested

    def get_action_type(self) -> ActionType:
        return self._action_type

    def get_game_state(self) -> GameState:
        return self._game_state

    def is_action_requested(self) -> bool:
        return self._action_requested
