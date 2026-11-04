"""Sample recipe runner: five slow pieces, so pause, stop and resume are easy to watch in the panel."""
import os
import time
from rack_jobs import from_environment

PIECES = ['p1', 'p2', 'p3', 'p4', 'p5']


def main():
    p = from_environment()
    p.plan(PIECES)
    delay = float(os.environ.get('RACK_SAMPLE_DELAY', '3'))
    for name in PIECES:
        p.run(name, lambda n=name: (time.sleep(delay), {'finished': n})[1])


if __name__ == '__main__':
    main()
