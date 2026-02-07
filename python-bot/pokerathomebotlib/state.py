from enum import Enum
from typing import Optional
from uuid import UUID

from pokerathomebotlib.util import assert_int_nonneg, assert_type


class PlayerId:

    def __init__(self, uuid_str: str):
        self._uuid = UUID(uuid_str)

    def __eq__(self, other) -> bool:
        return isinstance(other, PlayerId) and self._uuid == other._uuid


FAKE_PLAYER_ID = PlayerId("12345678-1234-5678-1234-567812345678")


class Suit(Enum):

    HEARTS = "h"
    DIAMONDS = "d"
    SPADES = "s"
    CLUBS = "c"


class Card:

    VALID_VALUES = "A23456789TJQK"

    def __init__(self, rep: str):
        assert_type(rep, str)
        assert len(rep) == 2
        assert rep[0] in self.VALID_VALUES
        self._suit = Suit(rep[1])


class PlayerGameState:
    def __init__(
        self,
        *,
        cards: list[Optional[Card]],
        folded: bool,
        stack: int,
        bet: int,
        pot_share: int,
    ):
        assert_type(cards, list)
        assert len(cards) == 2, f"Not two cards: {cards}"
        assert_type(cards[0], Card, null_ok=True)
        assert_type(cards[1], Card, null_ok=True)
        assert_type(folded, bool)
        assert_int_nonneg(stack)
        assert_int_nonneg(bet)
        assert_int_nonneg(pot_share)

        self._cards = cards
        self._folded = folded
        self._stack = stack
        self._bet = bet
        self._pot_share = pot_share

    def get_cards(self) -> list[Optional[Card]]:
        """Return the player's cards, if they have been revealed."""
        return list(self._cards)

    def get_stack(self) -> int:
        return self._stack

    def get_bet(self) -> int:
        return self._bet

    def get_pot_share(self) -> int:
        return self._pot_share

    def is_all_in(self) -> bool:
        return self._stack == 0 and self._pot_share > 0  # TODO What's best?


class Pot:
    def __init__(
        self,
        *,
        amount: int,
        player_shares: dict[PlayerId, int],
    ):
        assert_int_nonneg(amount)
        assert_type(player_shares, dict)
        if player_shares:
            assert_type(next(iter(player_shares)), PlayerId)
            assert_int_nonneg(next(iter(player_shares.values())))

        self._amount = amount
        self._player_shares = dict(player_shares)

    def get_amount(self) -> int:
        return self._amount

    def get_player_shares(self) -> dict[PlayerId, int]:
        return dict(self._player_shares)


class SharedGameState:
    def __init__(
        self,
        *,
        pot_total: int,
        pots: list[Pot],
        board_cards: list[Card],
        small_blind: int,
        big_blind: int,
    ):
        assert_int_nonneg(pot_total)
        assert_type(pots, list)
        assert pots
        assert_type(pots[0], Pot)
        assert_type(board_cards, list)
        assert 3 <= len(board_cards) <= 5, f"Not 3-5 board cards: {board_cards!r}"
        assert_type(board_cards[0], Card)
        assert_int_nonneg(small_blind)
        assert_int_nonneg(big_blind)

        self._pot_total = pot_total
        self._pots = pots
        self._board_cards = board_cards
        self._small_blind = small_blind
        self._big_blind = big_blind

    def get_pot_total(self) -> int:
        return self._pot_total

    def get_pots(self) -> list[Pot]:
        return list(self._pots)

    def get_board_cards(self) -> list[Card]:
        return list(self._board_cards)

    def get_small_blind(self) -> int:
        return self._small_blind

    def get_big_blind(self) -> int:
        return self._big_blind


class GameState:
    def __init__(
        self,
        *,
        shared_state: SharedGameState,
        player_states: dict[PlayerId, PlayerGameState],
        dealer_player: PlayerId,
        small_blind_player: PlayerId,  # TODO Should be nullable.
        big_blind_player: PlayerId,  # TODO Should be nullable.
        active_player: Optional[PlayerId],
    ):
        assert_type(shared_state, SharedGameState)
        assert_type(player_states, dict)
        if player_states:
            assert_type(next(iter(player_states)), PlayerId)
            assert_type(next(iter(player_states.values())), PlayerGameState)
        assert_type(dealer_player, PlayerId)
        assert_type(small_blind_player, PlayerId)
        assert_type(big_blind_player, PlayerId)
        assert_type(active_player, PlayerId, null_ok=True)

        self._shared_state = shared_state
        self._player_states = player_states

        self._dealer_player = dealer_player
        self._small_blind_player = small_blind_player
        self._big_blind_player = big_blind_player
        self._active_player = active_player

    def get_shared_state(self) -> SharedGameState:
        return self._shared_state

    def get_player_states(self) -> dict[PlayerId, PlayerGameState]:
        return dict(self._player_states)

    def get_dealer_player(self) -> PlayerId:
        return self._dealer_player

    def get_small_blind_player(self) -> PlayerId:
        return self._small_blind_player

    def get_big_blind_player(self) -> PlayerId:
        return self._big_blind_player

    def get_active_player(self) -> Optional[PlayerId]:
        return self._active_player
