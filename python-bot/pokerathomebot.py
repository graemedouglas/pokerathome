#!/usr/bin/env python3

import argparse
import logging
import sys

from pokerathomebotlib.bot import Bot
from pokerathomebotlib.net import run_client


def run(*, server_url: str):
    # Configure logging to print to standard error.
    logging.basicConfig(stream=sys.stderr)
    logging.getLogger().setLevel(logging.INFO)

    run_client(Bot(), server_url)


def main():
    parser = argparse.ArgumentParser(prog="pokerathomebot")

    parser.add_argument(
        "server_url", help="WebSockets URL to connect to (e.g. ws://localhost:9999)"
    )

    args = vars(parser.parse_args())
    run(**args)


if __name__ == "__main__":
    main()
