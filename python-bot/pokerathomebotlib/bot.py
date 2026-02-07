from pokerathomebotlib.message import GameStateMessage


class Bot:

    def handle_game_state_message(self, message: GameStateMessage):
        print("Cool message bro.")
